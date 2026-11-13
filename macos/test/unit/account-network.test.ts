import { expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: native.fetch } }));
import { accountFetch } from '../../electron/accountNetwork';

it('isolates account requests from browser session state while preserving explicit auth and cancellation', async () => {
  const controller = new AbortController();
  const body = new Uint8Array([1, 2, 3]);
  const headers = { authorization: 'Bearer synthetic-token' };
  const response = new Response('synthetic');
  native.fetch.mockResolvedValueOnce(response);
  expect(
    await accountFetch(new URL('https://accounts.example.test/v1/backups'), {
      method: 'PUT',
      body,
      headers,
      signal: controller.signal,
      credentials: 'include',
      cache: 'force-cache',
      redirect: 'follow',
      referrerPolicy: 'unsafe-url',
    }),
  ).toBe(response);
  const [url, options] = native.fetch.mock.calls[0];
  expect(url).toBe('https://accounts.example.test/v1/backups');
  expect(options).toMatchObject({
    method: 'PUT',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  expect(options.signal).toBe(controller.signal);
  expect(options.body).toBe(body);
  expect(options.headers).toBe(headers);
});
