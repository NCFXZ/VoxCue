import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { localKnowledge, documentRevision, restoreSyncedBase, restoreSyncedDocument } from '../../src/services/knowledge';
import { markBaseRemoval } from '../../src/services/knowledgeIndex';
import { KNOWLEDGE_INDEX_VERSION } from '../../electron/contracts/knowledge';
import { useKnowledgeIndex } from '../../src/stores/knowledgeIndex';
import { useKnowledge } from '../../src/stores/knowledge';
import type {
  KnowledgeCall,
  KnowledgeDocument,
  KnowledgeStatus,
} from '../../electron/contracts/knowledge';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('window', { dispatchEvent: () => true });
  useKnowledgeIndex.setState({ state: null, tasks: {}, requests: {}, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function originals(baseId: string, count: number) {
  await localKnowledge.saveBase({ id: baseId, name: baseId, createdAt: 1 });
  for (let start = 0; start < count; start += 20)
    await localKnowledge.importDocuments(
      baseId,
      Array.from(
        { length: Math.min(20, count - start) },
        (_, i) => new File(['original ' + (start + i)], `${start + i}.txt`),
      ),
    );
  return localKnowledge.listDocuments(baseId);
}
function engine() {
  const indexed = new Map<string, KnowledgeDocument>();
  const imported: { id: string; text: string }[] = [];
  let active = 0,
    maximum = 0;
  let beforeImport: (() => Promise<void>) | undefined;
  let listener: ((status: KnowledgeStatus) => void) | undefined;
  const knowledge = vi.fn(async (call: KnowledgeCall) => {
    if (call.op === 'status')
      return { ok: true, value: { documents: [...indexed.values()], tasks: [], modelReady: true } };
    if (call.op !== 'import') return { ok: true, value: null };
    active++;
    maximum = Math.max(maximum, active);
    try {
      await beforeImport?.();
      imported.push({ id: call.documentId, text: new TextDecoder().decode(call.bytes) });
      const document = {
        documentId: call.documentId,
        baseId: call.baseId,
        indexVersion: KNOWLEDGE_INDEX_VERSION,
        available: true,
      } as KnowledgeDocument;
      indexed.set(call.documentId, document);
      return { ok: true, value: document };
    } finally {
      active--;
    }
  });
  vi.stubGlobal('window', {
    dispatchEvent: () => true,
    desktop: {
      knowledge,
      onKnowledgeEvent: (callback: typeof listener) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      },
    },
  });
  return {
    indexed,
    imported,
    knowledge,
    emit(status: KnowledgeStatus) {
      listener?.(status);
    },
    get maximum() {
      return maximum;
    },
    before(work: typeof beforeImport) {
      beforeImport = work;
    },
  };
}

it('80 imports and duplicate requests stay serial and preserve every original', async () => {
  const docs = await originals('bulk', 80);
  const f = engine();
  const list = vi.spyOn(localKnowledge, 'listDocuments');
  const read = vi.spyOn(IDBObjectStore.prototype, 'get');
  const work = docs.flatMap((doc) => [
    useKnowledgeIndex.getState().index(doc),
    useKnowledgeIndex.getState().index(doc),
  ]);
  await Promise.all(work);
  expect(list).not.toHaveBeenCalled();
  expect(read.mock.calls.map(([id]) => id)).toEqual(docs.map(doc => doc.id));
  await useKnowledgeIndex.getState().refresh();
  expect(f.maximum).toBe(1);
  expect(f.imported).toHaveLength(80);
  expect(new Set(f.imported.map((doc) => doc.id)).size).toBe(80);
});

it.each(['document', 'library'])('a pending file read cannot index after %s deletion', async (mode) => {
  const [doc] = await originals('delete-during-read', 1);
  const f = engine();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return new ArrayBuffer(4);
  });
  const work = useKnowledgeIndex.getState().index(doc);
  await entered.promise;
  try {
    if (mode === 'document') await localKnowledge.deleteDocument(doc.id);
    else await localKnowledge.deleteBase(doc.baseId);
  } finally {
    release.resolve();
  }
  await work;
  const removals = f.knowledge.mock.calls.map(([call]) => call).filter(call => call.op.startsWith('remove'));
  expect(removals).toEqual([mode === 'document'
    ? { op: 'remove', requestId: expect.any(String), documentId: doc.id }
    : { op: 'remove-base', requestId: expect.any(String), baseId: doc.baseId }]);
  expect(f.imported).toEqual([]);
  expect(await localKnowledge.listDocuments(doc.baseId)).toEqual([]);
});

