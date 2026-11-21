import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import type { AccountDataCall, AccountImportItem } from '../../electron/contracts/accountData';
import {
  listAccountImportSources,
  openAccountImport,
  closeAccountImport,
  previewAccountImport,
  restoreAccountImport,
} from '../../src/services/accountImport';
import { decodeCloudItem, digestCloudBlob, digestImportRecord, packCloudItem } from '../../src/services/cloudData';
import { historyRepository } from '../../src/services/history';
import { createProfileImportReader } from '../../src/services/profileImportReader';
import { localKnowledge } from '../../src/services/knowledge';
import { useCloudAccount } from '../../src/stores/cloudAccount';
import { migrationSourceOptions } from '../../src/components/AccountMigrationPanel';

it('masks short source addresses and distinguishes identical masked labels without exposing more characters', () => {
  const emails = [
    'a@unit.test', 'b@unit.test', 'ab@unit.test', 'abc@unit.test',
    'source-a@unit.test', 'source-b@unit.test', 'ex***z@unit.test',
  ];
  const sources = emails.map((email, index) => ({ id: 'account:' + index, email }));
  const options = migrationSourceOptions(sources);
  expect(options.map(({ value }) => value)).toEqual(sources.map(({ id }) => id));
  expect(options.map(({ label }) => label)).toEqual([
    '***@unit.test', '***@unit.test (2)', 'a***@unit.test', 'a***@unit.test (2)',
    'so***a@unit.test', 'so***b@unit.test', 'ex***@unit.test',
  ]);
});

const profileKey = 'copilot-personal-info-v1';
const profile = { name: 'Synthetic source', jobDescription: '', background: '' };
const record = {
  id: 'record-1',
  title: 'Source title',
  startedAt: 1,
  endedAt: 2,
  status: 'ended' as const,
  transcripts: [],
  answers: [],
  mock: false,
};
let values: Map<string, string>;
let sourceItems: Map<string, Blob>;
let descriptions: Map<string, Partial<AccountImportItem>>;
let calls: AccountDataCall[];
let closed: boolean | undefined;
let crossAccount: boolean;
let failClose: boolean;
let recoveredRevision: string | null | undefined;
let afterRead: (() => void) | undefined;
let deferredSize: (actual: number) => number | undefined;
let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

beforeEach(() => {
  values = new Map();
  calls = [];
  closed = undefined;
  crossAccount = false;
  failClose = false;
  recoveredRevision = undefined;
  afterRead = undefined;
  deferredSize = actual => actual;
  sourceItems = new Map([
    ['profile:main', packCloudItem('profile:main', JSON.stringify(profile))],
    ['record:record-1', packCloudItem('record:record-1', JSON.stringify(record))],
    [
      'base:base-1',
      packCloudItem('base:base-1', JSON.stringify({ id: 'base-1', name: 'Library', createdAt: 1 })),
    ],
    [
      'file:doc-1',
      packCloudItem('file:doc-1', 'original', {
        id: 'doc-1',
        name: 'note.txt',
        size: 8,
        baseId: 'base-1',
        createdAt: 2,
        type: 'text/plain',
      }),
    ],
  ]);
  descriptions = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', storage);
  useCloudAccount.setState({
    state: {
      user: { id: 'target', email: 'target@example.test', createdAt: 1 },
      configured: true,
      verified: true,
    },
  });
  let unlocked = false;
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      desktop: {
        accountData: async (call: AccountDataCall) => {
          calls.push(call);
          switch (call.action) {
            case 'listImportSources':
              return {
                ok: true,
                sources: [
                  { id: 'local' },
                  { id: 'account:target', email: 'target@example.test' },
                  { id: 'account:source', email: 'source@example.test' },
                ],
              };
            case 'openImport':
              return {
                ok: true,
                token: 'chosen',
                requiresPassword: crossAccount,
                localRevision: useCloudAccount.getState().state.localImportRevision,
              };
            case 'unlockImport':
              if (crossAccount && call.password !== 'Synthetic source password')
                return { ok: false, error: '来源账号密码不正确。' };
              unlocked = true;
              return {
                ok: true,
                ...(recoveredRevision !== undefined && {
                  recoveredMove: true, localRevision: recoveredRevision ?? undefined,
                }),
                items: [...sourceItems].map(([key, blob]) => ({ key, size: blob.size, ...descriptions.get(key) })),
              };
            case 'readImport': {
              if (!unlocked) throw Error('locked');
              const blob = sourceItems.get(call.key)!;
              const bytes = new Uint8Array(
                await blob.slice(call.offset, call.offset + 1048576).arrayBuffer(),
              );
              afterRead?.();
              return { ok: true, bytes, ...(call.offset === 0 && descriptions.get(call.key)?.size === 0
                ? { size: deferredSize(blob.size) } : {}) };
            }
            case 'digestImportItem': {
              const item = await decodeCloudItem(call.key, sourceItems.get(call.key)!);
              if (item.type === 'record') return { ok: true, digest: await digestImportRecord(item.record) };
              if (item.type === 'file' || item.type === 'resume')
                return { ok: true, digest: await digestCloudBlob(item.document.blob) };
              throw Error('unexpected digest');
            }
            case 'prepareImportCommit':
              return { ok: true };
            case 'closeImport':
              closed = call.committed;
              if (failClose) throw Error('close failed');
              return { ok: true, localRevision: '4350e4aa-bec7-47c3-b45a-62768637be60' };
            default:
              throw Error('Unexpected action');
          }
        },
      },
    }),
  );
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([true, false])('preserves library-prefixed titles with both migration manifests, deferred=%s', async (deferred) => {
  const key = 'record:' + record.id, name = '库'.repeat(60);
  const generated = { ...record, knowledgeBaseName: name, titleSource: 'generated' as const,
    title: '「' + name + '」' + '题'.repeat(80) };
  await historyRepository.save(generated);
  const reader = await createProfileImportReader();
  const manifest = reader.items.find(item => item.key === key)!;
  expect(manifest).toMatchObject({ size: 0, recordTitle: generated.title, recordLibraryName: name });
  vi.stubGlobal('indexedDB', new IDBFactory());
  sourceItems.clear();
  sourceItems.set(key, packCloudItem(key, JSON.stringify(generated)));
  if (deferred) descriptions.set(key, manifest);
  const selection = await openAccountImport('local');
  const { entries } = await previewAccountImport(selection, undefined, () => true);
  expect(entries).toMatchObject([{ key, title: generated.title }]);
  if (deferred) expect(calls.some(call => call.action === 'readImport')).toBe(false);
  await restoreAccountImport(selection, [key], [], () => true);
  expect(await historyRepository.get(record.id)).toEqual(generated);
  await expect(historyRepository.rename(record.id, generated.title)).rejects.toThrow();
  for (const change of [{ titleSource: 'manual' }, { knowledgeBaseName: '另一库' }, { title: generated.title + '长' }]) {
    await expect(decodeCloudItem(key, packCloudItem(key, JSON.stringify({ ...generated, ...change })))).rejects.toThrow('标题无效');
  }
});

