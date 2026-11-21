import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  buildImportPlan,
  prepareImportWrites,
  type ImportPayload,
} from '../../src/services/accountImportPlan';
import { historyRepository, recoverLocalHistoryImages, type InterviewRecord } from '../../src/services/history';
import { localKnowledge, openDocumentsDatabase } from '../../src/services/knowledge';
import type { LocalDocument } from '../../src/services/knowledgeTypes';
import { profileStorageKey } from '../../src/services/storedValues';
import { markBaseRemoval } from '../../src/services/knowledgeIndex';

const guard = () => {};
const info = { name: 'Source', jobDescription: 'Source job', background: '' };
const sourceBase = { id: 'source', name: 'Library', createdAt: 1 };
const sourceRecord: InterviewRecord = {
  id: 'interview',
  title: 'A title',
  startedAt: 1,
  endedAt: 2,
  status: 'ended',
  transcripts: [],
  answers: [],
  mock: false,
};
const file = (id: string, baseId: string, name: string, content: string): LocalDocument => ({
  id,
  baseId,
  name,
  blob: new Blob([content]),
  size: new Blob([content]).size,
  createdAt: 5,
  type: 'text/plain',
});
async function seedDocuments(...docs: LocalDocument[]) {
  const db = await openDocumentsDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      docs.forEach((doc) => tx.objectStore('documents').put(doc));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function prepare(items: ImportPayload[], keys: string[]) {
  const preview = await buildImportPlan(items, guard);
  return { preview, writes: await prepareImportWrites(preview, keys, guard) };
}
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])('迁移覆盖记录时只在目标历史成功提交后清理原截图，写入中止=%s', async (abort) => {
  const id = '00000000-0000-4000-8000-000000000123';
  const previous = { ...sourceRecord, answers: [{ id: 'a', question: '', content: '', images: [{ id }] }] };
  await historyRepository.save(previous);
  const { writes } = await prepare([{ type: 'record', record: sourceRecord, images: [] }], ['record:interview']);
  const remove = vi.fn(async () => ({ ok: true }));
  Object.assign(window, { desktop: { interviewImage: remove } });
  if (abort) {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'interviewRecords') throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await expect(writes.commit()).rejects.toThrow('QuotaExceededError');
  } else await writes.commit();
  await recoverLocalHistoryImages();
  expect(await historyRepository.list()).toEqual([abort ? previous : sourceRecord]);
  expect(remove.mock.calls).toEqual(abort ? [] : [[{ op: 'remove', ids: [id] }]]);
});

it('refuses to acknowledge a move into a library awaiting deletion, even when the destination already matches', async () => {
  await localKnowledge.saveBase(sourceBase);
  const { writes } = await prepare([{ type: 'base', base: sourceBase }], ['base:' + sourceBase.id]);
  markBaseRemoval(sourceBase.id, true);
  await expect(writes.commit()).rejects.toThrow('正在删除');
  const { writes: unrelated } = await prepare([{ type: 'profile', profile: info }], ['profile:name']);
  await unrelated.commit();
  expect(JSON.parse(storage.get(profileStorageKey)!).name).toBe(info.name);
});

it('previews only supplied profile fields and merges only the checked ones into the latest profile', async () => {
  const current = { ...info, name: 'Target', jobDescription: 'Source job', background: 'Retained' };
  storage.set(profileStorageKey, JSON.stringify(current));
  const { preview, writes } = await prepare([{ type: 'profile', profile: info }], ['profile:name']);
  expect(preview.entries).toEqual([
    { key: 'profile:name', group: 'profile', title: '姓名', conflict: true },
    { key: 'profile:jobDescription', group: 'profile', title: '职位描述摘要', conflict: false },
  ]);
  expect(await indexedDB.databases()).toEqual([]);
  storage.set(
    profileStorageKey,
    JSON.stringify({ ...current, background: 'Edited after preview' }),
  );
  await writes.commit();
  expect(JSON.parse(storage.get(profileStorageKey)!)).toEqual({
    ...current,
    name: info.name,
    background: 'Edited after preview',
  });
});

