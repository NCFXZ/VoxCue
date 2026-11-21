import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { temporaryDirectory } from '../temp';
import { KnowledgeCoordinator, validateKnowledge } from '../../electron/application/knowledge';
import { KnowledgeService } from '../../electron/backend/knowledge/service';
import * as indexing from '../../electron/backend/knowledge/eraseLibrary';
import type { KnowledgeCall, KnowledgeEvent, KnowledgeStatus } from '../../electron/contracts/knowledge';
import { documentRevision, localKnowledge, restoreSyncedDocument } from '../../src/services/knowledge';
import { createHash } from 'node:crypto';
import { useKnowledge } from '../../src/stores/knowledge';
import { useKnowledgeIndex } from '../../src/stores/knowledgeIndex';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const settings = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => settings.get(key) ?? null,
    setItem: (key: string, value: string) => settings.set(key, value),
    removeItem: (key: string) => settings.delete(key),
  });
  const directory = await temporaryDirectory('knowledge-selection');
  const listeners = new Set<(status: KnowledgeEvent) => void>();
  const events: KnowledgeStatus[] = [];
  const hooks: { after?: (call: KnowledgeCall) => Promise<void> } = {};
  const core: KnowledgeService = new KnowledgeService(directory, {
    initialize: async () => {}, close: async () => {}, count: text => text.length,
    encode: async texts => texts.map(() => Array.from({length: 384}, (_, i) => +(i === 0))),
  }, status => coordinator.progress(status));
  const coordinator: KnowledgeCoordinator = new KnowledgeCoordinator(core, directory, status => {
    if (!('type' in status)) events.push(status);
    for (const notify of listeners) notify(status);
  });
  const calls: KnowledgeCall['op'][] = [];
  vi.stubGlobal('window', { dispatchEvent: () => true, desktop: {
    onKnowledgeEvent(callback: (status: KnowledgeEvent) => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async knowledge(call: KnowledgeCall) {
      calls.push(call.op);
      try {
        const value = await coordinator.call(validateKnowledge(call));
        await hooks.after?.(call);
        return { ok: true, value };
      }
      catch (error) { return { ok: false, error: (error as Error).message }; }
    },
  } });
  const baseId = crypto.randomUUID();
  await localKnowledge.saveBase({ id: baseId, name: 'Synthetic', createdAt: 1 });
  useKnowledgeIndex.setState({ state: null, tasks: {}, requests: {}, error: null });
  useKnowledge.setState({ selectedId: baseId, busy: false });
  const disconnect = useKnowledgeIndex.getState().connect();
  await useKnowledgeIndex.getState().refresh();
  return { baseId, core, coordinator, calls, events, disconnect, hooks };
}

it('publishes one full-text index for a 20-file selection while preserving all originals and results', async () => {
  const files = Array.from({ length: 20 }, (_, i) => new File([Array.from({ length: 90 }, (_, section) =>
    '# Section ' + section + '\nSynthetic evidence ' + i + ' ' + section + (section === 0 ? ' commonterm' : '')).join('\n\n')], i + '.md'));
  const indexText = vi.spyOn(indexing, 'indexText');
  const runSelection = useKnowledgeIndex.getState().indexSelection;
  for (const batched of [false, true]) {
    const f = await fixture();
    let work: Promise<void> | undefined;
    useKnowledgeIndex.setState({ indexSelection(documents) {
      work = batched ? runSelection(documents) : Promise.all(documents.map(doc => useKnowledgeIndex.getState().index(doc))).then(() => {});
      return work;
    } });
    try {
      indexText.mockClear();
      const start = performance.now();
      await useKnowledge.getState().importFiles(files);
      expect(work).toBeDefined();
      await work;
      const elapsed = performance.now() - start;
      expect(indexText).toHaveBeenCalledTimes(batched ? 1 : 20);
      expect(f.calls.filter(op => op === 'import')).toHaveLength(20);
      expect(f.calls.filter(op => op === 'begin-index-batch')).toHaveLength(batched ? 1 : 0);
      expect(f.events.filter(e => e.phase === 'ready')).toHaveLength(20);
      expect(f.events.filter(e => e.phase === 'ready').every(e => !!e.requestId)).toBe(true);
      expect(await localKnowledge.listDocuments(f.baseId)).toHaveLength(20);
      expect((await f.core.listDocuments()).reduce((count, doc) => count + doc.chunkCount, 0)).toBe(1800);
      expect(await f.core.search('commonterm', 20, 'keyword', new AbortController().signal, f.baseId)).toHaveLength(20);
      if (process.env.VOXCUE_KNOWLEDGE_TIMING === '1') process.stdout.write(
        '20 files x 90 sections, ' + (batched ? 'grouped' : 'individual') + ': ' + Math.round(elapsed) + ' ms\n');
    } finally {
      f.disconnect(); await f.core.close();
      useKnowledgeIndex.setState({ indexSelection: runSelection });
    }
  }
}, 45_000);

it('keeps a failed file retryable and indexes the healthy originals after a partial selection fails', async () => {
  const f = await fixture();
  try {
    await useKnowledge.getState().importFiles([
      new File(['healthy searchable one'], 'one.md'), new File(['x'], 'short.md'), new File(['healthy searchable two'], 'two.md'),
    ]);
    await vi.waitFor(() => expect(Object.keys(useKnowledgeIndex.getState().requests)).toHaveLength(0), { timeout: 15000 });
    const originals = await localKnowledge.listDocuments(f.baseId);
    expect(originals).toHaveLength(3);
    expect((await f.core.listDocuments()).map(doc => doc.name).sort()).toEqual(['one.md', 'two.md']);
    const bad = originals.find(doc => doc.name === 'short.md')!;
    expect(f.events.filter(event => event.documentId === bad.id).at(-1)?.phase).toBe('failed');
    expect(f.events.filter(event => event.phase === 'ready')).toHaveLength(2);
    expect(useKnowledgeIndex.getState().libraryProgress).toEqual({});
  } finally { f.disconnect(); await f.core.close(); }
}, 20_000);

