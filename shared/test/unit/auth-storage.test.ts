import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CredentialRecord } from '../../electron/backend/auth/storage';
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
import { createAccountServiceStorage, createCopilotLoginStorage, createServiceSelection } from '../../electron/backend/copilot/storage';
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
  await expect(store.read()).rejects.toMatchObject({
    message: '本地登录信息无效，请检查应用数据。',
    code: 'VOXCUE_CREDENTIAL_INVALID_DATA',
  });
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

const sessionFor = (mode: 'chatgpt' | 'copilot') => ({
  mode, user: { id: 'synthetic', name: 'Example', email: '' }, expiresAt: null,
});
it('retains both saved account services across deactivation and restart, and removes only the signed-out service', async () => {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-account-services-'));
  const accounts = createAccountServiceStorage();
  await Promise.all([
    accounts.set('chatgpt', true, { name: 'Synthetic ChatGPT', email: 'synthetic@example.test' }),
    accounts.set('copilot', true, { name: 'synthetic-github', email: '' }),
  ]);
  const selection = createServiceSelection();
  await selection.set('chatgpt', true);
  await selection.set('chatgpt', false);
  expect(await accounts.list()).toEqual(['chatgpt', 'copilot']);
  await accounts.dispose();
  const restored = createAccountServiceStorage();
  expect(await restored.list()).toEqual(['chatgpt', 'copilot']);
  expect(await restored.details()).toEqual([
    { service: 'chatgpt', name: 'Synthetic ChatGPT', email: 'synthetic@example.test' },
    { service: 'copilot', name: 'synthetic-github', email: '' },
  ]);
  const verify = vi.fn();
  expect(await createServiceSelection().session('startup', verify)).toBeNull();
  expect(verify).not.toHaveBeenCalled();
  await restored.set('copilot', false);
  expect(await restored.list()).toEqual(['chatgpt']);
  const stored = await readFile(path.join(native.directory, 'auth-data/account-services.json'), 'utf8');
  expect(JSON.parse(stored)).toEqual([
    { service: 'chatgpt', name: 'Synthetic ChatGPT', email: 'synthetic@example.test' },
  ]);
  expect(native.decrypt).not.toHaveBeenCalled();
});
it('reads legacy service names and only exposes public identity fields from newer metadata', async () => {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-account-services-'));
  const directory = path.join(native.directory, 'auth-data');
  await mkdir(directory);
  await writeFile(path.join(directory, 'account-services.json'), JSON.stringify([
    'chatgpt', { service: 'copilot', name: 'synthetic-github', email: '', ignored: 'synthetic-extra-field' },
  ]));
  const accounts = createAccountServiceStorage();
  expect(await accounts.details()).toEqual([
    { service: 'chatgpt', name: '', email: '' },
    { service: 'copilot', name: 'synthetic-github', email: '' },
  ]);
  expect(native.decrypt).not.toHaveBeenCalled();
});
it('rejects unknown account metadata and lets an explicit login repair it without reading credentials', async () => {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-account-services-'));
  const directory = path.join(native.directory, 'auth-data');
  await mkdir(directory);
  await writeFile(path.join(directory, 'account-services.json'), '["openai"]');
  const accounts = createAccountServiceStorage();
  await expect(accounts.list()).rejects.toThrow('登录状态记录无效');
  await accounts.set('copilot', true);
  expect(await accounts.list()).toEqual(['copilot']);
  // A new reader confirms the repaired record rather than trusting in-memory state.
  expect(await createAccountServiceStorage().list()).toEqual(['copilot']);
  await accounts.dispose();
  await expect(accounts.set('chatgpt', true)).rejects.toThrow('账号已变化');
  expect(native.decrypt).not.toHaveBeenCalled();
});
async function selectionFile(previous?: unknown) {
  native.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-selection-'));
  const directory = path.join(native.directory, 'auth-data');
  await mkdir(directory);
  const file = path.join(directory, 'service.json');
  if (previous !== undefined) await writeFile(file, JSON.stringify(previous));
  return file;
}