it('compares semantic profile values without considering generated skill IDs', async () => {
  const skill = { id: 'old', title: 'Control', content: 'Calibration', sources: [] };
  storage.set(profileStorageKey, JSON.stringify({ ...info, skills: [skill] }));
  const { preview, writes } = await prepare(
    [{ type: 'profile', profile: { ...info, skills: [{ ...skill, id: 'other' }] } }],
    ['profile:skills'],
  );
  expect(preview.entries.find((entry) => entry.key === 'profile:skills')?.conflict).toBe(false);
  await writes.commit();
  expect(JSON.parse(storage.get(profileStorageKey)!).skills[0].id).toBe('old');
});

it('uses stable record IDs, compares content independent of JSON key order, and scopes native media to selected interviews', async () => {
  const first = { ...sourceRecord, title: 'Same title' };
  const second = { ...first, id: 'second' };
  const third = { ...first, id: 'third' };
  await historyRepository.save({ ...first, title: 'Target edit' });
  await historyRepository.save(Object.fromEntries(Object.entries(third).reverse()) as InterviewRecord);
  const { preview, writes } = await prepare(
    [
      { type: 'record', record: first, images: ['photo-a'] },
      { type: 'record', record: second, images: ['photo-b'] },
      { type: 'record', record: third, images: [] },
    ],
    ['record:second', 'record:interview'],
  );
  expect(preview.entries.map((entry) => [entry.key, entry.title, entry.conflict])).toEqual([
    ['record:interview', 'Same title', true],
    ['record:second', 'Same title', false],
    ['record:third', 'Same title', false],
  ]);
  expect(writes.recordIds).toEqual(['second', 'interview']);
  expect(writes.imageIds).toEqual(['photo-b', 'photo-a']);
  await writes.commit();
  expect(
    (await historyRepository.list())
      .map((row) => row.id)
      .sort(),
  ).toEqual(['interview', 'second', 'third']);
  expect((await historyRepository.list()).find((row) => row.id === 'interview')?.title).toBe('Same title');
});

it('marks same-size changed original bytes as a collision; preserves destination-only files and other same-title libraries', async () => {
  await localKnowledge.saveBase(sourceBase);
  await localKnowledge.saveBase({ ...sourceBase, id: 'another' });
  const previous = file('original', sourceBase.id, 'one.txt', 'before');
  const same = file('same', sourceBase.id, 'same.txt', 'same');
  const localOnly = file('local', sourceBase.id, 'local.txt', 'keep');
  const untouched = file('untouched', 'another', 'one.txt', 'other');
  await seedDocuments(previous, same, localOnly, untouched);
  const payloads: ImportPayload[] = [
    { type: 'base', base: sourceBase },
    { type: 'file', document: file('imported-id', sourceBase.id, 'one.txt', 'source') },
    { type: 'file', document: { ...same, createdAt: 999 } },
    { type: 'file', document: file('added', sourceBase.id, 'added.txt', 'new') },
  ];
  const { preview, writes } = await prepare(payloads, ['base:source']);
  expect(preview.entries).toEqual([
    { key: 'base:source', group: 'knowledge', title: 'Library', conflict: true },
  ]);
  await writes.commit();
  const docs = await localKnowledge.listDocuments(sourceBase.id);
  expect(docs.map((doc) => doc.id).sort()).toEqual(['added', 'local', 'original', 'same']);
  expect(await docs.find((doc) => doc.id === 'original')!.blob.text()).toBe('source');
  expect(docs.find((doc) => doc.id === 'same')!.createdAt).toBe(5);
  expect(await (await localKnowledge.listDocuments('another'))[0].blob.text()).toBe('other');
  const retry = await buildImportPlan(payloads, guard);
  expect(retry.entries[0].conflict).toBe(false);
});

