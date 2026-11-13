import { net } from 'electron';

// Use macOS certificate trust and proxy policy, as other desktop downloads do.
// Account authorization stays explicit; the shared browser session contributes
// no cookies, referrer or cache, and redirects cannot forward credentials.
export const accountFetch: typeof fetch = (input, options) =>
  net.fetch(input instanceof URL ? input.href : input, {
    ...options,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