it('fresh and explicitly disconnected installs skip startup; only explicit success enables restore', async () => {
  const file = await selectionFile();
  const state = createServiceSelection();
  const verify = vi.fn(async (service: 'chatgpt' | 'copilot') => sessionFor(service));
  expect(await state.session('startup', verify)).toBeNull();
  expect(verify).not.toHaveBeenCalled();
  expect(await state.session(undefined, verify)).toEqual(sessionFor('chatgpt'));
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  await state.set('chatgpt', false);
  const disconnected = createServiceSelection();
  verify.mockClear();
  expect(await disconnected.session(undefined, verify)).toBeNull();
  expect(await disconnected.session('startup', verify)).toBeNull();
  expect(verify).not.toHaveBeenCalled();
  await disconnected.session('chatgpt', async () => null);
  expect(JSON.parse(await readFile(file, 'utf8')).connected).toBe(false);
  expect(await disconnected.session('chatgpt', verify)).toEqual(sessionFor('chatgpt'));
  expect(await createServiceSelection().session('startup', verify)).toEqual(sessionFor('chatgpt'));
});

it.each(['anthropic', 'glm', 'doubao', 'qwen'])(
  'starts disconnected for a saved %s selection until a supported login succeeds',
  async (service) => {
    const previous = { version: 2, service, connected: true };
    const file = await selectionFile(previous);
    const state = createServiceSelection();
    const verify = vi.fn(async () => sessionFor('copilot'));

    await expect(state.session('startup', verify)).resolves.toBeNull();
    await expect(state.session(undefined, verify)).resolves.toBeNull();
    expect(state.connected).toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(previous);

    await state.set('copilot', true);
    await expect(createServiceSelection().session('startup', verify)).resolves.toEqual(sessionFor('copilot'));
    expect(verify).toHaveBeenCalledExactlyOnceWith('copilot');
  },
);

it('restores a saved Gemini connection through its provider verifier', async () => {
  await selectionFile({ version: 2, service: 'gemini', connected: true });
  const state = createServiceSelection();
  const session = { mode: 'gemini' as const, user: { id: 'gemini', name: 'Gemini API', email: '' }, expiresAt: null };
  const verify = vi.fn(async () => session);
  await expect(state.session('startup', verify)).resolves.toEqual(session);
  expect(verify).toHaveBeenCalledExactlyOnceWith('gemini');
});

it('temporary failure preserves the prior selection, a successful switch ignores late verification', async () => {
  const file = await selectionFile('copilot');
  const state = createServiceSelection();
  const unavailable = vi.fn(async () => { throw Error('temporary'); });
  await expect(state.session('startup', unavailable)).rejects.toThrow('temporary');
  await expect(state.session('startup', unavailable)).rejects.toThrow('temporary');
  expect(unavailable).toHaveBeenCalledTimes(1);
  state.changing(); // Cancelled/failed interactive login to the other provider.
  expect(JSON.parse(await readFile(file, 'utf8'))).toBe('copilot');
  let finish!: (session: null) => void;
  const slow = vi.fn(() => new Promise<null>((resolve) => { finish = resolve; }));
  const old = state.session('startup', slow);
  await vi.waitFor(() => expect(slow).toHaveBeenCalledExactlyOnceWith('copilot'));
  state.changing();
  await state.set('chatgpt', true);
  finish(null);
  expect(await old).toBeNull();
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 2, service: 'chatgpt', connected: true });
  const verify = vi.fn(async (provider: 'chatgpt' | 'copilot') => sessionFor(provider));
  expect(await createServiceSelection().session('startup', verify)).toEqual(sessionFor('chatgpt'));
  expect(verify).toHaveBeenCalledExactlyOnceWith('chatgpt');
});

it('invalid selection fails closed and an explicit successful login repairs it', async () => {
  await selectionFile({ version: 2, service: 'copilot', connected: 'yes' });
  const state = createServiceSelection();
  const verify = vi.fn(async (service: 'chatgpt' | 'copilot') => sessionFor(service));
  await expect(state.session('startup', verify)).rejects.toThrow('选择无效');
  expect(verify).not.toHaveBeenCalled();
  await state.set('copilot', true);
  expect(await state.session('startup', verify)).toEqual(sessionFor('copilot'));
});
