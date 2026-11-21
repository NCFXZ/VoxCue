import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudAccountClient, type CloudVault } from '../../electron/backend/cloud/client';
import {
  MigrationPasswords,
  validMigrationVerifier,
} from '../../electron/backend/cloud/migrationPasswords';

const origin = 'https://synthetic.example.test';
const alice = { id: randomUUID(), email: 'alice@example.test', createdAt: 1 };
const bob = { id: randomUUID(), email: 'bob@example.test', createdAt: 1 };
const password = 'synthetic-B-previous';
const signal = () => new AbortController().signal;
const json = (data: unknown, status = 200) => Response.json(data, { status });
afterEach(() => vi.restoreAllMocks());
function memory() {
  const files = new Map<string, unknown>();
  const writer = (id: string) => ({
    read: async () => structuredClone(files.get(id) ?? null),
    write: async (value: unknown) => {
      files.set(id, structuredClone(value));
    },
    clear: async () => {
      files.delete(id);
    },
  });
  return { files, writer, passwords: new MigrationPasswords(writer) };
}
function accounts(supportsVerification = false) {
  const records = memory(),
    live = new Map<string, string>(),
    routes: string[] = [];
  const serverPasswords = new Map([
    [alice.email, 'synthetic-A-password'],
    [bob.email, password],
  ]);
  let stored: unknown = null;
  const cloud: CloudVault = {
    read: async () => stored,
    write: async (v) => {
      stored = structuredClone(v);
    },
    clear: async () => {
      stored = null;
    },
  };
  const login = async (email: string, pass: string) => {
    if (serverPasswords.get(email) !== pass)
      return json({ error: { code: 'invalid_credentials' } }, 401);
    const user = email === alice.email ? alice : bob;
    const accessToken = randomBytes(32).toString('base64url');
    live.set(accessToken, user.id);
    return json({
      user,
      sessionId: randomUUID(),
      accessToken,
      refreshToken: randomBytes(32).toString('base64url'),
      expiresAt: Date.now() + 3600_000,
      refreshExpiresAt: Date.now() + 86400_000,
    });
  };
  const connect = vi.fn(login);
  const verify = vi.fn(async (email: string, pass: string) =>
    serverPasswords.get(email) === pass
      ? json({ user: email === alice.email ? alice : bob })
      : json({ error: { code: 'invalid_credentials' } }, 401));
  let duringLogout: (request: RequestInit) => void = () => {};
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const route = new URL(String(input)).pathname;
    routes.push(route);
    if (route === '/v1/capabilities') return json({
      apiVersion: 'v1', ...(supportsVerification && { profilePasswordVerification: 'password-only-v1' }),
    });
    if (route === '/v1/auth/verify-password') {
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).has('authorization')).toBe(false);
      const data = JSON.parse(String(init.body));
      expect(Object.keys(data).sort()).toEqual(['email', 'password']);
      return verify(data.email, data.password);
    }
    if (route === '/v1/auth/login') {
      const data = JSON.parse(String(init.body));
      return connect(data.email, data.password);
    }
    if (route === '/v1/auth/logout') {
      duringLogout(init);
      init.signal?.throwIfAborted();
      const token = new Headers(init.headers).get('authorization')?.slice(7);
      if (!token || !live.delete(token)) return json({ error: { code: 'unauthorized' } }, 401);
      return json({});
    }
    if (route === '/v1/auth/reset-password') return json({});
    throw Error('unexpected synthetic account route');
  };
  const account = new CloudAccountClient({
    origin,
    deviceLabel: 'fixture',
    vault: cloud,
    fetcher,
    migrationPasswords: records.passwords,
    forgetMigrationPasswordForEmail: async (email) => {
      if (email === bob.email) await records.passwords.forget(bob.id);
    },
  });
  async function entry(user: typeof alice) {
    const result = await account.call({
      action: 'login',
      email: user.email,
      password: serverPasswords.get(user.email)!,
    });
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('message');
  }
  return {
    account,
    ...records,
    serverPasswords,
    live,
    connect,
    verify,
    routes,
    entry,
    current: () => structuredClone(stored),
    onLogout: (callback: typeof duringLogout) => {
      duringLogout = callback;
    },
  };
}

