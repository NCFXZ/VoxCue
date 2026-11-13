import { spawn } from 'node:child_process';
import {
  isKeychainDenial,
  ProviderCredentialUnavailable,
} from '../../shared/electron/backend/auth/providerCredentialAccess';

// The pinned CLI reads the keyring once for "login status". Its app-server can
// read twice before its first RPC, even if the user denies the first prompt.
export async function codexLoginStatus(
  executable: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
  signal: AbortSignal,
): Promise<'signed-in' | 'empty'> {
  signal.throwIfAborted();
  const child = spawn(
    executable,
    ['-c', 'cli_auth_credentials_store="keyring"', 'login', 'status'],
    {
      ...options,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  const signedIn = Buffer.from('Logged in using ChatGPT');
  const empty = Buffer.from('Not logged in');
  const statusError = Buffer.from('Error checking login status: ');
  // Only a fixed local error line needs its diagnostic classified. Do not
  // retain other CLI output, including identity details from unsupported modes.
  const diagnostic = Buffer.alloc(4096);
  let position = 0,
    matchesSignedIn = true,
    matchesEmpty = true,
    matchesError = true;
  let length = 0;
  let result: 'signed-in' | 'empty' | 'denied' | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    child.kill('SIGKILL');
  };
  const finishLine = () => {
    result =
      matchesSignedIn && position === signedIn.length
        ? 'signed-in'
        : matchesEmpty && position === empty.length
          ? 'empty'
          : matchesError && length > 0 && isKeychainDenial(diagnostic.toString('utf8', 0, length))
            ? 'denied'
            : undefined;
    diagnostic.fill(0, 0, length);
    position = length = 0;
    matchesSignedIn = matchesEmpty = matchesError = true;
  };
  child.stderr.on('data', (chunk: Buffer) => {
    for (const byte of chunk) {
      if (byte === 10) finishLine();
      else {
        matchesSignedIn &&= signedIn[position] === byte;
        matchesEmpty &&= empty[position] === byte;
        if (position < statusError.length) matchesError &&= statusError[position] === byte;
        else if (matchesError && length < diagnostic.length) diagnostic[length++] = byte;
        position++;
      }
    }
  });
  const closed = new Promise<number | null>((resolve) => {
    child.once('error', () => {
      stopped = true;
    });
    child.once('close', resolve);
  });
  const timer = setTimeout(stop, 120_000);
  signal.addEventListener('abort', stop, { once: true });
  try {
    const code = await closed;
    signal.throwIfAborted();
    if (position) finishLine();
    if (!stopped && ((code === 0 && result === 'signed-in') || (code === 1 && result === 'empty')))
      return result;
    throw new ProviderCredentialUnavailable(
      'chatgpt',
      !stopped && code === 1 && result === 'denied' ? 'denied' : 'unavailable',
    );
  } finally {
    diagnostic.fill(0);
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}