it('previews large originals and interview titles without transferring their bodies until selected', async () => {
  const key = 'file:doc-1', bytes = new Uint8Array(12 * 1024 ** 2);
  const document = { id: 'doc-1', baseId: 'base-1', name: 'source.txt', size: bytes.length, type: 'text/plain', createdAt: 2 };
  sourceItems.set(key, packCloudItem(key, bytes, document));
  descriptions.set(key, { document });
  descriptions.set('record:record-1', { recordTitle: record.title });
  const session = await openAccountImport('local');
  const { entries } = await previewAccountImport(session, undefined, () => true);
  expect(entries.map(e => e.key)).toEqual(expect.arrayContaining(['record:record-1', 'base:base-1']));
  const reads = () => calls.filter(c => c.action === 'readImport').map(c => c.key);
  expect(reads()).not.toContain(key);
  expect(reads()).not.toContain('record:record-1');
  await restoreAccountImport(session, ['base:base-1'], [], () => true);
  expect(reads().filter(k => k === key)).toHaveLength(13);
  expect(reads()).not.toContain('record:record-1');
  const [restored] = await localKnowledge.listDocuments('base-1');
  expect(restored.blob.size).toBe(bytes.length);
  expect(await historyRepository.list()).toEqual([]);
});

it('compares a matching interview by stable digest before transferring only the confirmed body', async () => {
  const key = 'record:record-1';
  descriptions.set(key, { recordTitle: record.title });
  await historyRepository.save({ ...record, endedAt: 3 });
  const selection = await openAccountImport('local');
  const { entries } = await previewAccountImport(selection, undefined, () => true);
  expect(entries.find(e => e.key === key)?.conflict).toBe(true);
  expect(calls.some(c => c.action === 'digestImportItem' && c.key === key)).toBe(true);
  expect(calls.some(c => c.action === 'readImport' && c.key === key)).toBe(false);
  await restoreAccountImport(selection, [key], [key], () => true);
  expect((await historyRepository.list())[0].endedAt).toBe(2);
});

it('transfers a record whose envelope size was omitted from the preview', async () => {
  const key = 'record:record-1';
  descriptions.set(key, { recordTitle: record.title, size: 0 });
  const selection = await openAccountImport('local');
  await previewAccountImport(selection, undefined, () => true);
  expect(calls.some(c => c.action === 'readImport' && c.key === key)).toBe(false);
  await restoreAccountImport(selection, [key], [], () => true);
  expect(await historyRepository.get(record.id)).toEqual(record);
});