it('verifies a local source with its last online password when the connection drops, retaining the active account and never querying backup data', async () => {
  const f = accounts();
  await f.entry(bob);
  expect(await f.account.call({ action: 'logout' })).toMatchObject({ ok: true });
  await f.entry(alice);
  const state = f.account.snapshot(),
    current = f.current(),
    sessions = [...f.live];
  const check = () => f.account.verifyProfileImportOwner(bob, password, signal());
  await check();
  expect(JSON.stringify(f.files.get(bob.id))).not.toContain(password);
  for (const transport of [
    async () => {
      throw TypeError('synthetic connection interrupted');
    },
    async () => new Response(null, { status: 503 }),
    async () =>
      new Response('retired endpoint', { status: 410, headers: { 'content-type': 'text/html' } }),
  ]) {
    f.connect.mockImplementationOnce(transport);
    await check();
  }
  expect(f.account.snapshot()).toEqual(state);
  expect(f.current()).toEqual(current);
  expect([...f.live]).toEqual(sessions);
  expect(new Set(f.routes)).toEqual(new Set(['/v1/capabilities', '/v1/auth/login', '/v1/auth/logout']));
});

it('verifies the source owner on the advertised endpoint without disturbing a device or the destination account', async () => {
  const f = accounts(true);
  await f.entry(alice);
  const state = f.current(), sessions = [...f.live];
  f.routes.length = 0;
  const check = (pass: string) => f.account.verifyProfileImportOwner(bob, pass, signal());
  await check(password);
  await expect(check('wrong password')).rejects.toThrow('密码');
  f.verify.mockResolvedValueOnce(json({ user: { ...bob, id: randomUUID() } }));
  await expect(check(password)).rejects.toThrow('不符');
  f.verify.mockResolvedValueOnce(json({ error: { code: 'not_found' } }, 404));
  await expect(check(password)).rejects.toThrow();
  f.verify.mockResolvedValueOnce(json({ error: { code: 'rate_limited' } }, 429));
  await expect(check(password)).rejects.toThrow('频繁');
  f.verify.mockRejectedValueOnce(TypeError('synthetic connection interrupted'));
  await check(password);
  const aborted = new AbortController();
  f.verify.mockImplementationOnce(async () => {
    aborted.abort();
    return json({ user: bob });
  });
  await expect(f.account.verifyProfileImportOwner(bob, password, aborted.signal)).rejects.toThrow();
  f.verify.mockResolvedValueOnce(json({ error: { code: 'account_disabled' } }, 403));
  await expect(check(password)).rejects.toThrow('停用');
  expect(f.files.has(bob.id)).toBe(false);
  expect(new Set(f.routes)).toEqual(new Set(['/v1/capabilities', '/v1/auth/verify-password']));
  expect([...f.live]).toEqual(sessions);
  expect(f.current()).toEqual(state);
});

it('honors an authoritative refusal, keeps the cached password after a typo, revokes a rejected old password and records only a successful rotation', async () => {
  const f = accounts(),
    check = (value: string) => f.account.verifyProfileImportOwner(bob, value, signal());
  await f.entry(alice);
  await check(password);
  const current = f.current();
  await expect(check('unrelated typo')).rejects.toThrow('密码');
  expect(f.files.has(bob.id)).toBe(true);
  for (const code of [429, 404, 410]) {
    f.connect.mockResolvedValueOnce(
      json({ error: { code: code === 429 ? 'rate_limited' : 'not_found' } }, code),
    );
    await expect(check(password)).rejects.toThrow();
    expect(f.files.has(bob.id)).toBe(true);
  }
  f.serverPasswords.set(bob.email, 'synthetic-B-new-password');
  await expect(check(password)).rejects.toThrow('密码');
  expect(f.files.has(bob.id)).toBe(false);
  f.connect.mockRejectedValueOnce(TypeError('offline'));
  await expect(check(password)).rejects.toThrow('尚未');
  await check('synthetic-B-new-password');
  f.connect.mockRejectedValueOnce(TypeError('offline'));
  await expect(check(password)).rejects.toThrow('不正确');
  f.connect.mockRejectedValueOnce(TypeError('offline'));
  await check('synthetic-B-new-password');
  f.connect.mockResolvedValueOnce(json({ error: { code: 'account_disabled' } }, 403));
  await expect(check('synthetic-B-new-password')).rejects.toThrow('停用');
  expect(f.files.has(bob.id)).toBe(false);
  expect(f.current()).toEqual(current);
});

