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
  it('enforces 15–128 Unicode password characters before registration/reset requests', async () => {
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
      for (const n of [14, 129]) {
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
    expect(requests).toBe(1);
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
});