it('retries an interrupted native deletion on startup without reindexing pending originals or removing other libraries', async () => {
  const [one] = await originals('pending', 2);
  const [keep] = await originals('retained', 1);
  const f = engine();
  f.knowledge.mockRejectedValueOnce(Error('simulated lost reply after index removal'));
  await expect(localKnowledge.deleteBase(one.baseId)).rejects.toThrow('lost reply');
  const [target] = (await localKnowledge.listBases()).filter(base => base.id === one.baseId);
  await expect(localKnowledge.importDocuments(one.baseId, [new File(['new'], 'after-failure.txt')])).rejects.toThrow('正在删除');
  await expect(localKnowledge.saveBase({ ...target, name: 'renamed' })).rejects.toThrow('正在删除');
  await expect(restoreSyncedBase({ ...target, name: 'from cloud' }, documentRevision(target))).rejects.toThrow('正在删除');
  await expect(restoreSyncedDocument({ ...one, id: 'new-cloud-doc' }, null)).rejects.toThrow('正在删除');
  await localKnowledge.importDocuments(keep.baseId, [new File(['other'], 'other.txt')]);
  expect(await localKnowledge.listDocuments(one.baseId)).toHaveLength(2);
  await useKnowledgeIndex.getState().index(one);
  expect(f.imported).toEqual([]);
  await useKnowledgeIndex.getState().reconcile();
  expect(new Set(f.imported.map(row => row.id))).toEqual(new Set((await localKnowledge.listDocuments(keep.baseId)).map(row => row.id)));
  const disconnect = useKnowledgeIndex.getState().connect();
  try {
    await vi.waitFor(async () => expect(await localKnowledge.listDocuments(one.baseId)).toEqual([]));
    expect((await localKnowledge.listBases()).map(base => base.id)).toEqual(['retained']);
    const removals = f.knowledge.mock.calls.map(([call]) => call).filter(call => call.op === 'remove-base');
    expect(removals.map(call => call.baseId)).toEqual(['pending', 'pending']);
  } finally { disconnect(); }
});

it('checks the deletion intent again inside the cloud restore write transaction', async () => {
  const [doc] = await originals('during-commit', 1);
  const beginDeletion = () => markBaseRemoval(doc.baseId, true);
  await expect(restoreSyncedDocument({ ...doc, name: 'changed.txt' }, documentRevision(doc), beginDeletion))
    .rejects.toThrow('正在删除');
  expect((await localKnowledge.listDocuments(doc.baseId))[0].name).toBe(doc.name);
});

it('keeps a same-name cloud original that arrived after the local import checked its replacement targets', async () => {
  const base = 'cross-write';
  await originals(base, 0);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const list = localKnowledge.listDocuments;
  vi.spyOn(localKnowledge, 'listDocuments').mockImplementationOnce(async id => {
    const snapshot = await list(id);
    entered.resolve();
    await release.promise;
    return snapshot;
  });
  const file = new File(['incoming local content'], 'same.md');
  const local = expect(localKnowledge.importDocuments(base, [file])).rejects.toThrow('文件已更改');
  try {
    await entered.promise;
    const cloud = new File(['incoming cloud content'], file.name);
    await restoreSyncedDocument({ id: 'remote-file', baseId: base, name: cloud.name, blob: cloud,
      size: cloud.size, type: cloud.type, createdAt: 1 }, null);
  } finally { release.resolve(); }
  await local;
  const stored = await list(base);
  expect(stored.map(doc => doc.id)).toEqual(['remote-file']);
  await expect(stored[0].blob.text()).resolves.toBe('incoming cloud content');
});