it.each([undefined, 7, 64 * 1024 ** 2 + 1])('rejects an invalid deferred record envelope size of %s', async size => {
  const key = 'record:record-1';
  descriptions.set(key, { recordTitle: record.title, size: 0 });
  deferredSize = () => size;
  const selection = await openAccountImport('local');
  await previewAccountImport(selection, undefined, () => true);
  await expect(restoreAccountImport(selection, [key], [], () => true)).rejects.toThrow('迁移资料无效');
  expect(calls.some(c => c.action === 'prepareImportCommit')).toBe(false);
});

it('counts the first deferred record chunk against the other source envelopes', async () => {
  const key = 'record:record-1', blob = sourceItems.get(key)!;
  sourceItems.clear();
  sourceItems.set(key, blob);
  descriptions.set(key, { recordTitle: record.title, size: 0 });
  for (let i = 0; i < 8; i++) {
    const filler = 'record:budget-' + i;
    sourceItems.set(filler, new Blob());
    descriptions.set(filler, { recordTitle: 'Budget', size: 64 * 1024 ** 2 });
  }
  const selection = await openAccountImport('local');
  await previewAccountImport(selection, undefined, () => true);
  await expect(restoreAccountImport(selection, [key], [], () => true)).rejects.toThrow('迁移资料无效');
  expect(calls.some(c => c.action === 'prepareImportCommit')).toBe(false);
});

async function run(password?: string) {
  const selection = await openAccountImport(crossAccount ? 'account:source' : 'local');
  const { entries } = await previewAccountImport(selection, password, () => true).catch(
    async (error) => {
      await closeAccountImport(selection.token);
      throw error;
    },
  );
  await restoreAccountImport(
    selection,
    entries.map((entry) => entry.key),
    entries.filter((entry) => entry.conflict).map((entry) => entry.key),
    () => true,
  );
}

it('lists other accounts on this device and rejects the current account even if selected directly', async () => {
  expect(await listAccountImportSources()).toEqual([
    { id: 'local' },
    { id: 'account:source', email: 'source@example.test' },
  ]);
  await expect(openAccountImport('account:target')).rejects.toThrow('其他来源账号');
  useCloudAccount.setState({
    state: { localMode: true, user: null, configured: true, verified: false },
  });
  expect((await listAccountImportSources()).map((source) => source.id)).toEqual([
    'account:target',
    'account:source',
  ]);
  await expect(openAccountImport('local')).rejects.toThrow('其他来源账号');
  expect(calls.every((call) => call.action === 'listImportSources')).toBe(true);
});

it('merges the on-device local account without a password, replaces a confirmed conflict and handles a repeat', async () => {
  await historyRepository.save({ ...record, title: 'My edited title' });
  await run();
  await run();
  expect(closed).toBe(true);
  expect(JSON.parse(values.get(profileKey)!)).toEqual(profile);
  expect((await historyRepository.list()).map((entry) => entry.title)).toEqual(['Source title']);
  const docs = await localKnowledge.listDocuments('base-1');
  expect(docs).toHaveLength(1);
  expect(await docs[0].blob.text()).toBe('original');
  expect(calls.filter((call) => call.action === 'unlockImport')).toEqual([
    { action: 'unlockImport', token: 'chosen', password: undefined },
    { action: 'unlockImport', token: 'chosen', password: undefined },
  ]);
});

it('does not request data or write anything until the source password is accepted', async () => {
  crossAccount = true;
  await expect(run('Synthetic target password')).rejects.toThrow('密码');
  expect(calls.some((call) => call.action === 'readImport')).toBe(false);
  expect(values.size).toBe(0);
  await run('Synthetic source password');
  expect(closed).toBe(true);
  expect(await historyRepository.list()).toHaveLength(1);
});

it('rejects a repeated commit without closing the first operation or publishing twice', async () => {
  const selection = await openAccountImport('local');
  const { entries } = await previewAccountImport(selection, undefined, () => true);
  const keys = entries.map((entry) => entry.key);
  const first = restoreAccountImport(selection, keys, [], () => true);
  await expect(restoreAccountImport(selection, keys, [], () => true)).rejects.toThrow(
    '资料操作正在进行',
  );
  await first;
  expect(calls.filter((call) => call.action === 'prepareImportCommit')).toHaveLength(1);
  expect(calls.filter((call) => call.action === 'closeImport')).toHaveLength(1);
});