it('preserves an unselected resume, and compares selected resumes by name and bytes across devices', async () => {
  const previous = file('local-cv', 'personal-resume', 'resume.txt', 'old');
  await seedDocuments(previous);
  const payloads: ImportPayload[] = [
    { type: 'resume', document: file('source-cv', 'personal-resume', 'resume.txt', 'new') },
    { type: 'profile', profile: info },
  ];
  const { preview, writes } = await prepare(payloads, ['profile:name']);
  expect(preview.entries.find((entry) => entry.key === 'resume:main')?.conflict).toBe(true);
  await writes.commit();
  expect(await (await localKnowledge.listDocuments('personal-resume'))[0].blob.text()).toBe('old');
  await (await prepareImportWrites(preview, ['resume:main'], guard)).commit();
  const [cv] = await localKnowledge.listDocuments('personal-resume');
  expect([cv.id, await cv.blob.text()]).toEqual(['local-cv', 'new']);
  expect(
    (await buildImportPlan(payloads, guard)).entries.find((entry) => entry.key === 'resume:main')
      ?.conflict,
  ).toBe(false);
});

it('adds a same-title library separately and keeps an unrelated file with a colliding source ID', async () => {
  await localKnowledge.saveBase({ ...sourceBase, id: 'other-base' });
  await seedDocuments(file('id', 'other-base', 'note.txt', 'not selected'));
  const payloads: ImportPayload[] = [
    { type: 'base', base: sourceBase },
    { type: 'file', document: file('id', sourceBase.id, 'note.txt', 'imported') },
  ];
  const { preview, writes } = await prepare(payloads, ['base:source']);
  expect(preview.entries[0].conflict).toBe(false);
  await writes.commit();
  const [other] = await localKnowledge.listDocuments('other-base');
  const [added] = await localKnowledge.listDocuments(sourceBase.id);
  expect(other.id).toBe('id');
  expect(await other.blob.text()).toBe('not selected');
  expect(added.id).not.toBe('id');
  const repeated = await prepare(payloads, ['base:source']);
  expect(repeated.preview.entries[0].conflict).toBe(false);
  await repeated.writes.commit();
  expect((await localKnowledge.listDocuments(sourceBase.id)).map((doc) => doc.id)).toEqual([
    added.id,
  ]);
});

it('rejects a newly conflicting target in the same transaction, without writing other selected items', async () => {
  const { writes } = await prepare(
    [
      { type: 'base', base: sourceBase },
      { type: 'file', document: file('id', 'source', 'a.txt', 'source') },
      { type: 'profile', profile: info },
    ],
    ['base:source', 'profile:name'],
  );
  await localKnowledge.saveBase(sourceBase);
  await seedDocuments(file('other', 'source', 'a.txt', 'target'));
  await expect(writes.commit()).rejects.toThrow('迁移期间本地资料已更改');
  expect(storage.has(profileStorageKey)).toBe(false);
  expect(await (await localKnowledge.listDocuments('source'))[0].blob.text()).toBe('target');
});

it('aborts pending database writes if a selected target field was edited since preview', async () => {
  const { writes, preview } = await prepare(
    [
      { type: 'base', base: sourceBase },
      { type: 'profile', profile: info },
    ],
    ['base:source', 'profile:name'],
  );
  await expect(prepareImportWrites(preview, ['profile:unknown'], guard)).rejects.toThrow(
    '迁移资料无效',
  );
  await expect(
    prepareImportWrites(preview, ['profile:name', 'profile:name'], guard),
  ).rejects.toThrow('迁移资料无效');
  storage.set(profileStorageKey, JSON.stringify({ ...info, name: 'Concurrent' }));
  await expect(writes.commit()).rejects.toThrow('迁移期间本地资料已更改');
  expect(await localKnowledge.listBases()).toEqual([]);
  expect(JSON.parse(storage.get(profileStorageKey)!).name).toBe('Concurrent');
});
