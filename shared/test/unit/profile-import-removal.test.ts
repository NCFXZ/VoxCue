import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureImportSource, createProfileImportReader } from '../../src/services/profileImportReader';
import { planSourceRemoval } from '../../src/services/profileImportRemoval';
import { validRemovalPlan } from '../../electron/backend/profileMoveReceipt';
import { maxRestoreItems } from '../../electron/contracts/restoreData';
import { historyRepository, type InterviewRecord } from '../../src/services/history';
import { localKnowledge, openDocumentsDatabase } from '../../src/services/knowledge';
import { localRevision } from '../../src/services/localImportRevision';
import { movedCloudItems } from '../../src/services/migrationSyncProtection';
import { profileStorageKey } from '../../src/services/storedValues';
import { recoverInterviewDrafts, startInterviewDraft } from '../../src/services/interviewDraft';

const owner = 'account:' + crypto.randomUUID();
it('counts all selected profile fields as one source item at the migration limit', async () => {
  const source = await captureImportSource();
  source.profile = JSON.stringify({ name: 'Example', background: 'Example', jobDescription: '' });
  const blob = new Blob(['fixture']);
  source.entries.push({ key: 'base:library', blob });
  for (let index = 0; index < maxRestoreItems - 2; index++)
    source.entries.push({ key: 'file:' + index, parent: 'base:library', blob });
  const keys = ['profile:name', 'profile:background', 'base:library'];
  const plan = await planSourceRemoval(source, keys);
  expect(plan.items).toHaveLength(maxRestoreItems + 1);
  expect(validRemovalPlan(plan)).toBe(true);
  plan.items.push({ key: 'record:extra', hash: plan.items[0].hash });
  expect(validRemovalPlan(plan)).toBe(false);
});
const profile = { name: 'Synthetic', background: 'Keep me', jobDescription: 'Example' };
const base = { id: 'library', name: 'Library', createdAt: 1 };
const record = (id: string, images: string[]): InterviewRecord => ({
  id,
  title: id,
  startedAt: 100,
  endedAt: 200,
  status: 'ended',
  mock: false,
  transcripts: [],
  answers: [{ id: 'answer', question: 'Q', content: 'A', images: images.map((id) => ({ id })) }],
});
it('accepts a migration receipt for every screenshot of a supported interview', async () => {
  const source = record(crypto.randomUUID(), []);
  const ids = Array.from({ length: 4095 }, () => crypto.randomUUID());
  source.answers = ids.map(id => ({ id, question: 'Q', content: 'A', images: [{ id }] }));
  localStorage.setItem('copilot-interview-history-v1', JSON.stringify([source]));
  const reader = await createProfileImportReader();
  const key = 'record:' + source.id;
  expect(reader.items.find(item => item.key === key)?.imageIds).toEqual(ids);
  const plan = await reader.planRemoval([key]);
  expect(plan.items[0].imageIds).toEqual(ids);
  expect(validRemovalPlan(plan)).toBe(true);
  plan.items[0].imageIds!.push(crypto.randomUUID());
  expect(validRemovalPlan(plan)).toBe(false);
});
it('previews the source directory without loading record bodies and guards deferred reads by revision', async () => {
  await historyRepository.save(record('first', []));
  await historyRepository.save(record('second', []));
  const bodies: unknown[] = [];
  const get = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
    if (this.name === 'interviewRecords') bodies.push(key);
    return get.call(this, key);
  });
  const getAll = IDBObjectStore.prototype.getAll;
  vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (this.name === 'interviewRecords') throw Error('Unexpected full history read');
    return getAll.apply(this, args);
  });
  const reader = await createProfileImportReader();
  expect(bodies).toEqual([]);
  const first = reader.items.findIndex(item => item.key === 'record:first');
  expect(reader.items[first].size).toBe(0);
  expect(await reader.recordSize(first)).toBeGreaterThan(8);
  expect(bodies).toEqual(['first']);
  await historyRepository.rename('second', 'Edited after preview');
  const second = reader.items.findIndex(item => item.key === 'record:second');
  await expect(reader.recordSize(second)).rejects.toThrow('来源资料已改变');
});
it('reads one body for a run of embedded screenshot previews and rejects a changed interview', async () => {
  const ids = Array.from({ length: 40 }, () => crypto.randomUUID());
  const original = record('embedded', ids);
  const preview = 'data:image/png;base64,iVBORw0KGgo=';
  original.answers = ids.map(id => ({ id, question: 'Q', content: 'A', images: [{ id, preview }] }));
  await historyRepository.save(original);
  const reader = await createProfileImportReader();
  const images = reader.items.flatMap((item, index) => item.key.startsWith('image:') ? [index] : []);
  expect(images).toHaveLength(ids.length);
  let bodies = 0;
  const get = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
    if (this.name === 'interviewRecords') bodies++;
    return get.call(this, key);
  });
  for (const index of images) expect(await reader.preview(index)).toBe(preview);
  expect(bodies).toBe(1);
  await historyRepository.rename(original.id, 'Edited during preview');
  await expect(reader.preview(images[0])).rejects.toThrow('来源资料已改变');
});
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('retains newly recovered interview rows when a migration receipt describes an older snapshot', async () => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const id = crypto.randomUUID(), first = { ...record(id, []), status: 'interrupted' as const };
  await historyRepository.save(first);
  const reader = await createProfileImportReader();
  const plan = await reader.planRemoval(['record:' + id]);
  const draft = startInterviewDraft(first, () => { throw Error('write failed'); })!;
  await draft.put(0, { transcript: { id: 'late', text: '后来定稿', final: true, time: '12:00' } });
  await draft.close(false);
  await expect(reader.removeSelected(plan, owner)).rejects.toThrow('来源资料已改变');
  expect((await historyRepository.list())[0].transcripts[0].text).toBe('后来定稿');
  const updated = await createProfileImportReader();
  await updated.removeSelected(await updated.planRemoval(['record:' + id]), owner);
  expect(await historyRepository.list()).toEqual([]);
  expect(await recoverInterviewDrafts()).toBe(false);
});