it('binds confirmation to the original preview and omits native media from a personal-field-only import', async () => {
  values.set(profileKey, JSON.stringify({ ...profile, name: 'Current name' }));
  const session = await openAccountImport('local');
  const { entries } = await previewAccountImport(session, undefined, () => true);
  const name = entries.find((entry) => entry.group === 'profile' && entry.conflict)!;
  expect(name).toBeDefined();
  name.conflict = false;
  await expect(restoreAccountImport(session, [name.key], [], () => true)).rejects.toThrow(
    '确认覆盖',
  );
  expect(calls.some((call) => call.action === 'prepareImportCommit')).toBe(false);
  expect(JSON.parse(values.get(profileKey)!).name).toBe('Current name');

  const retry = await openAccountImport('local');
  await previewAccountImport(retry, undefined, () => true);
  await restoreAccountImport(retry, [name.key], [name.key], () => true);
  expect(JSON.parse(values.get(profileKey)!).name).toBe(profile.name);
  expect(await historyRepository.list()).toEqual([]);
  expect(await localKnowledge.listBases()).toEqual([]);
  expect(calls.filter((call) => call.action === 'prepareImportCommit')).toEqual([
    { action: 'prepareImportCommit', token: 'chosen', keys: [name.key], recordIds: [], imageIds: [] },
  ]);
});

it('closes a cloud source without reading its data if the password requirement is missing', async () => {
  await expect(openAccountImport('account:source')).rejects.toThrow('迁移资料无效');
  expect(calls).toEqual([
    { action: 'openImport', sourceId: 'account:source' },
    { action: 'closeImport', token: 'chosen', committed: false },
  ]);
  expect(values.size).toBe(0);
});

it('rejects an invalid final entry before publishing earlier items', async () => {
  sourceItems.set('profile:invalid', packCloudItem('profile:invalid', '{}'));
  await expect(run()).rejects.toThrow();
  expect(closed).toBe(false);
  expect(values.size).toBe(0);
  expect(await localKnowledge.listBases()).toEqual([]);
});

it('keeps the local reminder until the matching import finishes closing', async () => {
  const revision = '08065f1e-f3a3-4899-816d-f1866071ead5';
  useCloudAccount.setState({
    state: {
      user: { id: 'synthetic', email: 'test@example.test', createdAt: 1 },
      verified: true,
      configured: true,
      localImportRevision: revision,
    },
  });
  failClose = true;
  await expect(run()).rejects.toThrow('close failed');
  expect(values.has('voxcue-handled-local-import-v1')).toBe(false);
  failClose = false;
  await run();
  expect(values.get('voxcue-handled-local-import-v1')).toBe('4350e4aa-bec7-47c3-b45a-62768637be60');
  expect(useCloudAccount.getState().state.localImportRevision).toBe(values.get('voxcue-handled-local-import-v1'));
});

it.each([null, 'd96355b5-c6a6-42d9-9299-ff679b04a970'])(
  'reflects the remaining local revision after retrying source cleanup (%s)', async (remaining) => {
    const previous = '08065f1e-f3a3-4899-816d-f1866071ead5';
    useCloudAccount.setState(({ state }) => ({ state: { ...state, localImportRevision: previous } }));
    recoveredRevision = remaining;
    if (!remaining) sourceItems.clear();
    const selection = await openAccountImport('local');
    const preview = await previewAccountImport(selection, undefined, () => true);
    expect(preview.recoveredMove).toBe(true);
    expect(preview.entries.length > 0).toBe(Boolean(remaining));
    expect(useCloudAccount.getState().state.localImportRevision).toBe(remaining ?? undefined);
    expect(calls.some(call => call.action === 'prepareImportCommit')).toBe(false);
    if (remaining) {
      expect(values.get('voxcue-handled-local-import-v1')).toBe(remaining);
      await restoreAccountImport(selection, [preview.entries[0].key], [], () => true);
      expect(useCloudAccount.getState().state.localImportRevision).toBe('4350e4aa-bec7-47c3-b45a-62768637be60');
    } else {
      await closeAccountImport(selection.token);
    }
  },
);

it('aborts the originals transaction and restores the previous profile if history exceeds quota', async () => {
  const existing = JSON.stringify({ ...profile, name: 'Current user' });
  values.set(profileKey, existing);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (this.name === 'interviewRecords') throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    return put.apply(this, args);
  });
  await expect(run()).rejects.toThrow('QuotaExceededError');
  expect(closed).toBe(false);
  expect(values.get(profileKey)).toBe(existing);
  expect(await historyRepository.list()).toEqual([]);
  expect(await localKnowledge.listBases()).toEqual([]);
});

it('discards an import on an account switch during a file read', async () => {
  afterRead = () =>
    useCloudAccount.setState({ state: { configured: true, verified: false, user: null } });
  await expect(run()).rejects.toThrow('账号已变化');
  expect(closed).toBe(false);
  expect(values.size).toBe(0);
  expect(await localKnowledge.listBases()).toEqual([]);
});
