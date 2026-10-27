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
