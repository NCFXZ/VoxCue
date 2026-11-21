import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { validLocalImportRevision } from '../../electron/contracts/cloudAccount';
import { historyStorageKey, historyRepository } from '../../src/services/history';
import { localKnowledge } from '../../src/services/knowledge';
import { localRevision, observeLocalImportRevision, refreshLocalImportRevision } from '../../src/services/localImportRevision';
import { profileStorageKey } from '../../src/services/storedValues';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('indexedDB', new IDBFactory());
  const send = vi.fn(async (_: string | null) => {});
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { desktop: { setLocalImportRevision: send } }),
  );
  return { values, send };
}
it('reports only a revision, reuses it for unchanged content, and clears when all importable items are removed', async () => {
  const { values, send } = fixture();
  const revision = async () => {
    await refreshLocalImportRevision();
    return send.mock.lastCall![0];
  };
  const empty = { name: '', jobDescription: '', background: '', language: '简体中文', skills: [] };
  values.set(profileStorageKey, JSON.stringify(empty));
  expect(await revision()).toBeNull();
  values.set(profileStorageKey, JSON.stringify({ ...empty, name: 'Private synthetic name' }));
  const first = await revision();
  expect(validLocalImportRevision(first)).toBe(true);
  expect(await revision()).toBe(first);
  values.set(profileStorageKey, JSON.stringify({ ...empty, name: 'Changed synthetic name' }));
  expect(await revision()).not.toBe(first);
  values.delete(profileStorageKey);
  expect(await revision()).toBeNull();

  await historyRepository.save({
    id: 'test',
    title: 'Private synthetic history',
    status: 'ended',
    startedAt: 1,
    endedAt: 2,
    mock: false,
    transcripts: [],
    answers: [],
  });
  expect(validLocalImportRevision(await revision())).toBe(true);
  await historyRepository.remove('test');
  expect(await revision()).toBeNull();
  await localKnowledge.importDocuments('personal-resume', [new File(['resume'], 'resume.txt')]);
  expect(validLocalImportRevision(await revision())).toBe(true);
  await localKnowledge.deleteBase('personal-resume');
  expect(await revision()).toBeNull();
  await localKnowledge.saveBase({ id: 'base', name: 'Private synthetic base', createdAt: 1 });
  const library = await revision();
  expect(validLocalImportRevision(library)).toBe(true);
  await localKnowledge.importDocuments('base', [new File(['synthetic original'], 'doc.txt')]);
  const original = await revision();
  expect(original).not.toBe(library);
  expect(await revision()).toBe(original);
  await localKnowledge.deleteBase('base');
  expect(await revision()).toBeNull();
  expect(
    send.mock.calls.every(([value]) => value === null || validLocalImportRevision(value)),
  ).toBe(true);
});

it('keeps an unchanged legacy revision through upgrade and detects edits even without a notification on a full check', async () => {
  const { values } = fixture();
  const record = { id: 'old', title: '旧标题', status: 'ended', mock: false, startedAt: 1, endedAt: 2,
    answers: [], transcripts: [] };
  const old = createHash('sha256').update(JSON.stringify([null, [record], [], []])).digest('hex');
  const revision = randomUUID();
  values.set(historyStorageKey, JSON.stringify([record]));
  values.set('voxcue-local-import-marker-v1', old + ':' + revision);
  expect(await localRevision()).toBe(revision);
  expect(values.get('voxcue-local-import-marker-v1')).not.toBe(old + ':' + revision);
  await historyRepository.rename(record.id, '新标题');
  expect(await localRevision()).not.toBe(revision);
  values.set('voxcue-local-import-marker-v1', old + ':' + revision);
  expect(await localRevision()).not.toBe(revision);
});

it('recomputes only notified categories, merges bursts, and verifies unknown changes in full', async () => {
  const { values, send } = fixture();
  await localKnowledge.saveBase({ id: 'base', name: 'Base', createdAt: 1 });
  const knowledge = vi.spyOn(indexedDB, 'databases');
  const history = vi.spyOn(historyRepository, 'summaries');
  const profile = vi.spyOn(localStorage, 'getItem');
  const failure = vi.fn();
  const stop = observeLocalImportRevision(failure);
  const published = async (action: () => void) => {
    const count = send.mock.calls.length;
    history.mockClear(); knowledge.mockClear(); profile.mockClear();
    action();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(count + 1));
    return send.mock.lastCall![0];
  };
  try {
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const first = send.mock.lastCall![0];
    const afterProfile = await published(() => {
      values.set(profileStorageKey, JSON.stringify({ name: '合成姓名', jobDescription: '', background: '' }));
      window.dispatchEvent(new CustomEvent('voxcue-local-change', { detail: { kind: 'profile', keys: ['profile:main'] } }));
    });
    expect(afterProfile).not.toBe(first);
    expect(history).not.toHaveBeenCalled();
    expect(knowledge).not.toHaveBeenCalled();
    expect(profile).toHaveBeenCalledWith(profileStorageKey);

    await published(async () => {
      await historyRepository.save({ id: 'r', title: '合成记录', status: 'ended', mock: false,
        startedAt: 1, endedAt: 2, transcripts: [], answers: [] });
      window.dispatchEvent(Object.assign(new Event('storage'), { key: historyStorageKey }));
    });
    expect(history).toHaveBeenCalledOnce();
    expect(knowledge).not.toHaveBeenCalled();
    expect(profile).not.toHaveBeenCalledWith(profileStorageKey);

    await published(() => {
      window.dispatchEvent(new CustomEvent('voxcue-local-change', { detail: { kind: 'profile', keys: ['resume:main'] } }));
      window.dispatchEvent(new CustomEvent('voxcue-sync-applied', { detail: 'record' }));
    });
    expect(knowledge).toHaveBeenCalledOnce();
    expect(history).toHaveBeenCalledOnce();
    expect(profile).not.toHaveBeenCalledWith(profileStorageKey);
    await published(() => window.dispatchEvent(new Event('voxcue-sync-applied')));
    expect(knowledge).toHaveBeenCalledOnce();
    expect(history).toHaveBeenCalledOnce();
    expect(profile).toHaveBeenCalledWith(profileStorageKey);
    expect(await localRevision()).toBe(send.mock.lastCall![0]);
    expect(failure).not.toHaveBeenCalled();
  } finally { stop(); }
});
