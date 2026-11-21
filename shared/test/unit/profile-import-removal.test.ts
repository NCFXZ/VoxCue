import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProfileImportReader } from '../../src/services/profileImportReader';
import { historyRepository, type InterviewRecord } from '../../src/services/history';
import { localKnowledge, openDocumentsDatabase } from '../../src/services/knowledge';
import { localRevision } from '../../src/services/localImportRevision';
import { movedCloudItems } from '../../src/services/migrationSyncProtection';
import { profileStorageKey } from '../../src/services/storedValues';
import { recoverInterviewDrafts, startInterviewDraft } from '../../src/services/interviewDraft';

const owner = 'account:' + crypto.randomUUID();
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
afterEach(() => vi.unstubAllGlobals());

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
