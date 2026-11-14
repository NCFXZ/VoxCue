import { net } from 'electron';

// Use the Windows system proxy and certificate trust for account and telemetry requests.
// Authentication comes from the caller's explicit headers, independent of browser cookies.
export const accountFetch: typeof fetch = (input, options) =>
  net.fetch(input instanceof URL ? input.href : input, {
    ...options,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
