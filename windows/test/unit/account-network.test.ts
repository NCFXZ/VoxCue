import { expect, it, vi } from 'vitest';
import { windows } from '../../electron/platform';

const nativeFetch = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ net: { fetch: nativeFetch } }));

it('routes the platform account port through Electron without inherited browser policy', async () => {
  const url = new URL('https://accounts.example.test/v1/backups');
  const signal = new AbortController().signal;
  const headers = { authorization: 'Bearer synthetic' };
  const body = new Uint8Array([1, 2, 3]);
  const response = new Response('synthetic');
  nativeFetch.mockResolvedValueOnce(response);
  expect(
    await windows.accountFetch!(url, {
      method: 'PUT',
      body,
      headers,
      signal,
      credentials: 'include',
      cache: 'force-cache',
      redirect: 'follow',
      referrerPolicy: 'unsafe-url',
    }),
  ).toBe(response);
  expect(nativeFetch).toHaveBeenCalledExactlyOnceWith(url.href, {
    method: 'PUT',
    body,
    headers,
    signal,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
});
