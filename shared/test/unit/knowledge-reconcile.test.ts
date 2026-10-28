import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { localKnowledge } from '../../src/services/knowledge';
import { useKnowledgeIndex } from '../../src/stores/knowledgeIndex';
import { useKnowledge } from '../../src/stores/knowledge';
import type {
  KnowledgeCall,
  KnowledgeDocument,
  KnowledgeStatus,
} from '../../electron/contracts/knowledge';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
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
  const work = docs.flatMap((doc) => [
    useKnowledgeIndex.getState().index(doc),
    useKnowledgeIndex.getState().index(doc),
  ]);
  await Promise.all(work);
  await useKnowledgeIndex.getState().refresh();
  expect(f.maximum).toBe(1);
  expect(f.imported).toHaveLength(80);
  expect(new Set(f.imported.map((doc) => doc.id)).size).toBe(80);
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

it('startup repairs missing/unavailable indexes; opening a library checks only that library', async () => {
  const a = await originals('a', 2),
    b = await originals('b', 1);
  const f = engine();
  f.indexed.set(a[0].id, {
    documentId: a[0].id,
    baseId: 'a',
    available: true,
  } as KnowledgeDocument);
  f.indexed.set(a[1].id, {
    documentId: a[1].id,
    baseId: 'a',
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