it('blocks indexing an original arriving while its library deletion is pending', async () => {
  const [doc] = await originals('removing-library', 1);
  const f = engine();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.knowledge.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return { ok: true, value: null };
  });
  const removing = localKnowledge.deleteBase(doc.baseId);
  await entered.promise;
  try {
    await expect(localKnowledge.importDocuments(doc.baseId, [new File(['late'], 'late.txt')])).rejects.toThrow('正在删除');
    expect((await localKnowledge.listDocuments(doc.baseId)).map(d => d.name)).toEqual([doc.name]);
    await useKnowledgeIndex.getState().index(doc);
  } finally {
    release.resolve();
    await removing;
  }
  expect(f.imported).toEqual([]);
  expect(await localKnowledge.listDocuments(doc.baseId)).toEqual([]);
});

it('interleaved requests finish every queued file in the active library before the next library', async () => {
  const a = await originals('group-a', 3),
    b = await originals('group-b', 3);
  const f = engine();
  const work = a.flatMap((doc, i) => [
    useKnowledgeIndex.getState().index(doc),
    useKnowledgeIndex.getState().index(b[i]),
  ]);
  await Promise.all(work);
  const owner = new Map([
    ...a.map((doc) => [doc.id, 'a'] as const),
    ...b.map((doc) => [doc.id, 'b'] as const),
  ]);
  expect(f.imported.map((doc) => owner.get(doc.id))).toEqual(['a', 'a', 'a', 'b', 'b', 'b']);
  expect(f.maximum).toBe(1);
});

it('a received file indexes immediately without waiting for later files in the library', async () => {
  const [first] = await originals('restoring', 1);
  const f = engine();
  await useKnowledgeIndex.getState().index(first);
  expect(f.imported.map((doc) => doc.id)).toEqual([first.id]);
  await localKnowledge.importDocuments('restoring', [new File(['second'], 'second.txt')]);
  await useKnowledgeIndex.getState().reconcile('restoring');
  expect(f.imported).toHaveLength(2);
  expect(f.imported.some((doc) => doc.id === first.id)).toBe(true);
  expect(f.maximum).toBe(1);
});

it('a library scan does not reimport a downloaded original indexed while its document read is pending', async () => {
  const [original] = await originals('downloading', 1);
  const f = engine();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.spyOn(localKnowledge, 'listDocuments').mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return [original];
  });
  const scan = useKnowledgeIndex.getState().reconcile(original.baseId);
  await entered.promise;
  await useKnowledgeIndex.getState().index(original);
  release.resolve();
  await scan;
  expect(f.imported.map((entry) => entry.id)).toEqual([original.id]);
});

it('a scan sharing a pre-commit status reply rechecks it before scheduling an import', async () => {
  const [original] = await originals('stale-status', 1);
  const f = engine();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.knowledge.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return { ok: true, value: { documents: [], tasks: [], modelReady: true } };
  });
  const earlyStatus = useKnowledgeIndex.getState().refresh();
  await entered.promise;
  const indexing = useKnowledgeIndex.getState().index(original);
  const listed = Promise.withResolvers<void>();
  let scan: Promise<void>;
  try {
    await vi.waitFor(() => {
      expect(f.imported).toHaveLength(1);
      expect(useKnowledgeIndex.getState().requests[original.id]).toBeUndefined();
    });
    vi.spyOn(localKnowledge, 'listDocuments').mockImplementationOnce(async () => {
      listed.resolve();
      return [original];
    });
    scan = useKnowledgeIndex.getState().reconcile(original.baseId);
    await listed.promise;
  } finally {
    release.resolve();
  }
  await Promise.all([earlyStatus, scan, indexing]);
  expect(f.imported.map((entry) => entry.id)).toEqual([original.id]);
});