it('ties the local verifier to its owner, email and service and preserves its attempt delay across reopen and concurrent requests', async () => {
  const f = memory();
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  await f.passwords.remember(bob, password, origin);
  const value = f.files.get(bob.id);
  expect(validMigrationVerifier(value)).toBe(true);
  f.files.set(alice.id, value);
  for (const [identity, service] of [
    [alice, origin],
    [{ ...bob, email: alice.email }, origin],
    [bob, 'https://different.example.test'],
  ] as const)
    await expect(f.passwords.verify(identity, password, service, signal())).rejects.toThrow('尚未');
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, () => f.passwords.verify(bob, 'wrong', origin, signal())),
  );
  expect(attempts.every((attempt) => attempt.status === 'rejected')).toBe(true);
  expect(f.files.get(bob.id)).toMatchObject({ failures: 5, retryAt: 40_000 });
  const reopened = new MigrationPasswords(f.writer);
  await expect(reopened.verify(bob, password, origin, signal())).rejects.toThrow('频繁');
  vi.mocked(Date.now).mockReturnValue(40_001);
  await reopened.verify(bob, password, origin, signal());
  expect(f.files.get(bob.id)).toMatchObject({ failures: 0, retryAt: 0 });
});

it.each([1, 2])('recovers local data with a v%i verifier years after a permanent shutdown, without a cloud session', async version => {
  const f = accounts(true);
  const start = Date.UTC(2026, 0, 1);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  await f.entry(bob);
  expect(await f.account.call({ action: 'logout' })).toMatchObject({ ok: true });
  if (version === 1) {
    const { verifiedAt: _verifiedAt, ...old } = f.files.get(bob.id) as Record<string, unknown>;
    f.files.set(bob.id, { ...old, version: 1 });
  }
  clock.mockReturnValue(Date.UTC(2036, 0, 1));
  const requests: string[] = [];
  let parkedWebsite = false;
  const local = new CloudAccountClient({
    origin, deviceLabel: 'local recovery',
    vault: { read: async () => null, write: async () => { throw Error('unexpected session'); }, clear: async () => {} },
    migrationPasswords: new MigrationPasswords(f.writer),
    fetcher: async input => {
      requests.push(new URL(String(input)).pathname);
      if (parkedWebsite) return new Response('<html>Service closed</html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
      throw TypeError('account service permanently offline');
    },
  });
  const check = (identity: typeof bob, pass: string) => local.verifyProfileImportOwner(identity, pass, signal());
  await expect(check(bob, 'wrong')).rejects.toThrow('不正确');
  await check(bob, password);
  parkedWebsite = true;
  await check(bob, password);
  await expect(check(alice, password)).rejects.toThrow('尚未');
  expect(local.snapshot().user).toBeNull();
  expect(new Set(requests)).toEqual(new Set(['/v1/capabilities']));
});

it('revokes a transient online session after a user cancels and clears offline verification after a confirmed password reset', async () => {
  const f = accounts();
  await f.entry(alice);
  const state = f.current(),
    sessions = [...f.live];
  const controller = new AbortController();
  f.onLogout((request) => {
    controller.abort();
    expect(request.signal?.aborted).toBe(false);
  });
  await expect(
    f.account.verifyProfileImportOwner(bob, password, controller.signal),
  ).rejects.toThrow();
  expect(f.current()).toEqual(state);
  expect([...f.live]).toEqual(sessions);
  expect(f.files.has(bob.id)).toBe(false);
  f.onLogout(() => {});
  await f.account.verifyProfileImportOwner(bob, password, signal());
  expect(f.files.has(bob.id)).toBe(true);
  expect(
    await f.account.call({
      action: 'reset',
      email: bob.email,
      password: 'new-synthetic-long-password',
      code: '123456',
      challengeId: randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  expect(f.files.has(bob.id)).toBe(false);
});
