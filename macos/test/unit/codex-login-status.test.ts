import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { codexLoginStatus } from '../../electron/codexLoginStatus';
import { ProviderCredentialUnavailable } from '../../../shared/electron/backend/auth/providerCredentialAccess';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

function start() {
  const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const controller = new AbortController();
  const result = codexLoginStatus('fixture', { cwd: '/temp', env: {} }, controller.signal);
  return { result, child, controller };
}

it.each([
  [0, ['Logged in using ', 'ChatGPT\n'], 'signed-in'],
  [1, ['Not logged in\n'], 'empty'],
] as const)('recognizes a complete status with exit code %s', async (code, chunks, status) => {
  const { result, child } = start();
  for (const chunk of chunks) child.stderr.write(chunk);
  child.emit('close', code);
  await expect(result).resolves.toBe(status);
});

it.each([
  [
    [
      'Error checking login status: failed to load CLI auth from keyring: Platform secure storage failure: The user name or passphrase ',
      'you entered is not correct.\n',
    ],
    'denied',
  ],
  [
    ['Error checking login status: failed to load CLI auth from keyring: OSStatus -128\n'],
    'denied',
  ],
  [
    [
      'Error checking login status: failed to load CLI auth from keyring: synthetic-private unknown error\n',
    ],
    'unavailable',
  ],
  [['Error checking login status: OSStatus -25308\n'], 'unavailable'],
  [['Error checking login status: HTTP 403 Forbidden\n'], 'unavailable'],
  [['API key configured - synthetic-private\n'], 'unavailable'],
] as const)('classifies only explicit local keyring denials (%s)', async (chunks, reason) => {
  const { result, child } = start();
  for (const chunk of chunks) child.stderr.write(chunk);
  child.emit('close', 1);
  const error = await result.catch((error) => error);
  expect(error).toBeInstanceOf(ProviderCredentialUnavailable);
  expect(error.reason).toBe(reason);
  expect(error.message).not.toContain('synthetic-private');
});
it('reports a preflight deadline as unavailable', async () => {
  vi.useFakeTimers();
  try {
    const { result, child } = start();
    await vi.advanceTimersByTimeAsync(120000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null);
    await expect(result).rejects.toMatchObject({ reason: 'unavailable' });
  } finally {
    vi.useRealTimers();
  }
});

it('cancels the pending child before resolving a status', async () => {
  const { result, child, controller } = start();
  controller.abort();
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  child.stderr.write('Logged in using ChatGPT\n');
  child.emit('close', 0);
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});
