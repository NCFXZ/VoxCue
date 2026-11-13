import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CloudCredentials } from '../../electron/backend/cloud/client';

const native = vi.hoisted(() => ({
  directory: '',
  available: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => native.directory },
  safeStorage: {
    isEncryptionAvailable: native.available,
    encryptString: native.encrypt,
    decryptString: native.decrypt,
  },
}));
import { createCloudVault } from '../../electron/backend/cloud/vault';

const value = {
  origin: 'https://synthetic.example.test',
  credentials: { sessionId: 'synthetic' } as CloudCredentials,
};
const crypto = () => ({
  encrypt: vi.fn(async (text: string) => Buffer.from('fixture:' + text)),
  decrypt: vi.fn(async (bytes: Buffer) => bytes.toString().slice(8)),
});
beforeEach(async () => {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-vault-'));
});
afterEach(async () => {
  await rm(native.directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

it('preserves the last encrypted session and removes staging files when encryption fails', async () => {
  const encryption = crypto(),
    vault = createCloudVault(encryption);
  await vault.write(value);
  const file = path.join(native.directory, 'cloud-account/session.bin'),
    before = await readFile(file);
  encryption.encrypt.mockRejectedValueOnce(Error('synthetic keychain refusal'));
  await expect(vault.write({ ...value, origin: 'https://new.example.test' })).rejects.toThrow(
    'refusal',
  );
  expect(await readFile(file)).toEqual(before);
  expect(await vault.read()).toEqual(value);
  expect(await readdir(path.dirname(file))).toEqual(['session.bin']);
  if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(native.available).not.toHaveBeenCalled();
  expect(native.encrypt).not.toHaveBeenCalled();
});
it('rejects oversized and corrupt ciphertext without invoking a plaintext fallback or replacing it', async () => {
  const encryption = crypto(),
    vault = createCloudVault(encryption);
  await vault.write(value);
  const file = path.join(native.directory, 'cloud-account/session.bin');
  await writeFile(file, Buffer.alloc(16385));
  await expect(vault.read()).rejects.toThrow('Invalid credentials');
  expect(encryption.decrypt).not.toHaveBeenCalled();
  encryption.decrypt.mockRejectedValueOnce(Error('synthetic bad ciphertext'));
  await writeFile(file, Buffer.from('corrupt'));
  await expect(vault.read()).rejects.toThrow('bad ciphertext');
  expect(await readFile(file, 'utf8')).toBe('corrupt');
  await vault.clear();
  expect(await vault.read()).toBeNull();
});
it('never writes a plaintext session when system encryption is unavailable', async () => {
  native.available.mockReturnValue(false);
  await expect(createCloudVault().write(value)).rejects.toThrow('unavailable');
  expect(await readdir(path.join(native.directory, 'cloud-account'))).toEqual([]);
  expect(native.encrypt).not.toHaveBeenCalled();
});
it('does not mistake an encrypted null record for a missing credential file', async () => {
  const encryption = crypto(),
    vault = createCloudVault(encryption);
  await vault.write(value);
  const file = path.join(native.directory, 'cloud-account/session.bin');
  await writeFile(file, 'fixture:null');
  await expect(vault.read()).rejects.toMatchObject({
    message: 'Invalid credentials',
    code: 'VOXCUE_CREDENTIAL_INVALID_DATA',
  });
  expect(await readFile(file, 'utf8')).toBe('fixture:null');
});
it('keeps maintenance reads on the noninteractive port and preserves encrypted recovery bytes', async () => {
  const encryption = crypto(),
    vault = createCloudVault(encryption);
  await vault.write(value);
  const quiet = vi.fn(async () => JSON.stringify(value));
  expect(await vault.read(quiet)).toEqual(value);
  expect(encryption.decrypt).not.toHaveBeenCalled();
  const directory = path.join(native.directory, 'cloud-account');
  const file = path.join(directory, 'session.bin');
  await writeFile(file, 'unreadable encrypted bytes');
  await vault.preserve();
  await vault.write(value);
  const recovery = (await readdir(directory)).filter((name) => name.endsWith('.recovery'));
  expect(recovery).toHaveLength(1);
  expect(await readFile(path.join(directory, recovery[0]), 'utf8')).toBe(
    'unreadable encrypted bytes',
  );
  if (process.platform !== 'win32')
    expect((await stat(path.join(directory, recovery[0]))).mode & 0o777).toBe(0o600);
});
