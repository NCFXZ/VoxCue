import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CredentialRecord } from '../../electron/backend/auth/service';
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
import { createAuthStorage } from '../../electron/backend/auth/storage';
import { createCopilotLoginStorage } from '../../electron/backend/copilot/storage';
afterEach(async () => {
  if (native.directory) await rm(native.directory, { recursive: true, force: true });
  native.directory = '';
  vi.clearAllMocks();
});
const record = {
  version: 1,
  clientId: 'oaiapp_fixture',
  subject: 'fixture',
  hostId: 'urn:uuid:fixture',
  name: 'Synthetic',
  email: 'synthetic@example.test',
  expiresAt: 0,
} satisfies CredentialRecord;
it('uses the injected Mac encryption port without accessing Electron Safe Storage', async () => {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-auth-storage-'));
  const encryption = {
    encrypt: vi.fn(async (value: string) => Buffer.from('synthetic:' + value)),
    decrypt: vi.fn(async (value: Buffer) => value.toString().slice(10)),
  };
  const store = createAuthStorage('macOS 钥匙串', encryption);
  expect(await store.read()).toBeNull();
  const host = await store.hostId();
  expect(await store.hostId()).toBe(host);
  await store.write(record);
  expect(await store.read()).toEqual(record);
  const file = path.join(native.directory, 'auth-data/credentials.bin');
  const before = await readFile(file);
  encryption.encrypt.mockRejectedValueOnce(Error('denied'));
  await expect(store.write({ ...record, subject: 'new' })).rejects.toThrow('denied');
  expect(await readFile(file)).toEqual(before);
  encryption.decrypt.mockRejectedValueOnce(Error('locked'));
  await expect(store.read()).rejects.toThrow('locked');
  expect(await readFile(file)).toEqual(before);
  expect(native.available).not.toHaveBeenCalled();
  expect(native.encrypt).not.toHaveBeenCalled();
  expect(native.decrypt).not.toHaveBeenCalled();
});
it('keeps the default Windows/Electron encryption adapter', async () => {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-auth-storage-'));
  native.available.mockReturnValue(true);
  native.encrypt.mockImplementation((value) => Buffer.from('synthetic:' + value));
  native.decrypt.mockImplementation((value) => value.toString().slice(10));
  const store = createAuthStorage();
  await store.write(record);
  expect(await store.read()).toEqual(record);
  native.available.mockReturnValue(false);
  await expect(store.read()).rejects.toThrow('不可用');
  await expect(store.write(record)).rejects.toThrow('未保存');
});
it('uses a supplied noninteractive reader and preserves unreadable ciphertext before recovery', async () => {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-auth-storage-'));
  const encryption = {
    encrypt: vi.fn(async (value: string) => Buffer.from('synthetic:' + value)),
    decrypt: vi.fn(async (value: Buffer) => value.toString().slice(10)),
  };
  const store = createAuthStorage('synthetic', encryption);
  await store.write(record);
  const quiet = vi.fn(async () => JSON.stringify(record));
  expect(await store.read(quiet)).toEqual(record);
  expect(quiet).toHaveBeenCalledOnce();
  expect(encryption.decrypt).not.toHaveBeenCalled();
  const directory = path.join(native.directory, 'auth-data');
  const file = path.join(directory, 'credentials.bin');
  await writeFile(file, 'synthetic:{broken');
  await expect(store.read()).rejects.toThrow();
  await store.write({ ...record, subject: 'recovered' });
  const recovery = (await readdir(directory)).filter((name) => name.endsWith('.recovery'));
  expect(recovery).toHaveLength(1);
  expect(await readFile(path.join(directory, recovery[0]), 'utf8')).toBe('synthetic:{broken');
  expect((await store.read())?.subject).toBe('recovered');
});
it.each([
  { ...record, expiresAt: undefined },
  { ...record, grantedScopes: [1] },
])('rejects a parseable invalid saved record without replacing it', async (invalid) => {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-auth-storage-'));
  const encryption = {
    encrypt: async (value: string) => Buffer.from(value),
    decrypt: async (value: Buffer) => value.toString(),
  };
  const store = createAuthStorage('synthetic', encryption);
  const directory = path.join(native.directory, 'auth-data');
  await mkdir(directory);
  const before = JSON.stringify(invalid);
  await writeFile(path.join(directory, 'credentials.bin'), before);
  await expect(store.read()).rejects.toThrow('无效');
  expect(await readFile(path.join(directory, 'credentials.bin'), 'utf8')).toBe(before);
});
it.each(['credentials.bin', 'copilot-session.json'])(
  'removes only its temporary write when publishing %s fails',
  async (target) => {
    native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-auth-storage-'));
    const directory = path.join(native.directory, 'auth-data');
    await mkdir(path.join(directory, target), { recursive: true });
    await writeFile(path.join(directory, 'unrelated.tmp'), 'preserve');
    const write =
      target === 'credentials.bin'
        ? createAuthStorage('synthetic encryption', {
            encrypt: (value) => Buffer.from('synthetic:' + value),
            decrypt: () => '',
          }).write(record)
        : createCopilotLoginStorage().write(null);
    await expect(write).rejects.toThrow();
    expect((await readdir(directory)).sort()).toEqual([target, 'unrelated.tmp'].sort());
    expect(await readFile(path.join(directory, 'unrelated.tmp'), 'utf8')).toBe('preserve');
  },
);
