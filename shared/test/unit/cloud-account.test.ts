import { describe, it, expect } from 'vitest';
import {
  CloudAccountClient,
  cloudOrigin,
  type CloudVault,
} from '../../electron/backend/cloud/client';

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
    expect(saved.read()).toBeNull();
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
