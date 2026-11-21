import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  historyRepository as history, historyStoreNames, historyStorageKey, readExistingHistory, type InterviewRecord,
} from '../../src/services/history';
import { openDocumentsDatabase } from '../../src/services/documentsDatabase';

let values: Map<string, string>;
const record = (id: string, text = '合成资料'): InterviewRecord => ({
  id, title: id, startedAt: 1, endedAt: 2, status: 'ended', mock: false,
  answers: [{ id: 'a', question: '问题', content: text, provider: 'chatgpt' }],
  transcripts: [{ id: 't', text, time: '00:01', final: true }],
});
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reads legacy sources without changing them and migrates verified rows before dropping the old copy', async () => {
  const row = record('original');
  values.set(historyStorageKey, JSON.stringify([row]));
  const legacy = indexedDB.open('copilot-local-documents', 1);
  legacy.onupgradeneeded = () => {
    legacy.result.createObjectStore('bases', { keyPath: 'id' });
    const docs = legacy.result.createObjectStore('documents', { keyPath: 'id' });
    docs.createIndex('baseId', 'baseId');
  };
  await new Promise<void>((resolve, reject) => {
    legacy.onsuccess = () => { legacy.result.close(); resolve(); };
    legacy.onerror = () => reject(legacy.error);
  });
  expect(await readExistingHistory()).toEqual([row]);
  expect((await indexedDB.databases())[0].version).toBe(1);
  expect(values.has(historyStorageKey)).toBe(true);
  expect(await history.summaries()).toEqual([expect.objectContaining({ id: row.id, answerCount: 1 })]);
  expect(values.has(historyStorageKey)).toBe(false);
  expect(await history.get(row.id)).toEqual(row);
  expect(await readExistingHistory()).toEqual([row]);
  const db = await openDocumentsDatabase();
  expect(db.objectStoreNames.contains('documents')).toBe(true);
  db.close();
});

it('aborts a failed migration without exposing a partial directory or deleting old data', async () => {
  const rows = [record('one'), record('two')];
  values.set(historyStorageKey, JSON.stringify(rows));
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, row, key) {
    if (this.name === historyStoreNames[1] && row.id === 'two') throw Error('synthetic storage failure');
    return put.call(this, row, key);
  });
  await expect(history.summaries()).rejects.toThrow('synthetic');
  expect(JSON.parse(values.get(historyStorageKey)!)).toEqual(rows);
  failure.mockRestore();
  const db = await openDocumentsDatabase();
  const req = db.transaction(historyStoreNames[0]).objectStore(historyStoreNames[0]).count();
  const count = await new Promise<number>(resolve => { req.onsuccess = () => resolve(req.result); });
  expect(count).toBe(0);
  db.close();
  expect(await history.list()).toEqual(rows);
});

it('writes per record after migration, only reads metadata for lists and keeps a stable revision on identical saves', async () => {
  const row = record('one');
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw Error('localStorage full'); });
  await Promise.all([history.save(row), history.save(record('two'))]);
  const fullReads = vi.spyOn(IDBObjectStore.prototype, 'getAll');
  const [summary] = await history.summaries();
  expect(fullReads.mock.instances.map(store => store.name)).toEqual([historyStoreNames[1]]);
  expect(summary).not.toHaveProperty('answers');
  expect(summary).not.toHaveProperty('transcripts');
  await history.save(row);
  expect((await history.summary('one'))?.revision).toBe(summary.revision);
  await history.rename('one', '手工标题');
  expect((await history.summary('one'))?.revision).not.toBe(summary.revision);
  const exported = JSON.parse(JSON.stringify(await history.get('one')));
  await history.save({ ...exported, endedAt: 3 }, { expected: exported });
  await history.save({ ...row, endedAt: 3 });
  expect(await history.get('one')).toMatchObject({ title: '手工标题', endedAt: 3 });
  expect(await history.get('two')).toBeDefined();
});

it('guards a single record inside the write transaction and leaves unrelated concurrent writes intact', async () => {
  const original = record('r');
  await history.save(original);
  await history.save({ ...original, endedAt: 3 });
  await expect(history.save(record('r', '远端内容'), { expected: original })).rejects.toThrow('修改');
  await Promise.all([history.save(record('x')), history.save(record('y'))]);
  await history.mergeMissing([record('r', '旧资料'), record('z')]);
  expect((await history.list()).map(r => r.id).sort()).toEqual(['r', 'x', 'y', 'z']);
  expect((await history.get('r'))?.endedAt).toBe(3);
  await history.remove('r');
  expect(await history.updateTitle('r', r => ({ ...r, title: '迟到标题' }))).toBeUndefined();
  expect(await history.get('r')).toBeUndefined();
});