it('startup repairs missing/unavailable indexes; opening a library checks only that library', async () => {
  const a = await originals('a', 2),
    b = await originals('b', 1);
  const f = engine();
  f.indexed.set(a[0].id, {
    documentId: a[0].id,
    baseId: 'a',
    indexVersion: KNOWLEDGE_INDEX_VERSION,
    available: true,
  } as KnowledgeDocument);
  f.indexed.set(a[1].id, {
    documentId: a[1].id,
    baseId: 'a',
    indexVersion: KNOWLEDGE_INDEX_VERSION,
    available: false,
  } as KnowledgeDocument);
  const scan = useKnowledgeIndex.getState().reconcile();
  expect(useKnowledgeIndex.getState().reconcile()).toBe(scan);
  const current = useKnowledgeIndex.getState().reconcile('a');
  expect(useKnowledgeIndex.getState().reconcile('a')).toBe(current);
  await Promise.all([scan, current]);
  expect(f.imported.map((doc) => doc.id).sort()).toEqual([a[1].id, b[0].id].sort());
  await localKnowledge.importDocuments('a', [new File(['late a'], 'late.txt')]);
  await localKnowledge.importDocuments('b', [new File(['late b'], 'late.txt')]);
  await useKnowledge.getState().open('a');
  await vi.waitFor(() => expect(f.imported.some((doc) => doc.text === 'late a')).toBe(true));
  expect(f.imported.some((doc) => doc.text === 'late b')).toBe(false);
  await useKnowledgeIndex.getState().reconcile('a');
  expect(f.imported).toHaveLength(3);
});

it('waits for native cleanup, then rebuilds surviving originals once from the clean catalog', async () => {
  const [old, mixed] = await originals('upgrade', 2);
  const [legacy] = await originals('other-upgrade', 1);
  const f = engine();
  for (const [doc, version] of [[old, 'qa-linked-v2'], [mixed, KNOWLEDGE_INDEX_VERSION], [legacy, undefined]] as const)
    f.indexed.set(doc.id, { documentId: doc.id, baseId: doc.baseId, indexVersion: version, available: true } as KnowledgeDocument);
  f.indexed.set('missing-original', { documentId: 'missing-original', baseId: 'lost', indexVersion: 'qa-linked-v2' } as KnowledgeDocument);
  const cleaning = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.knowledge.mockImplementationOnce(async call => {
    expect(call.op).toBe('status');
    cleaning.resolve();
    await release.promise;
    f.indexed.clear();
    return { ok: true, value: { documents: [], tasks: [], modelReady: true } };
  });
  const scan = useKnowledgeIndex.getState().reconcile();
  await cleaning.promise;
  expect(f.knowledge.mock.calls.map(([call]) => call.op)).toEqual(['status']);
  release.resolve();
  await scan;
  await useKnowledgeIndex.getState().reconcile();
  expect(f.imported.map(doc => doc.id).sort()).toEqual([old.id, mixed.id, legacy.id].sort());
  expect(f.indexed.has('missing-original')).toBe(false);
  expect(await (await localKnowledge.listDocuments(old.baseId)).find(doc => doc.id === old.id)!.blob.text()).toMatch(/^original /);
});
it('does not import after native cleanup fails or returns an unclean catalog', async () => {
  const [doc] = await originals('old', 1);
  const f = engine();
  await useKnowledgeIndex.getState().refresh();
  const error = '旧索引清理尚未完成，请重试。';
  f.knowledge.mockImplementationOnce(async () => ({
    ok: true, value: { documents: [], tasks: [], modelReady: true, error },
  }));
  await useKnowledgeIndex.getState().reconcile();
  expect(useKnowledgeIndex.getState().error).toBe(error);
  useKnowledgeIndex.getState().dismissError();
  f.knowledge.mockRejectedValueOnce(Error(error));
  await useKnowledgeIndex.getState().reconcile();
  expect(useKnowledgeIndex.getState().state).toBeNull();
  f.indexed.set(doc.id, { documentId: doc.id, baseId: doc.baseId, indexVersion: 'qa-linked-v2' } as KnowledgeDocument);
  await useKnowledgeIndex.getState().reconcile();
  expect(f.knowledge.mock.calls.every(([call]) => call.op === 'status')).toBe(true);
});

it('queued deletions are skipped and replacements use their latest committed bytes', async () => {
  const docs = await originals('edits', 3);
  const f = engine();
  const readBytes = vi.spyOn(Blob.prototype, 'arrayBuffer');
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let entered = false;
  f.before(async () => {
    entered = true;
    await held;
  });
  const work = docs.map((doc) => useKnowledgeIndex.getState().index(doc));
  await vi.waitFor(() => expect(entered).toBe(true));
  expect(readBytes).toHaveBeenCalledTimes(1);
  await localKnowledge.deleteDocument(docs[1].id);
  await localKnowledge.importDocuments('edits', [new File(['replacement'], docs[2].name)]);
  release();
  await Promise.all(work);
  expect(f.imported).toEqual([
    { id: docs[0].id, text: await docs[0].blob.text() },
    { id: docs[2].id, text: 'replacement' },
  ]);
});