it('removes only selected profile fields, original libraries and interviews, protecting shared images on retries', async () => {
  values.set(profileStorageKey, JSON.stringify(profile));
  const shared = crypto.randomUUID(),
    unique = crypto.randomUUID();
  await historyRepository.save(record('moved', [shared, unique]));
  await historyRepository.save(record('retained', [shared]));
  await localKnowledge.saveBase(base);
  await localKnowledge.saveBase({ ...base, id: 'other' });
  await localKnowledge.importDocuments(base.id, [new File(['doc'], 'doc.txt')]);
  await localKnowledge.importDocuments('other', [new File(['keep'], 'doc.txt')]);
  await localKnowledge.importDocuments('personal-resume', [new File(['resume'], 'cv.txt')]);
  const [doc] = await localKnowledge.listDocuments(base.id);
  const source = await createProfileImportReader();
  const plan = await source.planRemoval(['profile:name', 'record:moved', 'base:library']);
  expect(JSON.stringify(plan)).not.toContain(profile.name);
  values.set(profileStorageKey, JSON.stringify({ ...profile, background: 'Edited independently' }));
  const moved = await source.removeSelected(plan, owner);
  expect(moved).toEqual({
    recordIds: ['moved'],
    imageIds: [unique],
    documentIds: [doc.id],
    localRevision: null,
  });
  expect(JSON.parse(values.get(profileStorageKey)!)).toEqual({
    ...profile,
    name: '',
    background: 'Edited independently',
  });
  expect((await historyRepository.list()).map((row) => row.id)).toEqual(['retained']);
  expect((await localKnowledge.listBases()).map((row) => row.id)).toEqual(['other']);
  expect(await localKnowledge.listDocuments(base.id)).toEqual([]);
  expect(await (await localKnowledge.listDocuments('other'))[0].blob.text()).toBe('keep');
  expect(await (await localKnowledge.listDocuments('personal-resume'))[0].blob.text()).toBe(
    'resume',
  );
  const mask = movedCloudItems(owner);
  expect([...mask.fields]).toEqual(['name']);
  expect(mask.keys).toEqual(
    new Set(['record:moved', 'base:library', 'file:' + doc.id, 'image:' + unique]),
  );
  const restarted = await createProfileImportReader();
  expect(await restarted.removeSelected(plan, owner)).toEqual(moved);
});