it('withdraws unpublished documents on owner disconnect while a later file is being read', async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const read = Blob.prototype.arrayBuffer;
  let reads = 0;
  vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(async function(this: Blob) {
    if (++reads === 2) { entered.resolve(); await release.promise; }
    return read.call(this);
  });
  const run = useKnowledgeIndex.getState().indexSelection;
  let work: Promise<void> | undefined;
  useKnowledgeIndex.setState({ indexSelection(docs) { return work = run(docs); } });
  try {
    await useKnowledge.getState().importFiles([new File(['first synthetic file'], 'one.md'), new File(['second synthetic file'], 'two.md')]);
    await entered.promise;
    expect(f.calls.filter(op => op === 'import')).toHaveLength(1);
    expect(await f.core.listDocuments()).toEqual([]);
    f.disconnect();
    expect(useKnowledgeIndex.getState().libraryProgress).toEqual({});
    f.coordinator.cancelAll();
    release.resolve();
    await work;
    expect(f.calls.filter(op => op === 'import')).toHaveLength(1);
    expect(await f.core.listDocuments()).toEqual([]);
    expect(f.events.filter(event => event.phase === 'ready')).toEqual([]);
    expect(await localKnowledge.listDocuments(f.baseId)).toHaveLength(2);
    expect(f.coordinator.busy).toBe(false);
  } finally {
    release.resolve(); f.disconnect(); await f.core.close(); useKnowledgeIndex.setState({ indexSelection: run });
  }
}, 15_000);

it('respects explicit cancellation of one already staged request when replaying the other members', async () => {
  const f = await fixture();
  try {
    await localKnowledge.importDocuments(f.baseId, [new File(['first synthetic file'], 'one.md'), new File(['second synthetic file'], 'two.md')]);
    const docs = await localKnowledge.listDocuments(f.baseId);
    let cancelled = false;
    f.hooks.after = async call => {
      if (call.op !== 'import' || !call.batchId || cancelled) return;
      cancelled = true;
      await f.coordinator.call({ op: 'cancel', requestId: call.requestId });
    };
    await useKnowledgeIndex.getState().indexSelection(docs);
    expect(cancelled).toBe(true);
    expect(useKnowledgeIndex.getState().libraryProgress).toEqual({});
    expect((await f.core.listDocuments()).map(doc => doc.documentId)).toEqual([docs[1].id]);
    expect(await localKnowledge.listDocuments(f.baseId)).toHaveLength(2);
    expect(f.events.filter(e => e.phase === 'ready').map(e => e.documentId)).toEqual([docs[1].id]);
  } finally { f.disconnect(); await f.core.close(); }
});

it.each(['local', 'cloud'] as const)('batch replay waits for a %s replacement transaction, including an aborted write', async source => {
  for (const abort of [false, true]) {
    const f = await fixture();
    const staged = Promise.withResolvers<void>(), allowStage = Promise.withResolvers<void>();
    const invalidated = Promise.withResolvers<void>(), allowWrite = Promise.withResolvers<void>();
    const rolledBack = Promise.withResolvers<void>();
    try {
      await localKnowledge.importDocuments(f.baseId, [new File(['old synthetic words'], 'one.md'), new File(['more synthetic words'], 'two.md')]);
      const docs = await localKnowledge.listDocuments(f.baseId), target = docs[0];
      let imports = 0;
      f.hooks.after = async call => {
        if (call.op === 'import' && ++imports === 1) { staged.resolve(); await allowStage.promise; }
        if (call.op === 'invalidate') { invalidated.resolve(); await allowWrite.promise; }
        if (call.op === 'finish-index-batch' && !call.commit) rolledBack.resolve();
      };
      const work = useKnowledgeIndex.getState().indexSelection(docs);
      await staged.promise;
      const replacement = new File(['new synthetic words'], target.name);
      const put = IDBObjectStore.prototype.put;
      const writer = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) {
        const request = put.apply(this, args);
        if (abort && this.name === 'documents') this.transaction.abort();
        return request;
      });
      const change = source === 'local' ? localKnowledge.importDocuments(f.baseId, [replacement]) :
        restoreSyncedDocument({ ...target, blob: replacement, size: replacement.size }, documentRevision(target));
      const result = abort ? expect(change).rejects.toThrow() : change;
      await invalidated.promise;
      allowStage.resolve();
      await rolledBack.promise;
      expect(imports).toBe(1);
      allowWrite.resolve();
      try { await result; } finally { writer.mockRestore(); }
      await work;
      const expected = abort ? await target.blob.text() : await replacement.text();
      await expect((await localKnowledge.listDocuments(f.baseId)).find(row => row.id === target.id)!.blob.text()).resolves.toBe(expected);
      expect((await f.core.listDocuments()).find(row => row.documentId === target.id)?.contentHash)
        .toBe(createHash('sha256').update(expected).digest('hex'));
    } finally {
      allowWrite.resolve(); allowStage.resolve(); f.disconnect(); await f.core.close();
    }
  }
}, 20_000);