it('failed revisions respect the exact cooldown boundary, explicit force and committed replacements', async () => {
  const [original] = await originals('cooldown', 1);
  const f = engine();
  f.before(async () => {
    throw Error('synthetic failure');
  });
  let now = 100_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const imports = () =>
    f.knowledge.mock.calls.map(([call]) => call).filter((call) => call.op === 'import');
  await useKnowledgeIndex.getState().index(original);
  now += 59_999;
  await useKnowledgeIndex.getState().reconcile('cooldown');
  expect(imports()).toHaveLength(1);
  now++;
  await useKnowledgeIndex.getState().reconcile('cooldown');
  expect(imports()).toHaveLength(2);
  await useKnowledgeIndex.getState().index(original, true);
  expect(imports()).toHaveLength(3);
  await localKnowledge.importDocuments('cooldown', [new File(['updated'], original.name)]);
  await useKnowledgeIndex.getState().reconcile('cooldown');
  expect(imports()).toHaveLength(4);
  expect(new TextDecoder().decode(imports().at(-1)!.bytes)).toBe('updated');
});

it('failed-attempt retention is bounded to 256 revisions without blocking newer files', async () => {
  const docs = await originals('bounded-failures', 257);
  const f = engine();
  f.before(async () => {
    throw Error('synthetic failure');
  });
  const imports = () => f.knowledge.mock.calls.filter(([call]) => call.op === 'import');
  await Promise.all(docs.map((doc) => useKnowledgeIndex.getState().index(doc)));
  expect(imports()).toHaveLength(257);
  expect(f.maximum).toBe(1);
  await useKnowledgeIndex.getState().index(docs.at(-1)!);
  expect(imports()).toHaveLength(257);
  await useKnowledgeIndex.getState().index(docs[0]);
  expect(imports()).toHaveLength(258);
  expect((await localKnowledge.listDocuments('bounded-failures')).length).toBe(257);
});

it('status refreshes share one request and repeated scans back off after an index failure', async () => {
  await originals('failure', 1);
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let reads = 0,
    imports = 0;
  vi.stubGlobal('window', {
    dispatchEvent: () => true,
    desktop: {
      knowledge: async (call: KnowledgeCall) => {
        if (call.op === 'status') {
          reads++;
          await held;
          return { ok: true, value: { documents: [], tasks: [], modelReady: true } };
        }
        imports++;
        return { ok: false, error: 'synthetic failure' };
      },
    },
  });
  const refreshes = Array.from({ length: 100 }, () => useKnowledgeIndex.getState().refresh());
  expect(reads).toBe(1);
  release();
  await Promise.all(refreshes);
  await useKnowledgeIndex.getState().reconcile();
  await useKnowledgeIndex.getState().reconcile();
  expect(imports).toBe(1);
  expect((await localKnowledge.listDocuments('failure')).length).toBe(1);
});

it('status reads retain queued replacements and old request events cannot overwrite them', async () => {
  const [original] = await originals('events', 1);
  const f = engine();
  let release!: () => void,
    entered = false;
  const held = new Promise<void>((r) => {
    release = r;
  });
  f.before(async () => {
    entered = true;
    await held;
  });
  const disconnect = useKnowledgeIndex.getState().connect();
  try {
    const first = useKnowledgeIndex.getState().index(original);
    await vi.waitFor(() => expect(entered).toBe(true));
    const oldRequest = useKnowledgeIndex.getState().requests[original.id];
    await localKnowledge.importDocuments('events', [new File(['replacement'], original.name)]);
    const [replacement] = await localKnowledge.listDocuments('events');
    const next = useKnowledgeIndex.getState().index(replacement);
    const currentRequest = useKnowledgeIndex.getState().requests[original.id];
    expect(currentRequest).not.toBe(oldRequest);
    const queued = useKnowledgeIndex.getState().tasks[original.id];
    f.emit({
      documentId: original.id,
      requestId: oldRequest,
      phase: 'embedding',
      completed: 1,
      total: 2,
    });
    await useKnowledgeIndex.getState().refresh();
    expect(useKnowledgeIndex.getState().tasks[original.id]).toEqual(queued);
    expect(useKnowledgeIndex.getState().requests[original.id]).toBe(currentRequest);
    release();
    await Promise.all([first, next]);
    expect(f.imported.map((doc) => doc.text)).toEqual(['original 0', 'replacement']);
    expect(useKnowledgeIndex.getState().requests).toEqual({});
    expect(f.maximum).toBe(1);
  } finally {
    release();
    disconnect();
  }
});

