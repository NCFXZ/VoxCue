import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApiCredentialStore } from '../../electron/backend/api/credentials';

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }));

// Reversible synthetic transform; no OS vault or real credentials are used.
const encryption = () => ({
  encrypt: vi.fn((value: string) => Buffer.from(value).reverse()),
  decrypt: vi.fn((value: Buffer) => Buffer.from(value).reverse().toString()),
});
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-api-keys-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('lists public configuration without decrypting any credentials and isolates profiles', async () => {
  const crypto = encryption();
  const store = new ApiCredentialStore(root, crypto);
  const credential = { key: 'synthetic-credential', region: 'beijing' as const, workspace: 'team' };
  await store.save('qwen', credential);
  const record = await readFile(path.join(root, 'auth-data/api-keys/qwen.json'), 'utf8');
  expect(record).not.toContain(credential.key);
  expect(await store.list()).toEqual([{ provider: 'qwen', region: 'beijing', workspace: 'team' }]);
  expect(crypto.decrypt).not.toHaveBeenCalled();
  expect(await store.read('qwen')).toEqual(credential);
  expect(await new ApiCredentialStore(path.join(root, 'other'), crypto).read('qwen')).toBeNull();
  await store.remove('qwen');
  expect(await store.list()).toEqual([]);
});

it('preserves a previous key when encryption fails or replacement is cancelled', async () => {
  const crypto = encryption();
  const store = new ApiCredentialStore(root, crypto);
  await store.save('openai', { key: 'initial' });
  const blocked = new ApiCredentialStore(root);
  await expect(blocked.save('openai', { key: 'replacement' })).rejects.toThrow('encryption');
  const cancel = new AbortController();
  crypto.encrypt.mockImplementationOnce((value) => {
    cancel.abort();
    return Buffer.from(value).reverse();
  });
  await expect(store.save('openai', { key: 'replacement' }, cancel.signal)).rejects.toThrow();
  expect((await store.read('openai'))?.key).toBe('initial');
  const replacing = store.save('openai', { key: 'later' });
  const removing = store.remove('openai');
  await Promise.all([replacing, removing]);
  expect(await store.read('openai')).toBeNull();
  await store.dispose();
  await expect(store.save('openai', { key: 'late' })).rejects.toThrow();
});

it('rejects invalid key characters, swapped provider files and altered destination metadata', async () => {
  const store = new ApiCredentialStore(root, encryption());
  await expect(store.save('openai', { key: 'a\nb' })).rejects.toThrow();
  await store.save('qwen', { key: 'synthetic', region: 'beijing' });
  const directory = path.join(root, 'auth-data/api-keys');
  const original = JSON.parse(await readFile(path.join(directory, 'qwen.json'), 'utf8'));
  await writeFile(path.join(directory, 'gemini.json'), JSON.stringify(original));
  await expect(store.read('gemini')).rejects.toThrow();
  original.config.region = 'singapore';
  await writeFile(path.join(directory, 'qwen.json'), JSON.stringify(original));
  await expect(store.read('qwen')).rejects.toThrow();
});

it('keeps valid and damaged connections independently available for use or removal', async () => {
  const crypto = encryption();
  const store = new ApiCredentialStore(root, crypto);
  await store.save('openai', { key: 'synthetic' });
  await writeFile(path.join(root, 'auth-data/api-keys/qwen.json'), '{broken');
  expect(await store.list()).toEqual([{ provider: 'openai' }, { provider: 'qwen' }]);
  expect(crypto.decrypt).not.toHaveBeenCalled();
  await expect(store.read('qwen')).rejects.toThrow('API 密钥记录无效');
  expect((await store.read('openai'))?.key).toBe('synthetic');
  await store.remove('qwen');
  expect(await store.list()).toEqual([{ provider: 'openai' }]);
});
