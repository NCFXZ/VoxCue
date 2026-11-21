import { describe, it, expect, vi } from 'vitest';
import {
  CloudAccountClient,
  cloudOrigin,
  storedCloudCredentials,
  type CloudVault,
} from '../../electron/backend/cloud/client';
import { CloudSyncClient } from '../../electron/backend/cloud/sync';
import type { CloudAccountCall } from '../../electron/contracts/cloudAccount';
import {
  credentialProblemCode,
  credentialProblemMessages,
} from '../../electron/contracts/credentialProblems';

const origin = 'https://accounts.example.test';
const result = () => ({
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'synthetic@example.test',
    createdAt: Date.now(),
  },
  sessionId: '22222222-2222-4222-8222-222222222222',
  accessToken: 'a'.repeat(43),
  refreshToken: 'b'.repeat(43),
  expiresAt: Date.now() + 900000,
  refreshExpiresAt: Date.now() + 86400000,
});
function vault(initial: unknown = null) {
  let stored = initial;
  const port: CloudVault = {
    async read() {
      return stored;
    },
    async write(value) {
      stored = value;
    },
    async clear() {
      stored = null;
    },
  };
  return { port, read: () => stored };
}
const json = (value: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers });
describe('independent cloud account client', () => {
  it.each(['status', 'refresh'])(
    'rejects a new owner returned by an existing session during %s',
    async (operation) => {
      const current = result();
      if (operation === 'refresh') current.expiresAt = 1;
      const other = {
        ...result(),
        user: { ...current.user, id: '33333333-3333-4333-8333-333333333333' },
      };
      const saved = vault({ origin, credentials: current });
      const fetcher = vi.fn(async () =>
        json(operation === 'refresh' ? other : { user: other.user }),
      );
      const account = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: saved.port,
        fetcher,
      });
      expect(await account.call({ action: 'status' })).toMatchObject({
        ok: false,
        state: { user: null },
      });
      expect(saved.read()).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    'VOXCUE_CREDENTIAL_CONFLICT',
    'VOXCUE_CREDENTIAL_LOCKED',
    'VOXCUE_CREDENTIAL_UNAVAILABLE',
    'VOXCUE_CREDENTIAL_TIMEOUT',
  ] as const)(
    'keeps fixed local %s guidance and blocks recovery requests before network or replacement',
    async (code) => {
      const read = vi.fn(async () => {
        throw Object.assign(Error('private native detail'), { code });
      });
      const preserve = vi.fn(),
        clear = vi.fn(),
        write = vi.fn(),
        fetcher = vi.fn();
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: { read, preserve, clear, write },
        fetcher,
      });
      const calls: CloudAccountCall[] = [
        { action: 'status' },
        { action: 'login', email: result().user.email, password: 'synthetic-password' },
        { action: 'code', email: result().user.email, purpose: 'register' },
        {
          action: 'register',
          email: result().user.email,
          password: 'synthetic-password',
          code: '123456',
          challengeId: result().sessionId,
        },
        {
          action: 'reset',
          email: result().user.email,
          password: 'synthetic-password',
          code: '123456',
          challengeId: result().sessionId,
        },
      ];
      for (const call of calls) {
        const response = await client.call(call);
        expect(response).toMatchObject({ ok: false, error: credentialProblemMessages[code] });
        expect(response).not.toHaveProperty('credentialProblem');
        expect(JSON.stringify(response)).not.toContain('private native detail');
      }
      expect(fetcher).not.toHaveBeenCalled();
      expect(preserve).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
    },
  );
  it('allows explicit recovery of a fixed local data error only after preserving ciphertext', async () => {
    const saved = vault();
    saved.port.read = async () => {
      throw Object.assign(Error('private bad data'), { code: 'VOXCUE_CREDENTIAL_INVALID_DATA' });
    };
    const preserve = (saved.port.preserve = vi.fn(async () => {}));
    const fetcher = vi.fn(async () => json(result()));
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: saved.port,
      fetcher,
    });
    expect(await client.call({ action: 'status' })).toMatchObject({
      ok: false,
      error: credentialProblemMessages.VOXCUE_CREDENTIAL_INVALID_DATA,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (
        await client.call({
          action: 'login',
          email: result().user.email,
          password: 'synthetic-password',
        })
      ).ok,
    ).toBe(true);
    expect(preserve).toHaveBeenCalledOnce();
    expect(saved.read()).toMatchObject({ origin, credentials: { sessionId: result().sessionId } });
  });
  it.each(['VOXCUE_CREDENTIAL_UNAVAILABLE', 'VOXCUE_CREDENTIAL_TIMEOUT'] as const)(
    'revokes a newly issued session when local persistence fails with %s and keeps fixed guidance',
    async (code) => {
      const saved = vault();
      saved.port.write = vi.fn(async () => {
        throw Object.assign(Error('private native write detail'), { code });
      });
      const preserve = (saved.port.preserve = vi.fn(async () => {}));
      const clear = (saved.port.clear = vi.fn(async () => {}));
      const calls: { route: string; authorization: string | null }[] = [];
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: saved.port,
        fetcher: async (url, options) => {
          const route = new URL(String(url)).pathname;
          calls.push({ route, authorization: new Headers(options?.headers).get('authorization') });
          return json(route.endsWith('/logout') ? {} : result());
        },
      });
      const response = await client.call({
        action: 'login',
        email: result().user.email,
        password: 'synthetic-password',
      });
      expect(response).toMatchObject({
        ok: false,
        error: credentialProblemMessages[code],
        state: { user: null, verified: false },
      });
      expect(JSON.stringify(response)).not.toMatch(
        /private native write detail|accessToken|refreshToken/,
      );
      expect(calls).toEqual([
        { route: '/v1/auth/login', authorization: null },
        { route: '/v1/auth/logout', authorization: 'Bearer ' + result().accessToken },
      ]);
      expect(saved.port.write).toHaveBeenCalledOnce();
      expect(preserve).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
      expect(saved.read()).toBeNull();
    },
  );
  it.each(
    (['server', 'transport'] as const).flatMap((source) =>
      [
        'VOXCUE_CREDENTIAL_CONFLICT',
        'VOXCUE_CREDENTIAL_LOCKED',
        'VOXCUE_CREDENTIAL_UNAVAILABLE',
        'VOXCUE_CREDENTIAL_TIMEOUT',
      ].map((code) => ({ source, code })),
    ),
  )(
    'does not mistake a $source $code error for a local Keychain problem',
    async ({ source, code }) => {
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: vault().port,
        fetcher: async () => {
          if (source === 'server')
            return json({ error: { code, message: 'private server detail' } }, 400);
          throw Object.assign(Error('private transport detail'), { code });
        },
      });
      const response = await client.call({
        action: 'login',
        email: result().user.email,
        password: 'synthetic-password',
      });
      expect(response.ok).toBe(false);
      expect(response).not.toHaveProperty('credentialProblem');
      expect(JSON.stringify(response)).not.toMatch(/private|钥匙串/);
      expect(response.error).not.toBe(
        credentialProblemMessages[code as keyof typeof credentialProblemMessages],
      );
    },
  );
  it.each(['EACCES', 'EIO', 'VOXCUE_HELPER_PROTOCOL'])(
    'does not classify arbitrary local %s failures as recoverable data errors',
    async (code) => {
      const preserve = vi.fn(),
        write = vi.fn(),
        fetcher = vi.fn();
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: {
          read: async () => {
            throw Object.assign(Error('private local detail'), { code });
          },
          write,
          clear: vi.fn(),
          preserve,
        },
        fetcher,
      });
      const response = await client.call({ action: 'status' });
      expect(response).toMatchObject({
        ok: false,
        error: '账号服务连接失败，请检查网络或系统凭据存储。',
      });
      expect(response).not.toHaveProperty('credentialProblem');
      expect(JSON.stringify(response)).not.toContain('private local detail');
      expect(
        await client.call({
          action: 'login',
          email: result().user.email,
          password: 'synthetic-password',
        }),
      ).toMatchObject({ ok: false, error: '账号服务连接失败，请检查网络或系统凭据存储。' });
      expect(preserve).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    },
  );
  it('sanitizes fixed local error codes without exposing messages or invoking getters', () => {
    expect(
      credentialProblemCode(Object.assign(Error('private'), { code: 'VOXCUE_CREDENTIAL_LOCKED' })),
    ).toBe('VOXCUE_CREDENTIAL_LOCKED');
    const getter = vi.fn(() => {
      throw Error('private getter');
    });
    expect(
      credentialProblemCode(Object.defineProperty({}, 'code', { get: getter })),
    ).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(
      credentialProblemCode(Object.create({ code: 'VOXCUE_CREDENTIAL_CONFLICT' })),
    ).toBeUndefined();
    expect(
      credentialProblemCode({
        code: 'unknown',
        message: credentialProblemMessages.VOXCUE_CREDENTIAL_CONFLICT,
      }),
    ).toBeUndefined();
  });
  it('locally validates expired saved credentials without a network expiry decision', () => {
    const expired = { ...result(), expiresAt: 1, refreshExpiresAt: 2 };
    expect(storedCloudCredentials({ origin, credentials: expired }, origin)).toEqual(expired);
    for (const invalid of [
      {},
      { origin, credentials: {} },
      { origin, credentials: { ...expired, user: {} } },
    ])
      expect(() => storedCloudCredentials(invalid, origin)).toThrow();
  });
  it.each(['unreadable', 'malformed', 'scalar'])(
    'explicit login recovers %s storage only after preserving it',
    async (kind) => {
      const stored = vault(kind === 'scalar' ? false : { origin, credentials: {} });
      if (kind === 'unreadable')
        stored.port.read = async () => {
          throw Object.assign(Error('bad ciphertext'), { code: 'VOXCUE_CREDENTIAL_INVALID_DATA' });
        };
      const preserve = vi.fn(async () => {});
      stored.port.preserve = preserve;
      const clear = vi.spyOn(stored.port, 'clear');
      const fetcher = vi.fn(async () => json(result()));
      const client = new CloudAccountClient({
        origin,
        vault: stored.port,
        deviceLabel: 'Synthetic',
        fetcher,
      });
      expect((await client.call({ action: 'status' })).ok).toBe(false);
      expect(clear).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(
        (
          await client.call({
            action: 'login',
            email: 'synthetic@example.test',
            password: 'synthetic-password',
          })
        ).ok,
      ).toBe(true);
      expect(preserve).toHaveBeenCalledOnce();
      expect(clear).not.toHaveBeenCalled();
      expect(stored.read()).toMatchObject({
        origin,
        credentials: { sessionId: result().sessionId },
      });
    },
  );
  it('does not replace or contact the server when recovery cannot preserve the old encrypted file', async () => {
    const stored = vault({ origin, credentials: {} });
    stored.port.preserve = async () => {
      throw Error('disk full');
    };
    const fetcher = vi.fn();
    const client = new CloudAccountClient({
      origin,
      vault: stored.port,
      deviceLabel: 'Synthetic',
      fetcher,
    });
    expect(
      (
        await client.call({
          action: 'login',
          email: 'synthetic@example.test',
          password: 'synthetic-password',
        })
      ).ok,
    ).toBe(false);
    expect(stored.read()).toEqual({ origin, credentials: {} });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['account', 'upload', 'download'])(
    'oversized %s responses release both locks even if transport cancellation never settles',
    async (kind) => {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const oversized = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array((kind === 'download' ? 1048576 : 32768) + 1));
          },
          cancel,
        }),
      );
      const transport = vi
        .fn()
        .mockImplementation(async (url) =>
          json(
            String(url).endsWith('/backups')
              ? { items: [], nextCursor: null }
              : { user: result().user },
          ),
        )
        .mockResolvedValueOnce(json({ user: result().user }))
        .mockResolvedValueOnce(oversized);
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: vault({ origin, credentials: result() }).port,
        fetcher: transport,
      });
      expect((await client.call({ action: 'status' })).ok).toBe(true);
      const sync = new CloudSyncClient(client);
      const owner = {
        userId: result().user.id,
        syncId: '33333333-3333-4333-8333-333333333333',
        id: result().sessionId,
      };
      const failed =
        kind === 'account'
          ? await client.call({ action: 'status' })
          : await sync.call(
              kind === 'upload'
                ? { ...owner, action: 'put', index: 0, bytes: new Uint8Array([1]) }
                : { ...owner, action: 'read', index: 0, version: result().sessionId },
            );
      expect(failed).toMatchObject({ ok: false, error: expect.stringContaining('过大') });
      expect(cancel).toHaveBeenCalledOnce();
      expect(oversized.body!.locked).toBe(false);
      expect((await client.call({ action: 'status' })).ok).toBe(true);
      expect(
        (await sync.call({ action: 'list', userId: owner.userId, syncId: owner.syncId })).ok,
      ).toBe(true);
    },
  );
  it('statistics rejection does not wait for failed-response cancellation or revoke credentials', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: vault({ origin, credentials: result() }).port,
      fetcher: vi
        .fn()
        .mockResolvedValueOnce(json({ user: result().user }))
        .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 })),
    });
    expect((await client.call({ action: 'status' })).ok).toBe(true);
    await expect(
      client.telemetryIdentity(
        '33333333-3333-4333-8333-333333333333',
        result().user.id,
        new AbortController().signal,
      ),
    ).rejects.toThrow('Attribution unavailable');
    expect(cancel).toHaveBeenCalledOnce();
    expect(client.snapshot().user?.id).toBe(result().user.id);
  });
  it('allows a slow full chunk to finish beyond the metadata deadline', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('timed out', 'TimeoutError')),
        milliseconds,
      );
      return controller.signal;
    });
    try {
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: vault({ origin, credentials: result() }).port,
        fetcher: (async (_url, options) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(json({ stored: true })), 20_000);
            options!.signal!.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(options!.signal!.reason);
              },
              { once: true },
            );
          })) as typeof fetch,
      });
      const uploading = client.api('/v1/uploads/synthetic/parts/0', 'PUT', new Uint8Array(1048576));
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(uploading).resolves.toEqual({ stored: true });
    } finally {
      timeout.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('cancels only the matching sync engine and releases both transfer locks before logout', async () => {
    const syncId = '33333333-3333-4333-8333-333333333333';
    const laterSyncId = '44444444-4444-4444-8444-444444444444';
    let signal!: AbortSignal;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: vault({ origin, credentials: result() }).port,
      fetcher: (async (url, options) => {
        if (String(url).includes('/parts/'))
          return new Promise<Response>((_resolve, reject) => {
            signal = options!.signal!;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            started();
          });
        if (String(url).endsWith('/backups')) return json({ items: [], nextCursor: null });
        return json(String(url).endsWith('/account') ? { user: result().user } : {});
      }) as typeof fetch,
    });
    await client.call({ action: 'status' });
    const sync = new CloudSyncClient(client);
    const uploading = sync.call({
      action: 'put',
      userId: result().user.id,
      syncId,
      id: result().sessionId,
      index: 0,
      bytes: new Uint8Array(1048576),
    });
    await entered;
    expect(
      (await sync.call({ action: 'cancel', userId: result().user.id, syncId: laterSyncId })).ok,
    ).toBe(true);
    expect(signal.aborted).toBe(false);
    expect((await sync.call({ action: 'cancel', userId: result().user.id, syncId })).ok).toBe(true);
    expect(signal.aborted).toBe(true);
    expect((await uploading).ok).toBe(false);
    expect(
      (await sync.call({ action: 'list', userId: result().user.id, syncId: laterSyncId })).ok,
    ).toBe(true);
    expect((await client.call({ action: 'logout' })).ok).toBe(true);
    expect(client.snapshot().user).toBeNull();
  });
  it('removes a cancelled queued sync request without aborting an unrelated reader', async () => {
    let finish!: (value: Response) => void;
    let requests = 0;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: vault({ origin, credentials: result() }).port,
      fetcher: (async () => {
        if (++requests > 1) return json({ quota: false });
        return new Promise<Response>((resolve) => {
          finish = resolve;
          started();
        });
      }) as typeof fetch,
    });
    const reader = client.api('/v1/entitlements');
    await entered;
    const owner = { userId: result().user.id, syncId: '33333333-3333-4333-8333-333333333333' };
    const queued = client.api('/v1/backups', 'GET', undefined, false, owner);
    const cancelled = expect(queued).rejects.toThrow();
    client.cancelTransfers(owner.userId, owner.syncId);
    await cancelled;
    finish(json({ quota: true }));
    await expect(reader).resolves.toEqual({ quota: true });
    await expect(client.api('/v1/entitlements')).resolves.toEqual({ quota: false });
    expect(requests).toBe(2);
  });
  it.each([401, 403, 503])(
    'statistics HTTP %i never clears the cloud session or exposes access tokens',
    async (status) => {
      let telemetry = false;
      const saved = vault();
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: saved.port,
        fetcher: async (url, init) => {
          if (!telemetry) return json(result());
          expect(String(url)).toBe(origin + '/v2/telemetry/identity');
          expect(JSON.parse(init!.body as string)).toEqual({
            installationId: '33333333-3333-4333-8333-333333333333',
          });
          expect(new Headers(init!.headers).get('authorization')).toBe(
            'Bearer ' + result().accessToken,
          );
          return json({ error: { code: 'account_disabled' } }, status);
        },
      });
      expect(
        (await client.call({ action: 'login', email: result().user.email, password: 'legacy' })).ok,
      ).toBe(true);
      const before = saved.read();
      telemetry = true;
      await expect(
        client.telemetryIdentity(
          '33333333-3333-4333-8333-333333333333',
          result().user.id,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(saved.read()).toEqual(before);
      expect(client.snapshot().verified).toBe(true);
      expect(JSON.stringify(client.snapshot())).not.toContain(result().accessToken);
    },
  );
  it('keeps irreversible server confirmation visible when the local vault needs erasure retry', async () => {
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: {
        read: async () => ({ origin, credentials: result() }),
        write: async () => {},
        clear: async () => {
          throw Error('synthetic locked vault');
        },
      },
      fetcher: (async (url) =>
        json(
          String(url).endsWith('/capabilities')
            ? { accountDeletion: 'account-erasure-v1' }
            : { deleted: true },
        )) as typeof fetch,
    });
    const response = await client.call({
      action: 'delete',
      password: 'Synthetic password',
      confirm: 'DELETE',
    });
    expect(response.ok).toBe(true);
    expect(response.state.user).toBeNull();
  });
  it.each([null, 'invalid-json', { error: null }])(
    'account deletion clears malformed HTTP 401: %j',
    async (body) => {
      const saved = vault({ origin, credentials: result() });
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: saved.port,
        fetcher: (async (url) =>
          String(url).endsWith('/capabilities')
            ? json({ accountDeletion: 'account-erasure-v1' })
            : new Response(
                body === null ? null : typeof body === 'string' ? body : JSON.stringify(body),
                { status: 401 },
              )) as typeof fetch,
      });
      expect(
        (await client.call({ action: 'delete', password: 'Synthetic password', confirm: 'DELETE' }))
          .ok,
      ).toBe(false);
      expect(saved.read()).toBeNull();
      expect(client.snapshot().user).toBeNull();
    },
  );
  it.each(['legacy', 'wrong-password', 'expired', 'success'])(
    'account erasure capability and reauthentication: %s',
    async (mode) => {
      const saved = vault({ origin, credentials: result() });
      const calls: string[] = [];
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: saved.port,
        fetcher: (async (url) => {
          const route = new URL(String(url)).pathname;
          calls.push(route);
          if (route === '/v1/capabilities')
            return json({ accountDeletion: mode === 'legacy' ? undefined : 'account-erasure-v1' });
          return mode === 'wrong-password'
            ? json({ error: { code: 'invalid_credentials' } }, 401)
            : mode === 'expired'
              ? json({ error: { code: 'unauthorized' } }, 401)
              : json({ deleted: true });
        }) as typeof fetch,
      });
      const response = await client.call({
        action: 'delete',
        password: 'Synthetic current password',
        confirm: 'DELETE',
      });
      if (mode === 'legacy') expect(calls).toEqual(['/v1/capabilities']);
      else expect(calls).toEqual(['/v1/capabilities', '/v1/account/delete']);
      expect(response.ok).toBe(mode === 'success');
      expect(saved.read() === null).toBe(mode === 'expired' || mode === 'success');
      expect(response.state.user === null).toBe(mode === 'expired' || mode === 'success');
    },
  );
  it('revokes a newly issued session if encrypted persistence fails without exposing its token', async () => {
    const calls: { route: string; authorization: string | null }[] = [];
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: {
        async read() {
          return null;
        },
        async write() {
          throw Error('Synthetic encrypted storage failure');
        },
        async clear() {},
      },
      fetcher: (async (url, options) => {
        calls.push({
          route: new URL(String(url)).pathname,
          authorization: new Headers(options?.headers).get('authorization'),
        });
        return json(String(url).endsWith('/logout') ? {} : result());
      }) as typeof fetch,
    });
    const response = await client.call({
      action: 'login',
      email: 'synthetic@example.test',
      password: 'legacy',
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toBe('系统无法安全保存登录状态，请稍后重试。');
    expect(response.state.user).toBeNull();
    expect(calls).toEqual([
      { route: '/v1/auth/login', authorization: null },
      { route: '/v1/auth/logout', authorization: 'Bearer ' + result().accessToken },
    ]);
    expect(JSON.stringify(response)).not.toContain(result().accessToken);
  });
  it.each(['__proto__', 'constructor', 'toString', { unknown: true }])(
    'accepts only own allowlisted error codes: %j',
    async (code) => {
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: vault({ origin, credentials: result() }).port,
        fetcher: (async () =>
          json({ error: { code, message: 'server-secret' } }, 403)) as typeof fetch,
      });
      const response = await client.call({ action: 'status' });
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.error).toBe('服务暂不可用，请稍后重试。');
      await expect(
        client.api('/v1/uploads/synthetic/parts/0', 'PUT', new Uint8Array([1])),
      ).rejects.toMatchObject({ status: 403, message: '云同步请求失败，请稍后重试。' });
    },
  );
  it.each([false, true])(
    'clears HTTP 401 even when its body is invalid (binary=%s)',
    async (binary) => {
      const saved = vault({ origin, credentials: result() });
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: saved.port,
        fetcher: (async () => new Response('not JSON', { status: 401 })) as typeof fetch,
      });
      await expect(client.api('/v1/backups', 'GET', undefined, binary)).rejects.toThrow();
      expect(saved.read()).toBeNull();
      expect(client.snapshot().user).toBeNull();
    },
  );
  it.each(['TLS secret', 'timeout secret', 'invalid JSON'])(
    'sanitizes transport failures: %s',
    async (failure) => {
      const client = new CloudAccountClient({
        origin,
        deviceLabel: 'Synthetic',
        vault: vault().port,
        fetcher: (async () => {
          if (failure === 'invalid JSON') return new Response('{');
          throw Error(failure);
        }) as typeof fetch,
      });
      const response = await client.call({
        action: 'login',
        email: result().user.email,
        password: 'old',
      });
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.error).toBe('账号服务连接失败，请检查网络或系统凭据存储。');
      expect(client.snapshot().user).toBeNull();
    },
  );
  it.each(['login', 'status', 'refresh', 'upload', 'download'] as const)(
    'rejects a disabled account during %s and clears its local session',
    async (action) => {
      const credentials = result();
      if (action === 'refresh') credentials.expiresAt = 1;
      const saved = vault({ origin, credentials });
      const client = new CloudAccountClient({
        origin,
        vault: saved.port,
        deviceLabel: 'Synthetic',
        fetcher: (async () =>
          json(
            { error: { code: 'account_disabled', message: 'server-secret' } },
            403,
          )) as typeof fetch,
      });
      if (action === 'upload' || action === 'download') {
        // Load the synthetic session without issuing the account status request.
        const request =
          action === 'upload'
            ? client.api('/v1/uploads/synthetic/parts/0', 'PUT', new Uint8Array([1]))
            : client.api('/v1/backups/synthetic/parts/0', 'GET', undefined, true);
        await expect(request).rejects.toMatchObject({
          status: 403,
          message: '该账号已被停用，请联系支持。',
        });
      } else {
        const response = await client.call(
          action === 'login'
            ? { action: 'login', email: credentials.user.email, password: 'legacy' }
            : { action: 'status' },
        );
        expect(response.ok).toBe(false);
        if (!response.ok) expect(response.error).toBe('该账号已被停用，请联系支持。');
      }
      expect(client.snapshot().user).toBeNull();
      expect(saved.read()).toBeNull();
    },
  );
  it('retains a valid local session for an unrelated forbidden operation', async () => {
    const saved = vault({ origin, credentials: result() });
    const client = new CloudAccountClient({
      origin,
      vault: saved.port,
      deviceLabel: 'Synthetic',
      fetcher: (async () => json({ error: { code: 'forbidden' } }, 403)) as typeof fetch,
    });
    await expect(client.api('/v1/backups')).rejects.toMatchObject({ status: 403 });
    expect(client.snapshot().user?.id).toBe(result().user.id);
    expect(saved.read()).not.toBeNull();
  });
  it('serializes background API readers with a bounded two-slot queue', async () => {
    const saved = vault({ origin, credentials: result() });
    let finish!: (value: Response) => void,
      count = 0;
    const client = new CloudAccountClient({
      origin,
      vault: saved.port,
      deviceLabel: 'Synthetic',
      fetcher: (async () => {
        count++;
        if (count === 2)
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return json(count === 1 ? { user: result().user } : { value: true });
      }) as typeof fetch,
    });
    await client.call({ action: 'status' });
    const first = client.api('/v1/backups');
    while (!finish) await Promise.resolve();
    const second = client.api('/v1/entitlements'),
      third = client.api('/v1/entitlements');
    await expect(client.api('/v1/backups')).rejects.toMatchObject({ status: 503 });
    expect(count).toBe(2);
    finish(json({ value: true }));
    await Promise.all([first, second, third]);
    expect(count).toBe(4);
  });
  it('enforces 8–128 Unicode password characters before registration/reset requests', async () => {
    let requests = 0;
    const client = new CloudAccountClient({
      origin,
      vault: vault().port,
      deviceLabel: 'Synthetic',
      fetcher: (async () => {
        requests++;
        return json(result());
      }) as typeof fetch,
    });
    for (const action of ['register', 'reset'] as const)
      for (const n of [7, 129]) {
        const value = await client.call({
          action,
          email: 'synthetic@example.test',
          password: 'a'.repeat(n),
          code: '123456',
          challengeId: '33333333-3333-4333-8333-333333333333',
        });
        expect(value.ok).toBe(false);
      }
    expect(requests).toBe(0);
    for (const action of ['register', 'reset'] as const)
      for (const n of [8, 9, 10, 11, 12, 13, 14, 128])
        expect(
          (
            await client.call({
              action,
              email: 'synthetic@example.test',
              password: 'K7!vQ#pR' + 'x'.repeat(n - 8),
              code: '123456',
              challengeId: '33333333-3333-4333-8333-333333333333',
            })
          ).ok,
        ).toBe(true);
    expect(requests).toBe(16);
    expect(
      (
        await client.call({
          action: 'register',
          email: 'synthetic@example.test',
          password: '😀'.repeat(128),
          code: '123456',
          challengeId: '33333333-3333-4333-8333-333333333333',
        })
      ).ok,
    ).toBe(true);
    expect(requests).toBe(17);
  });
  it('rejects malformed login strings but preserves legacy short and non-NFC password bytes', async () => {
    const sent: string[] = [];
    const client = new CloudAccountClient({
      origin,
      vault: vault().port,
      deviceLabel: 'Synthetic',
      fetcher: (async (_url, options) => {
        sent.push(JSON.parse(String(options?.body)).password);
        return json(result());
      }) as typeof fetch,
    });
    for (const password of ['\ud800', '\udfff', 'x'.repeat(1025)])
      expect(
        (await client.call({ action: 'login', email: result().user.email, password })).ok,
      ).toBe(false);
    expect(sent).toEqual([]);
    for (const password of ['old', ' e\u0301 中文! '])
      expect(
        (await client.call({ action: 'login', email: result().user.email, password })).ok,
      ).toBe(true);
    expect(sent).toEqual(['old', ' e\u0301 中文! ']);
  });
  it('normalizes only new passwords and counts NFC code points while preserving spaces and symbols', async () => {
    const sent: string[] = [];
    const client = new CloudAccountClient({
      origin,
      vault: vault().port,
      deviceLabel: 'Synthetic',
      fetcher: (async (_url, options) => {
        sent.push(JSON.parse(String(options?.body)).password);
        return json(result());
      }) as typeof fetch,
    });
    for (const password of [' e\u0301中文! 😀'.padEnd(20, ' '), '😀'.repeat(128)])
      expect(
        (
          await client.call({
            action: 'register',
            email: result().user.email,
            password,
            challengeId: '33333333-3333-4333-8333-333333333333',
            code: '123456',
          })
        ).ok,
      ).toBe(true);
    expect(sent).toEqual([' é中文! 😀'.padEnd(19, ' '), '😀'.repeat(128)]);
  });
  it('rejects malformed emails in main even when a renderer bypasses the disabled button', async () => {
    let requests = 0;
    const client = new CloudAccountClient({
      origin,
      vault: vault().port,
      deviceLabel: 'Synthetic',
      fetcher: (async () => {
        requests++;
        return json(result());
      }) as typeof fetch,
    });
    for (const email of [
      '1',
      'a@b',
      'a..b@example.test',
      'a@-bad.test',
      'a@b..test',
      'a\n@example.test',
    ]) {
      expect((await client.call({ action: 'code', purpose: 'register', email })).ok).toBe(false);
      expect(
        (await client.call({ action: 'login', email, password: 'synthetic password 123' })).ok,
      ).toBe(false);
    }
    expect(requests).toBe(0);
  });
  it('requires HTTPS, explicit local development, and a bare origin', () => {
    expect(cloudOrigin('https://api.example.test')).toBe('https://api.example.test');
    for (const url of [
      'http://api.example.test',
      'https://user:pass@example.test',
      'https://example.test/path',
      'https://example.test/?token=secret',
    ])
      expect(cloudOrigin(url, true)).toBeUndefined();
    expect(cloudOrigin('http://127.0.0.1:3000')).toBeUndefined();
    expect(cloudOrigin('http://127.0.0.1:3000', true)).toBe('http://127.0.0.1:3000');
  });
  it('keeps tokens in main-process vault and scopes them to the service origin', async () => {
    const saved = vault();
    const client = new CloudAccountClient({
      origin,
      vault: saved.port,
      deviceLabel: 'Synthetic',
      fetcher: (async () => json(result())) as typeof fetch,
    });
    const logged = await client.call({
      action: 'login',
      email: 'synthetic@example.test',
      password: 'synthetic-password',
    });
    expect(logged.ok).toBe(true);
    expect(logged.state.user?.email).toBe('synthetic@example.test');
    expect(JSON.stringify(logged)).not.toContain('accessToken');
    expect(JSON.stringify(saved.read())).toContain('accessToken');
    let requested = false;
    const other = new CloudAccountClient({
      origin: 'https://other.example.test',
      vault: saved.port,
      deviceLabel: 'Synthetic',
      fetcher: (async () => {
        requested = true;
        return json({});
      }) as typeof fetch,
    });
    expect((await other.call({ action: 'status' })).state.user).toBeNull();
    expect(requested).toBe(false);
    // Origin isolation rejects use without destroying the original recoverable session.
    expect(saved.read()).toMatchObject({ origin, credentials: { sessionId: result().sessionId } });
  });
  it('does not grow a call queue and never retries a refresh mutation automatically', async () => {
    let finish!: (value: Response) => void;
    let count = 0;
    const initial = result();
    initial.expiresAt = 1;
    const saved = vault({ origin, credentials: initial });
    const client = new CloudAccountClient({
      origin,
      vault: saved.port,
      deviceLabel: 'Synthetic',
      fetcher: (async () => {
        count++;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }) as typeof fetch,
    });
    const pending = client.call({ action: 'status' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const rejected = await client.call({ action: 'status' });
    expect(rejected.ok).toBe(false);
    finish(json({ error: { code: 'unauthorized' } }, 401));
    const expired = await pending;
    expect(expired.state.user).toBeNull();
    expect(count).toBe(1);
    expect(saved.read()).toBeNull();
  });
  it('clears a corrupt vault on local logout without leaking raw exceptions', async () => {
    let cleared = false;
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: {
        async read() {
          throw Error('secret-content');
        },
        async write() {},
        async clear() {
          cleared = true;
        },
      },
    });
    const response = await client.call({ action: 'logout' });
    expect(response.ok).toBe(true);
    expect(cleared).toBe(true);
    expect(JSON.stringify(response)).not.toContain('secret-content');
  });
  it('rejects oversized responses and sanitizes server error messages', async () => {
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: vault().port,
      fetcher: (async () =>
        json({ error: { code: 'rate_limited', message: 'server-secret' } }, 429, {
          'retry-after': '3',
        })) as typeof fetch,
    });
    const response = await client.call({
      action: 'code',
      email: 'synthetic@example.test',
      purpose: 'register',
    });
    expect(response.ok).toBe(false);
    expect(JSON.stringify(response)).not.toContain('server-secret');
    if (!response.ok) expect(response.retryAfterSeconds).toBe(3);
    const large = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: vault().port,
      fetcher: (async () => json({ padding: 'x'.repeat(40000) })) as typeof fetch,
    });
    expect(
      (
        await large.call({
          action: 'login',
          email: 'synthetic@example.test',
          password: 'synthetic-password',
        })
      ).ok,
    ).toBe(false);
  });
  it.each([200, 503])('bounds JSON upload responses to 32 KiB (HTTP %i)', async (status) => {
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: vault({ origin, credentials: result() }).port,
      fetcher: (async () => json({ padding: 'x'.repeat(32768) }, status)) as typeof fetch,
    });
    await expect(
      client.api('/v1/uploads/synthetic/parts/0', 'PUT', new Uint8Array([1])),
    ).rejects.toThrow('服务器响应过大');
  });
  it('keeps the binary download limit at one chunk and bounds error JSON separately', async () => {
    let response = new Response(new Uint8Array(1048576));
    const client = new CloudAccountClient({
      origin,
      deviceLabel: 'Synthetic',
      vault: vault({ origin, credentials: result() }).port,
      fetcher: (async () => response) as typeof fetch,
    });
    expect(
      ((await client.api('/v1/backups/synthetic/parts/0', 'GET', undefined, true)) as Uint8Array)
        .byteLength,
    ).toBe(1048576);
    response = new Response(new Uint8Array(1048577));
    await expect(
      client.api('/v1/backups/synthetic/parts/0', 'GET', undefined, true),
    ).rejects.toThrow('云端分块过大');
    response = json({ error: { code: 'busy' }, padding: 'x'.repeat(32768) }, 503);
    await expect(
      client.api('/v1/backups/synthetic/parts/0', 'GET', undefined, true),
    ).rejects.toThrow('服务器响应过大');
  });
});