it('an open-library check after a running global scan also repairs originals received during that scan', async () => {
  await originals('scan-a', 1);
  const f = engine();
  let release!: () => void,
    entered = false;
  const held = new Promise<void>((r) => {
    release = r;
  });
  f.before(async () => {
    entered = true;
    await held;
  });
  const global = useKnowledgeIndex.getState().reconcile();
  await vi.waitFor(() => expect(entered).toBe(true));
  await localKnowledge.importDocuments('scan-a', [new File(['arrived during scan'], 'late.txt')]);
  const narrow = useKnowledgeIndex.getState().reconcile('scan-a');
  expect(useKnowledgeIndex.getState().reconcile('scan-a')).toBe(narrow);
  release();
  await Promise.all([global, narrow]);
  expect(f.imported.map((doc) => doc.text)).toEqual(['original 0', 'arrived during scan']);
  expect(f.maximum).toBe(1);
});

it('a queued old-library check keeps its error scope after the library is closed', async () => {
  await originals('old-library', 1);
  const f = engine();
  let release!: () => void,
    entered = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.before(async () => {
    entered = true;
    await held;
  });
  const global = useKnowledgeIndex.getState().reconcile();
  await vi.waitFor(() => expect(entered).toBe(true));
  const queued = useKnowledgeIndex.getState().reconcile('old-library');
  useKnowledgeIndex.getState().dismissError();
  const read = vi
    .spyOn(localKnowledge, 'listDocuments')
    .mockRejectedValue(Error('旧知识库读取失败'));
  release();
  await Promise.all([global, queued]);
  expect(read).toHaveBeenCalledWith('old-library');
  expect(f.imported).toHaveLength(1);
  expect(useKnowledgeIndex.getState().error).toBeNull();
});

it('a replacement during an active import gets one subsequent job with current bytes', async () => {
  const [original] = await originals('active-edit', 1);
  const f = engine();
  let release!: () => void,
    entered = false;
  const held = new Promise<void>((r) => {
    release = r;
  });
  f.before(async () => {
    entered = true;
    await held;
  });
  const first = useKnowledgeIndex.getState().index(original);
  await vi.waitFor(() => expect(entered).toBe(true));
  await localKnowledge.importDocuments('active-edit', [new File(['new bytes'], original.name)]);
  const [replacement] = await localKnowledge.listDocuments('active-edit');
  const next = useKnowledgeIndex.getState().index(replacement);
  expect(useKnowledgeIndex.getState().index(replacement)).toBe(next);
  release();
  await Promise.all([first, next]);
  expect(f.imported.map((doc) => doc.text)).toEqual(['original 0', 'new bytes']);
  expect(f.maximum).toBe(1);
});

it('the final consumer disconnect cancels its active request and discards queued work', async () => {
  const docs = await originals('shutdown', 3);
  const f = engine();
  let release!: () => void,
    entered = false;
  const held = new Promise<void>((r) => {
    release = r;
  });
  f.before(async () => {
    entered = true;
    await held;
  });
  const disconnect = useKnowledgeIndex.getState().connect();
  const work = docs.map((doc) => useKnowledgeIndex.getState().index(doc));
  await vi.waitFor(() => expect(entered).toBe(true));
  disconnect();
  release();
  await Promise.all(work);
  expect(f.knowledge.mock.calls.filter(([call]) => call.op === 'cancel')).toHaveLength(1);
  expect(f.imported).toHaveLength(1);
  expect(useKnowledgeIndex.getState().requests).toEqual({});
});
