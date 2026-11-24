import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { profileDirectory } from '../../electron/accountProfilePaths';
import {
  ApiCredentialStore, readApiKeyRecords, removeRetiredApiKeyRecords,
} from '../../electron/backend/api/credentials';

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
  const credential = { key: 'synthetic-credential' };
  await store.save('deepseek', credential);
  const record = await readFile(path.join(root, 'auth-data/api-keys/deepseek.json'), 'utf8');
  expect(record).not.toContain(credential.key);
  expect(JSON.parse(record)).toMatchObject({ version: 1, config: { provider: 'deepseek' } });
  expect(await store.list()).toEqual([{ provider: 'deepseek' }]);
  expect(crypto.decrypt).not.toHaveBeenCalled();
  expect(await store.read('deepseek')).toEqual(credential);
  expect(await new ApiCredentialStore(path.join(root, 'other'), crypto).read('deepseek')).toBeNull();
  await store.remove('deepseek');
  expect(await store.list()).toEqual([]);
});

it('unlinks each retired API credential across the local and cloud profiles on this device', async () => {
  const crypto = encryption();
  const retiredNames = [
    'anthropic.json', 'doubao.json', 'gemini.json', 'glm.json', 'kimi.json',
    'qwen.json', 'qwen-ai-payg.json',
  ];
  const directories: string[] = [];
  for (const owner of ['local', 'account:00000000-0000-4000-8000-000000000001']) {
    const profile = profileDirectory(root, owner);
    const store = new ApiCredentialStore(profile, crypto);
    await store.save('openai', { key: 'synthetic' });
    await store.save('deepseek', { key: 'synthetic' });
    const directory = path.join(profile, 'auth-data', 'api-keys');
    directories.push(directory);
    for (const name of retiredNames)
      await writeFile(path.join(directory, name), Buffer.from([0, 255, 0, 255]));
    expect(await store.list()).toEqual([{ provider: 'openai' }, { provider: 'deepseek' }]);
  }
  const unowned = path.join(root, 'account-profiles', 'not-a-profile', 'auth-data', 'api-keys');
  await mkdir(unowned, { recursive: true });
  await writeFile(path.join(unowned, 'qwen.json'), 'outside profile scope');

  await removeRetiredApiKeyRecords(root);
  await removeRetiredApiKeyRecords(root);
  expect(crypto.decrypt).not.toHaveBeenCalled();
  for (const directory of directories)
    expect((await readdir(directory)).sort()).toEqual(['deepseek.json', 'openai.json']);
  expect(await readFile(path.join(unowned, 'qwen.json'), 'utf8')).toBe('outside profile scope');
  await expect(readApiKeyRecords(root, async value => crypto.decrypt(value))).resolves.toBe(true);
  expect(crypto.decrypt).toHaveBeenCalledTimes(4);
});

it('preserves unknown records in the app directory and defers historical system-key cleanup', async () => {
  const decrypt = vi.fn();
  const directory = path.join(profileDirectory(root, 'local'), 'auth-data', 'api-keys');
  await mkdir(directory, { recursive: true });
  const unknown = path.join(directory, 'qwen.json.backup');
  await writeFile(unknown, 'synthetic unknown record');
  await writeFile(path.join(directory, 'qwen.json'), 'synthetic retired record');
  await removeRetiredApiKeyRecords(root);
  expect(await readdir(directory)).toEqual(['qwen.json.backup']);
  expect(await readFile(unknown, 'utf8')).toBe('synthetic unknown record');
  await expect(readApiKeyRecords(root, decrypt)).rejects.toThrow('API 密钥记录无效');
  expect(decrypt).not.toHaveBeenCalled();
});

it('keeps a directory that mimics a retired credential name and removes sibling retired files', async () => {
  const directory = path.join(profileDirectory(root, 'local'), 'auth-data', 'api-keys');
  const blocked = path.join(directory, 'qwen.json');
  await mkdir(blocked, { recursive: true });
  const nested = path.join(blocked, 'keep.txt');
  await writeFile(nested, 'synthetic nested data');
  await writeFile(path.join(directory, 'qwen-ai-payg.json'), 'synthetic retired record');
  await expect(removeRetiredApiKeyRecords(root)).rejects.toThrow('API 密钥记录无效');
  expect(await readFile(nested, 'utf8')).toBe('synthetic nested data');
  expect(await readdir(directory)).toEqual(['qwen.json']);
});

it('refuses a redirected API-key directory and continues cleanup in an independent profile', async () => {
  const auth = path.join(profileDirectory(root, 'local'), 'auth-data');
  const redirected = path.join(root, 'unrelated-directory');
  await mkdir(auth, { recursive: true });
  await mkdir(redirected);
  const record = path.join(redirected, 'qwen-ai-payg.json');
  await writeFile(record, 'synthetic redirected data');
  await symlink(redirected, path.join(auth, 'api-keys'), 'junction');
  const valid = path.join(profileDirectory(root, 'account:00000000-0000-4000-8000-000000000001'),
    'auth-data', 'api-keys');
  await mkdir(valid, { recursive: true });
  await writeFile(path.join(valid, 'qwen.json'), 'synthetic retired record');

  await expect(removeRetiredApiKeyRecords(root)).rejects.toThrow('API 密钥记录无效');
  expect(await readFile(record, 'utf8')).toBe('synthetic redirected data');
  expect(await readdir(valid)).toEqual([]);
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
  await store.save('deepseek', { key: 'synthetic' });
  const directory = path.join(root, 'auth-data/api-keys');
  const original = JSON.parse(await readFile(path.join(directory, 'deepseek.json'), 'utf8'));
  await writeFile(path.join(directory, 'openai.json'), JSON.stringify(original));
  await expect(store.read('openai')).rejects.toThrow();
  original.config.endpoint = 'https://example.invalid';
  await writeFile(path.join(directory, 'deepseek.json'), JSON.stringify(original));
  await expect(store.read('deepseek')).rejects.toThrow();
});

it('keeps valid and damaged connections independently available for use or removal', async () => {
  const crypto = encryption();
  const store = new ApiCredentialStore(root, crypto);
  await store.save('openai', { key: 'synthetic' });
  await writeFile(path.join(root, 'auth-data/api-keys/deepseek.json'), '{broken');
  expect(await store.list()).toEqual([{ provider: 'openai' }, { provider: 'deepseek' }]);
  expect(crypto.decrypt).not.toHaveBeenCalled();
  await expect(store.read('deepseek')).rejects.toThrow('API 密钥记录无效');
  expect((await store.read('openai'))?.key).toBe('synthetic');
  await store.remove('deepseek');
  expect(await store.list()).toEqual([{ provider: 'openai' }]);
});