it('updates the local revision after each successful removal and clears it when the last original leaves', async () => {
  values.set(profileStorageKey, JSON.stringify({ name: 'A', background: '', jobDescription: '' }));
  await localKnowledge.importDocuments('personal-resume', [new File(['resume'], 'cv.txt')]);
  const revision = await localRevision();
  const source = await createProfileImportReader();
  const resumePlan = await source.planRemoval(['resume:main']);
  const namePlan = await source.planRemoval(['profile:name']);
  const afterName = await source.removeSelected(namePlan, 'local');
  expect(afterName.localRevision).toBeTruthy();
  expect(afterName.localRevision).not.toBe(revision);
  const done = await source.removeSelected(resumePlan, 'local');
  expect(done.localRevision).toBeNull();
  expect(done.documentIds).toEqual([resumePlan.items[0].documentId]);
  expect(await localKnowledge.listDocuments('personal-resume')).toEqual([]);
  expect(values.has('voxcue-local-import-marker-v1')).toBe(false);
});

it.each(['field', 'record', 'new library member', 'same-size original'])(
  'checks the entire source selection before clearing anything when %s changes',
  async (change) => {
    values.set(profileStorageKey, JSON.stringify(profile));
    await historyRepository.save(record('moved', []));
    await localKnowledge.saveBase(base);
    await localKnowledge.importDocuments(base.id, [new File(['abc'], 'doc.txt')]);
    const source = await createProfileImportReader();
    const plan = await source.planRemoval(['profile:name', 'record:moved', 'base:library']);
    if (change === 'field')
      values.set(profileStorageKey, JSON.stringify({ ...profile, name: 'new' }));
    if (change === 'record') await historyRepository.rename('moved', 'Changed');
    if (change === 'new library member')
      await localKnowledge.importDocuments(base.id, [new File(['new'], 'extra.txt')]);
    if (change === 'same-size original') {
      const [original] = await localKnowledge.listDocuments(base.id);
      const db = await openDocumentsDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite');
        tx.objectStore('documents').put({ ...original, blob: new Blob(['xyz']) });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    }
    await expect(source.removeSelected(plan, owner)).rejects.toThrow('来源资料已改变');
    expect(JSON.parse(values.get(profileStorageKey)!).name).toBeTruthy();
    expect(await historyRepository.list()).toHaveLength(1);
    expect(await localKnowledge.listBases()).toHaveLength(1);
    expect((await localKnowledge.listDocuments(base.id)).length).toBeGreaterThanOrEqual(1);
    expect(movedCloudItems(owner).keys.size).toBe(0);
  },
);

it('rolls back the history write, originals and cloud mask when the next profile write fails', async () => {
  values.set(profileStorageKey, JSON.stringify(profile));
  await historyRepository.save(record('moved', []));
  await localKnowledge.saveBase(base);
  const source = await createProfileImportReader();
  const plan = await source.planRemoval(['profile:name', 'record:moved', 'base:library']);
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === profileStorageKey) throw Error('full');
    values.set(key, value);
  });
  await expect(source.removeSelected(plan, owner)).rejects.toThrow('full');
  expect(JSON.parse(values.get(profileStorageKey)!)).toEqual(profile);
  expect(await historyRepository.list()).toHaveLength(1);
  expect(await localKnowledge.listBases()).toHaveLength(1);
  expect(movedCloudItems(owner).keys.size).toBe(0);
});
