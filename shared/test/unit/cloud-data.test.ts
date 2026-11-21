import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBIndex } from 'fake-indexeddb';
import { historyRepository, historyStorageKey } from '../../src/services/history';
import { buildImportPlan, prepareImportWrites } from '../../src/services/accountImportPlan';
import {
  applyCloudItem,
  CloudDataConflict,
  cloudFileParent,
  decodeCloudItem,
  digestCloudBlob,
  localCloudItem,
  localCloudItems,
  removeLocalSyncItem,
  packCloudItem,
  unpackCloudItem,
} from '../../src/services/cloudData';
import {
  localKnowledge,
  documentRevision,
  restoreSyncedDocument,
} from '../../src/services/knowledge';
import { validImportDocument } from '../../electron/contracts/accountData';
import { validateKnowledge } from '../../electron/application/knowledge';

const profileKey = 'copilot-personal-info-v1';
describe('cloud data restoration boundary', () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    });
    vi.stubGlobal('window', { dispatchEvent: () => true });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('removes only the reviewed profile and résumé, rejecting late edits and cross-library ownership', async () => {
    values.set(profileKey, JSON.stringify({ name: 'Sample', jobDescription: '', background: '' }));
    await localKnowledge.importDocuments('personal-resume', [new File(['CV'], 'resume.txt')]);
    const hash = async (key: string) => digestCloudBlob(await (await localCloudItem('profile', key))!.blob());
    const resume = await hash('resume:main');
    const profile = await hash('profile:main');
    await expect(removeLocalSyncItem('resume:main', resume, () => {}, 'base:other')).rejects.toThrow(CloudDataConflict);
    await expect(removeLocalSyncItem('profile:main', profile, () => {
      values.set(profileKey, JSON.stringify({ name: 'Newer', jobDescription: '', background: '' }));
    }, 'profile:main')).rejects.toThrow(CloudDataConflict);
    await removeLocalSyncItem('resume:main', resume, () => {}, 'profile:main');
    expect(await localKnowledge.listDocuments('personal-resume')).toHaveLength(0);
    expect(JSON.parse(values.get(profileKey)!)).toHaveProperty('name', 'Newer');
    await removeLocalSyncItem('profile:main', await hash('profile:main'), () => {}, 'profile:main');
    expect(values.has(profileKey)).toBe(false);
  });

  it('replaces a manual interview title only on explicit version selection and keeps a shared screenshot intact', async () => {
    const shot = crypto.randomUUID();
    const record = { id: 'first', title: 'Local title', titleSource: 'manual' as const,
      startedAt: 1, endedAt: 2, status: 'ended' as const, mock: false, transcripts: [],
      answers: [{ id: 'a', question: 'Q', content: 'A', images: [{ id: shot }] }] };
    await historyRepository.save(record);
    await historyRepository.save({ ...record, id: 'second' });
    const key = 'record:first';
    const hash = await digestCloudBlob(await (await localCloudItem('history', key))!.blob());
    const incoming = packCloudItem(key, JSON.stringify({ ...record, title: 'Cloud title', answers: [] }));
    const imageHash = 'a'.repeat(64);
    const restoreImage = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: () => true, desktop: {
      interviewImage: async () => ({ ok: true, hash: imageHash }), cloudSync: restoreImage,
    } });
    const imageKey = 'image:' + shot;
    const cloudImage = packCloudItem(imageKey, 'bytes', { id: shot, preview: 'data:image/png;base64,AAAA' });
    await expect(applyCloudItem(imageKey, cloudImage, imageHash, 'test', () => {}, undefined, key))
      .rejects.toThrow(CloudDataConflict);
    expect(restoreImage).not.toHaveBeenCalled();
    restoreImage.mockResolvedValue({ ok: true });
    await applyCloudItem(imageKey, cloudImage, imageHash, 'test', () => {}, undefined, key, [key, 'record:second']);
    expect(restoreImage).toHaveBeenCalledOnce();
    await historyRepository.save({ ...record, id: 'late' });
    await expect(applyCloudItem(imageKey, cloudImage, imageHash, 'test', () => {}, undefined, key, [key, 'record:second']))
      .rejects.toThrow(CloudDataConflict);
    expect(restoreImage).toHaveBeenCalledOnce();
    await applyCloudItem(key, incoming, hash, 'test', () => {}, undefined, key);
    expect(await historyRepository.get('first')).toMatchObject({ title: 'Cloud title', answers: [] });
    const remaining = await historyRepository.get('second');
    expect(remaining).toEqual({ ...record, id: 'second' });
    await expect(removeLocalSyncItem(imageKey, imageHash, () => {}, key)).rejects.toThrow(CloudDataConflict);
    await expect(removeLocalSyncItem(key, hash, () => {}, key)).rejects.toThrow(CloudDataConflict);
    await removeLocalSyncItem(key, await digestCloudBlob(incoming), () => {}, key);
    expect(await historyRepository.get('first')).toBeUndefined();
    expect(await historyRepository.get('second')).toEqual(remaining);
  });

  it('omits legacy local modification metadata from document sync hashes', async () => {
    const metadata = { id: 'legacy', baseId: 'books', name: 'Book.txt', size: 1, type: 'text/plain', createdAt: 1 };
    const [source] = await localCloudItems('knowledgebase', { bases: [], documents: [
      { ...metadata, modifiedAt: 345, localRevision: crypto.randomUUID(), blob: new Blob(['x']) },
    ] });
    expect((await unpackCloudItem(source.key, await source.blob())).metadata).toEqual(metadata);
  });

  it.each([
    ['file:migrated', 'books', 'knowledgebase'],
    ['resume:main', 'personal-resume', 'profile'],
  ] as const)('keeps the cloud digest of migrated %s after an IndexedDB restore', async (key, baseId, kind) => {
    if (kind === 'knowledgebase') await localKnowledge.saveBase({ id: baseId, name: 'Books', createdAt: 1 });
    // The account import manifest wrote type before size, unlike a local file import.
    const metadata = { id: 'migrated', baseId, name: 'sample.txt', type: 'text/plain', size: 1, createdAt: 1 };
    const incoming = packCloudItem(key, 'x', metadata);
    const restored = await applyCloudItem(key, incoming);
    expect(restored?.localRevision).toBeTruthy();
    const local = await localCloudItem(kind, key);
    expect(await digestCloudBlob(await local!.blob())).toBe(await digestCloudBlob(incoming));
  });

  it('writes a newly migrated original in the same wire format as a local import', async () => {
    const document = { id: 'cv', baseId: 'personal-resume', name: 'cv.txt', type: 'text/plain', size: 1, createdAt: 1 };
    const key = 'resume:main', blob = new Blob(['x']);
    const plan = await buildImportPlan([{
      type: 'original', key, document, digest: () => digestCloudBlob(blob), read: async () => blob,
    }], () => {});
    const writes = await prepareImportWrites(plan, [key], () => {});
    await writes.commit();
    const local = await localCloudItem('profile', key);
    const { metadata } = await unpackCloudItem(key, await local!.blob());
    expect(Object.keys(metadata)).toEqual(['id', 'baseId', 'name', 'size', 'type', 'createdAt']);
  });

  it('round-trips a formerly over-limit history envelope and checks every referenced screenshot before committing', async () => {
    const ids = Array.from({ length: 513 }, () => crypto.randomUUID());
    const answers = ids.map((id, index) => ({
      id: 'a' + index, question: '问', content: '答'.repeat(5500),
      images: [{ id }],
    }));
    const record = { id: 'long', title: '长面试', startedAt: 1, endedAt: 2, status: 'ended' as const,
      mock: false, transcripts: [], answers };
    const key = 'record:long';
    await historyRepository.save(record);
    const source = await localCloudItem('history', key);
    const bytes = await source!.blob();
    expect(bytes.size).toBeGreaterThan(8 * 1024 ** 2);
    expect(await digestCloudBlob(bytes)).toBe(await digestCloudBlob(packCloudItem(key, JSON.stringify(record))));
    vi.stubGlobal('indexedDB', new IDBFactory());
    const image = vi.fn(async ({ id }: { id: string }) => ({ ok: id !== ids.at(-1) }));
    vi.stubGlobal('window', { desktop: { interviewImage: image }, dispatchEvent: () => true });
    await expect(applyCloudItem(key, bytes)).rejects.toThrow('截图尚未全部恢复');
    expect(await historyRepository.get(record.id)).toBeUndefined();
    image.mockImplementation(async () => ({ ok: true }));
    image.mockClear();
    await applyCloudItem(key, bytes);
    expect(image.mock.calls.map(([call]) => call.id)).toEqual(ids);
    expect((await historyRepository.get(record.id))?.answers).toEqual(record.answers);
  });
  it('rejects records beyond the account resource limit in both directions, before clearing any data', async () => {
    const record = { id: 'too-many', title: '截图', startedAt: 1, endedAt: 2, status: 'ended' as const,
      mock: false, transcripts: [], answers: Array.from({ length: 4096 }, (_, i) => ({
        id: 'a' + i, question: 'q', content: 'a', images: [{ id: crypto.randomUUID() }],
      })) };
    const key = 'record:' + record.id;
    await historyRepository.save(record);
    const local = await localCloudItem('history', key);
    await expect(local!.blob()).rejects.toThrow('截图超过同步保护上限');
    await expect(decodeCloudItem(key, packCloudItem(key, JSON.stringify(record)))).rejects.toThrow('截图超过同步保护上限');
    expect((await historyRepository.get(record.id))?.answers).toHaveLength(4096);
    const block = new Blob([new Uint8Array(1024 ** 2)]);
    await expect(decodeCloudItem(key, new Blob([...Array(64).fill(block), 'x']))).rejects.toThrow('数据大小无效');
  });
  it('identifies committed records, libraries and files in local change notifications', async () => {
    const events: unknown[] = [];
    const target = new EventTarget();
    target.addEventListener('voxcue-local-change', (event) => events.push((event as CustomEvent).detail));
    vi.stubGlobal('window', target);
    for (const id of ['one', 'two'])
      await localKnowledge.saveBase({ id, name: id, createdAt: 1 });
    await localKnowledge.importDocuments('one', [new File(['first'], 'example.txt')]);
    const [doc] = await localKnowledge.listDocuments('one');
    const edited = { kind: 'knowledgebase', keys: ['base:one', 'file:' + doc.id] };
    await localKnowledge.importDocuments('one', [new File(['replacement'], 'example.txt')]);
    await localKnowledge.deleteDocument(doc.id);
    await expect(localKnowledge.importDocuments('missing', [new File(['x'], 'x.txt')])).rejects.toThrow();
    await historyRepository.save({
      id: 'r', title: 'Synthetic', startedAt: 1, endedAt: 2, status: 'ended',
      transcripts: [], answers: [], mock: false,
    });
    await historyRepository.rename('r', 'Updated');
    await historyRepository.remove('r');
    expect(events).toEqual([
      { kind: 'knowledgebase', keys: ['base:one'] }, { kind: 'knowledgebase', keys: ['base:two'] },
      edited, edited, edited,
      ...Array(3).fill({ kind: 'history', keys: ['record:r'] }),
    ]);
  });
  it('a late profile download cannot overwrite a newer JD or commit after logout', async () => {
    const original = { name: 'synthetic', jobDescription: 'old JD', background: '' };
    values.set(profileKey, JSON.stringify(original));
    const hash = await digestCloudBlob(await (await localCloudItems('profile'))[0].blob());
    const remote = packCloudItem(
      'profile:main',
      JSON.stringify({ ...original, jobDescription: 'remote JD' }),
    );
    values.set(profileKey, JSON.stringify({ ...original, jobDescription: 'new local JD' }));
    await expect(applyCloudItem('profile:main', remote, hash)).rejects.toThrow('本地数据已有修改');
    expect(JSON.parse(values.get(profileKey)!).jobDescription).toBe('new local JD');
    const current = await digestCloudBlob(await (await localCloudItems('profile'))[0].blob());
    await expect(
      applyCloudItem('profile:main', remote, current, undefined, () => {
        throw Error('logout');
      }),
    ).rejects.toThrow('logout');
    expect(JSON.parse(values.get(profileKey)!).jobDescription).toBe('new local JD');
    const duringCommit = JSON.stringify({ ...original, jobDescription: 'edited during final check' });
    await expect(applyCloudItem('profile:main', remote, current, undefined, () => {
      values.set(profileKey, duringCommit);
    })).rejects.toThrow('本地数据已有修改');
    expect(values.get(profileKey)).toBe(duringCommit);
  });
  it('restoring a record only queues a local edit when its preserved title differs', async () => {
    const target = new EventTarget();
    const changes: unknown[] = [];
    target.addEventListener('voxcue-local-change', (e) => changes.push((e as CustomEvent).detail));
    vi.stubGlobal('window', target);
    const key = 'record:test';
    const record = { id: 'test', title: 'Remote', startedAt: 1, endedAt: 2, status: 'ended',
      transcripts: [], answers: [], mock: false };
    const blob = packCloudItem(key, JSON.stringify(record));
    await applyCloudItem(key, blob);
    expect(changes).toEqual([]);
    await historyRepository.rename('test', 'Manual');
    changes.length = 0;
    const [local] = await localCloudItems('history');
    await applyCloudItem(key, blob, await digestCloudBlob(await local.blob()));
    expect((await historyRepository.list())[0].title).toBe('Manual');
    expect(changes).toEqual([{ kind: 'history', keys: [key] }]);
  });
  it.each(['delete', 'edit', 'unrelated'] as const)('checks the target record at commit when a concurrent %s occurs', async (change) => {
    const record = { id: 'one', title: 'local', startedAt: 1, endedAt: 2,
      status: 'ended' as const, transcripts: [], answers: [], mock: false };
    await historyRepository.save(record);
    const key = 'record:one';
    const hash = await digestCloudBlob(await (await localCloudItem('history', key))!.blob());
    const cloud = packCloudItem(key, JSON.stringify({ ...record, endedAt: 3 }));
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (algorithm, bytes) => {
      if (change === 'delete') await historyRepository.remove(record.id);
      if (change === 'edit') await historyRepository.save({ ...record, endedAt: 4 });
      if (change === 'unrelated') await historyRepository.save({ ...record, id: 'two' });
      return originalDigest(algorithm, bytes);
    });
    try {
      const restore = applyCloudItem(key, cloud, hash);
      if (change === 'unrelated') {
        await restore;
        expect((await historyRepository.list()).map(row => [row.id, row.endedAt])).toEqual([['one', 3], ['two', 2]]);
      } else {
        await expect(restore).rejects.toThrow('本地数据已有修改');
        expect((await historyRepository.list()).map(row => row.endedAt)).toEqual(change === 'delete' ? [] : [4]);
      }
    } finally {
      digest.mockRestore();
    }
  });
  it('encodes only the requested record and invalidates the history snapshot on an external write', async () => {
    const records = Array.from({ length: 160 }, (_, i) => ({
      id: 'r' + i, title: 'record ' + i, startedAt: i, endedAt: i, status: 'ended',
      transcripts: [], answers: [], mock: false,
    }));
    values.set('copilot-interview-history-v1', JSON.stringify(records));
    await historyRepository.ready();
    const serialize = vi.spyOn(JSON, 'stringify');
    try {
      for (let i = 0; i < 12; i++) await (await localCloudItem('history', 'record:r4'))!.blob();
      expect(serialize.mock.calls.filter(([value]) => value?.transcripts)).toHaveLength(1);
      records[4].title = 'changed elsewhere';
      await historyRepository.rename(records[4].id, records[4].title);
      expect(await (await (await localCloudItem('history', 'record:r4'))!.blob()).text()).toContain('changed elsewhere');
    } finally {
      serialize.mockRestore();
    }
  });
  it('enumerates the directory without opening bodies and refuses to serve an outdated revision', async () => {
    const live = crypto.randomUUID(), old = crypto.randomUUID();
    const preview = 'data:image/png;base64,QQ==';
    const record = { id: 'interview', title: 'Synthetic', startedAt: 1, endedAt: 2,
      status: 'ended' as const, transcripts: [], answers: [{ id: 'a', question: 'q', content: 'answer',
        images: [{ id: live }, { id: old, preview }] }], mock: false };
    await historyRepository.save(record);
    const get = vi.spyOn(historyRepository, 'get');
    const list = vi.spyOn(historyRepository, 'list');
    const image = vi.spyOn(historyRepository, 'imageReference');
    const request = vi.fn(async () => ({ ok: true, hash: 'a'.repeat(64) }));
    vi.stubGlobal('window', { desktop: { interviewImage: request } });
    try {
      const sources = await localCloudItems('history');
      const item = sources.find(row => row.key === 'record:interview')!;
      expect(item.dependencies).toEqual(['image:' + live, 'image:' + old]);
      expect(list).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      await sources.find(row => row.key === 'image:' + live)!.digest!();
      expect(image).not.toHaveBeenCalled();
      await sources.find(row => row.key === 'image:' + old)!.digest!();
      expect(request).toHaveBeenLastCalledWith({ op: 'syncDigest', id: old, preview });
      await item.blob();
      expect(get).toHaveBeenCalledTimes(1);
      await historyRepository.rename(record.id, 'New title');
      await expect(item.blob()).rejects.toBeInstanceOf(CloudDataConflict);
      const imported = await localCloudItems('history', undefined, [record]);
      const sourceSnapshot = imported.find(row => row.key === item.key)!;
      expect(await (await sourceSnapshot.blob()).text()).toContain('Synthetic');
      image.mockClear();
      await imported.find(row => row.key === 'image:' + old)!.digest!();
      expect(image).not.toHaveBeenCalled();
      expect(request).toHaveBeenLastCalledWith({ op: 'syncDigest', id: old, preview });
    } finally {
      get.mockRestore(); list.mockRestore(); image.mockRestore();
    }
  });
  it('a file replacement races safely with restoration and local-only revision fields never enter the cloud package', async () => {
    await localKnowledge.saveBase({ id: 'base', name: 'Synthetic', createdAt: 1 });
    await localKnowledge.importDocuments('base', [new File(['old'], 'original.txt')]);
    const old = (await localKnowledge.listDocuments('base'))[0];
    await localKnowledge.importDocuments('base', [new File(['new local'], 'original.txt')]);
    await expect(
      restoreSyncedDocument({ ...old, blob: new Blob(['remote']), size: 6 }, documentRevision(old)),
    ).rejects.toThrow();
    const current = (await localKnowledge.listDocuments('base'))[0];
    expect(await current.blob.text()).toBe('new local');
    const item = (await localCloudItems('knowledgebase')).find((i) => i.key.startsWith('file:'))!;
    const content = await item.blob();
    expect((await content.text()).includes('localRevision')).toBe(false);
    expect((await content.text()).includes(current.localRevision!)).toBe(false);
  });
  it.each(['before', 'during'] as const)('preserves both originals when a resume ID is claimed %s restoration', async when => {
    await localKnowledge.saveBase({ id: 'books', name: 'Synthetic', createdAt: 1 });
    await localKnowledge.importDocuments('personal-resume', [new File(['original resume'], 'old.txt')]);
    const resume = (await localKnowledge.listDocuments('personal-resume'))[0];
    const current = await localCloudItem('profile', 'resume:main');
    const hash = await digestCloudBlob(await current!.blob());
    const metadata = { id: 'taken', baseId: 'books', name: 'source.txt', size: 5, type: 'text/plain', createdAt: 1 };
    const claim = () => applyCloudItem('file:taken', packCloudItem('file:taken', 'local', metadata));
    if (when === 'before') await claim();
    const invalidate = vi.fn(async () => {
      if (when === 'during') await claim();
      return { ok: true, value: {} };
    });
    vi.stubGlobal('window', { desktop: { knowledge: invalidate }, dispatchEvent: () => true });
    const incoming = packCloudItem('resume:main', 'cloud', { ...metadata, baseId: 'personal-resume' });
    await expect(applyCloudItem('resume:main', incoming, hash)).rejects.toBeInstanceOf(CloudDataConflict);
    expect(invalidate).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
    const [kept] = await localKnowledge.listDocuments('personal-resume');
    expect(kept.id).toBe(resume.id);
    expect(await kept.blob.text()).toBe('original resume');
    expect(await (await localKnowledge.listDocuments('books'))[0].blob.text()).toBe('local');
  });
  it.each([240, 241, 255])('retains a %i-character original name through indexing, sync and account migration', async length => {
    const name = 'a'.repeat(length - 4) + '.txt';
    await localKnowledge.importDocuments('personal-resume', [new File(['original'], name)]);
    const [stored] = await localKnowledge.listDocuments('personal-resume');
    const bytes = new Uint8Array(await stored.blob.arrayBuffer());
    expect(validateKnowledge({ op: 'import', requestId: 'test', documentId: stored.id,
      baseId: stored.baseId, name, bytes })).toMatchObject({ name });
    const packed = await (await localCloudItem('profile', 'resume:main'))!.blob();
    const typed = await decodeCloudItem('resume:main', packed);
    expect(typed.type).toBe('resume');
    if (typed.type !== 'resume') throw Error('missing resume');
    expect(typed.document.name).toBe(name);
    expect(await typed.document.blob.text()).toBe('original');
    expect(validImportDocument('resume:main', typed.document)).toBe(true);
  });
  it('rejects an overlong original or a path before replacing the saved resume', async () => {
    await localKnowledge.importDocuments('personal-resume', [new File(['original'], 'old.txt')]);
    for (const name of ['a'.repeat(252) + '.txt', '../doc.txt']) {
      await expect(localKnowledge.importDocuments('personal-resume', [new File(['other'], name)])).rejects.toThrow('文件名');
    }
    const [original] = await localKnowledge.listDocuments('personal-resume');
    expect(original.name).toBe('old.txt');
    expect(await original.blob.text()).toBe('original');
  });
  it('malicious file names, oversized declared metadata and wrong-category payloads cannot be restored', async () => {
    const metadata = {
      id: 'doc',
      baseId: 'base',
      name: '../../credentials.txt',
      size: 1,
      type: 'text/plain',
      createdAt: 1,
    };
    await expect(
      applyCloudItem('file:doc', packCloudItem('file:doc', new Uint8Array([1]), metadata)),
    ).rejects.toThrow('元数据');
    await expect(
      applyCloudItem(
        'profile:main',
        packCloudItem('profile:main', '{"name":"x","jobDescription":42}'),
      ),
    ).rejects.toThrow('个人信息');
    expect(values.get(profileKey)).toBeUndefined();
  });
  it('restored originals are returned for indexing without emitting a local edit', async () => {
    const events: string[] = [];
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    });
    const storeScans = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const baseScans = vi.spyOn(IDBIndex.prototype, 'getAll');
    await applyCloudItem(
      'base:base',
      packCloudItem('base:base', JSON.stringify({ id: 'base', name: 'Synthetic', createdAt: 1 })),
    );
    const metadata = {
      id: 'doc',
      baseId: 'base',
      name: 'remote.txt',
      size: 7,
      type: 'text/plain',
      createdAt: 1,
    };
    const document = await applyCloudItem(
      'file:doc',
      packCloudItem('file:doc', 'content', metadata),
    );
    expect(document).toMatchObject(metadata);
    expect(await document!.blob.text()).toBe('content');
    expect(storeScans).not.toHaveBeenCalled();
    expect(baseScans).not.toHaveBeenCalled();
    storeScans.mockRestore();
    baseScans.mockRestore();
    const [committed] = await localKnowledge.listDocuments('base');
    expect(await committed.blob.text()).toBe('content');
    expect(document!.localRevision).toBe(committed.localRevision);
    expect(events).toEqual(['voxcue-sync-applied', 'voxcue-sync-applied']);
    await localKnowledge.saveBase({ id: 'base', name: 'Local edit', createdAt: 1 });
    expect(events.at(-1)).toBe('voxcue-local-change');
  });
  it('cold file ownership rejects mismatched identities, invalid parents and resume ownership', async () => {
    expect(
      await cloudFileParent(
        'file:doc',
        packCloudItem('file:doc', 'x', {
          id: 'doc',
          baseId: 'base',
        }),
      ),
    ).toBe('base:base');
    for (const metadata of [
      { id: 'other', baseId: 'base' },
      { id: 'doc', baseId: '../base' },
      { id: 'doc', baseId: 'personal-resume' },
      { id: 'doc', baseId: '' },
    ])
      await expect(
        cloudFileParent('file:doc', packCloudItem('file:doc', 'x', metadata)),
      ).rejects.toThrow();
    await expect(
      cloudFileParent(
        'file:doc',
        packCloudItem('file:other', 'x', {
          id: 'doc',
          baseId: 'base',
        }),
      ),
    ).rejects.toThrow('归属');
  });

  it('a cancelled file restore returns no document or applied event and preserves committed bytes', async () => {
    await localKnowledge.saveBase({ id: 'base', name: 'Synthetic', createdAt: 1 });
    await localKnowledge.importDocuments('base', [new File(['original'], 'original.txt')]);
    const [original] = await localKnowledge.listDocuments('base');
    const item = (await localCloudItems('knowledgebase')).find(
      (i) => i.key === 'file:' + original.id,
    )!;
    const hash = await digestCloudBlob(await item.blob());
    const events = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: events });
    await expect(
      applyCloudItem(
        item.key,
        packCloudItem(item.key, 'remote', {
          id: original.id,
          baseId: 'base',
          name: original.name,
          size: 6,
          type: 'text/plain',
          createdAt: 1,
        }),
        hash,
        undefined,
        () => {
          throw Error('synthetic account switch');
        },
      ),
    ).rejects.toThrow('synthetic account switch');
    expect(events).not.toHaveBeenCalled();
    const [saved] = await localKnowledge.listDocuments('base');
    expect(saved.localRevision).toBe(original.localRevision);
    expect(await saved.blob.text()).toBe('original');
  });
});
