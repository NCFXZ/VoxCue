import { createHash } from 'node:crypto';
import path from 'node:path';
import { KNOWLEDGE_INDEX_VERSION, validKnowledgeId, type KnowledgeDocument, type KnowledgeEvent,
  type KnowledgeHit, type KnowledgeItemExpectation, type KnowledgeMode } from '../../contracts/knowledge';
import { abortable } from '../cancellable';
import type { Catalog } from './eraseLibrary';
import { KnowledgeError } from './errors';
import { checkedDirectory, ensurePublishedLibrary, invalidLayout, libraryDirectory, libraryKey,
  libraryPaths, ownerOf, readJson, readLayout, removeLibraryFolder } from './libraryLayout';
import { MODEL_REVISION, type DocumentInput, type KnowledgePort, type KnowledgeSearchOptions, type PrepareKnowledgeDatabase } from './types';
import { KnowledgeProcess, LibraryKnowledgeHost } from './workerHost';

interface LibraryWorker {
  readonly host: LibraryKnowledgeHost;
  readonly scope: AbortController;
  readonly requests: Set<Promise<unknown>>;
  created?: Promise<void>;
  retiring?: Promise<void>;
}

const emptyVersion = createHash('sha256').update('[]').digest('hex');
const removing = () => new KnowledgeError('cancelled', '这个知识库正在删除，暂时无法写入资料。');

/** Routes a profile's requests to independently owned library databases. */
export class KnowledgeHost implements KnowledgePort {
  indexCleanupError?: string;
  private ready?: Promise<void>;
  private migration?: KnowledgeProcess;
  private lifetime = new AbortController();
  private closing?: Promise<void>;
  private readonly workers = new Map<string, LibraryWorker>();
  private readonly batches = new Map<string, string>();
  private readonly indexWrites = new Map<Promise<KnowledgeDocument>, Pick<DocumentInput, 'documentId' | 'baseId'>>();
  private readonly removals = new Map<string, Promise<null>>();

  constructor(private readonly root: string, private readonly modelPath: string,
    private readonly progress: (event: KnowledgeEvent) => void = () => {},
    private readonly prepareDatabase?: PrepareKnowledgeDatabase) {}

  async initialize() {
    this.lifetime.signal.throwIfAborted();
    return this.ready ??= (async () => {
      const layout = await readLayout(this.root);
      this.lifetime.signal.throwIfAborted();
      if (layout && !layout.legacy && !this.migration) return;
      const migration = this.migration ??= new KnowledgeProcess(this.root, this.modelPath, undefined, this.prepareDatabase, true);
      try {
        if (!layout || layout.legacy) await migration.initialize();
      } finally {
        await migration.stopAndWait();
        this.migration = undefined;
      }
    })().catch(error => { this.ready = undefined; throw error; });
  }

  private async run<T>(baseId: string, signal: AbortSignal | undefined,
    action: (host: LibraryKnowledgeHost, scope: AbortSignal) => Promise<T>, create = false): Promise<T | undefined> {
    const folder = path.join(this.root, libraryDirectory, libraryKey(baseId));
    const profile = this.lifetime.signal;
    const request = signal ? AbortSignal.any([profile, signal]) : profile;
    request.throwIfAborted();
    await abortable(this.initialize(), request);
    if (this.removals.has(baseId)) {
      if (create) throw removing();
      return;
    }
    let worker = this.workers.get(baseId);
    if (worker?.scope.signal.aborted) {
      await abortable(this.retire(baseId, worker), request);
      return this.run(baseId, request, action, create);
    }
    if (!worker) {
      worker = { host: new LibraryKnowledgeHost(folder, this.modelPath, this.progress, this.prepareDatabase),
        scope: new AbortController(), requests: new Set() };
      this.workers.set(baseId, worker);
    }
    const selected = worker;
    const scope = AbortSignal.any([request, selected.scope.signal]);
    const work = (async () => {
      if (create) selected.created ??= ensurePublishedLibrary(this.root, baseId).catch(error => {
        selected.created = undefined;
        throw error;
      });
      if (selected.created) await selected.created;
      else {
        if (!(await checkedDirectory(folder))) return;
        if (await ownerOf(folder) !== baseId) throw invalidLayout();
      }
      scope.throwIfAborted();
      return action(selected.host, scope);
    })();
    selected.requests.add(work);
    try { return await work; }
    finally {
      selected.requests.delete(work);
      // Keep the current library warm, without retaining a model per library
      // the user has visited. An open batch still owns its writer.
      const staged = new Set(this.batches.values());
      for (const [id, idle] of this.workers) {
        if (id !== baseId && !idle.requests.size && !staged.has(id) && !this.removals.has(id))
          void this.retire(id, idle).catch(() => {});
      }
    }
  }

  private retire(baseId: string, worker: LibraryWorker) {
    worker.scope.abort();
    return worker.retiring ??= (async () => {
      const stopped = worker.host.stopAndWait();
      const [result] = await Promise.allSettled([stopped, ...worker.requests]);
      if (result.status === 'rejected') throw result.reason;
      if (this.workers.get(baseId) === worker) this.workers.delete(baseId);
    })().finally(() => { worker.retiring = undefined; });
  }

  private async catalog(baseId: string, folder: string) {
    const catalog = await readJson(path.join(folder, 'catalog.json')) as Catalog | undefined;
    if (catalog === undefined) return;
    if (catalog?.schemaVersion !== 1 || catalog.modelVersion !== MODEL_REVISION ||
        !catalog.documents || typeof catalog.documents !== 'object' || Array.isArray(catalog.documents) ||
        (catalog.blocked !== undefined && !Array.isArray(catalog.blocked)) ||
        Object.entries(catalog.documents).some(([id, entry]) => !validKnowledgeId(id) ||
          entry?.document?.documentId !== id || entry.document.baseId !== baseId)) throw invalidLayout();
    return catalog;
  }

  private async catalogs(signal = this.lifetime.signal) {
    await abortable(this.initialize(), signal);
    const sources = new Map<string, Catalog>();
    for (const [id, folder] of await libraryPaths(this.root)) {
      signal.throwIfAborted();
      if (this.removals.has(id)) continue;
      const catalog = await this.catalog(id, folder);
      if (catalog && !this.removals.has(id)) sources.set(id, catalog);
    }
    return sources;
  }

  async beginIndexBatch(id: string, baseId: string, documentIds: string[], signal: AbortSignal) {
    this.batches.set(id, baseId);
    try {
      await this.run(baseId, signal, (host, scope) => host.beginIndexBatch(id, baseId, documentIds, scope), true);
    } catch (error) {
      this.batches.delete(id);
      throw error;
    }
  }

  async finishIndexBatch(id: string, commit: boolean, signal: AbortSignal) {
    const baseId = this.batches.get(id);
    if (!baseId && commit) throw new KnowledgeError('cancelled', '知识库导入批次已取消。');
    if (!baseId) return;
    try {
      await this.run(baseId, signal, (host, scope) => host.finishIndexBatch(id, commit, scope));
    } finally { this.batches.delete(id); }
  }

  indexDocument(input: DocumentInput, signal: AbortSignal) {
    const work = this.writeIndex(input, signal);
    this.indexWrites.set(work, { documentId: input.documentId, baseId: input.baseId });
    return work.finally(() => { this.indexWrites.delete(work); });
  }

  private async writeIndex(input: DocumentInput, signal: AbortSignal) {
    const catalogs = await this.catalogs(signal);
    for (const [id, catalog] of catalogs) {
      // Cloud restore can move an existing document ID into a different library.
      // Withdraw the old live entry while keeping its recovery history in its own library.
      if (id !== input.baseId && Object.hasOwn(catalog.documents, input.documentId) && !catalog.blocked?.includes(input.documentId))
        await this.run(id, signal, (host, scope) => host.invalidateDocument(input.documentId, scope));
    }
    const document = await this.run(input.baseId, signal, (host, scope) => host.indexDocument(input, scope), true);
    if (!document) throw removing();
    return document;
  }
  updateDocument(input: DocumentInput, signal: AbortSignal) { return this.indexDocument(input, signal); }

  private async mutateDocument(op: 'invalidateDocument' | 'removeDocument', documentId: string, signal: AbortSignal): Promise<null> {
    const libraries = new Set<string>();
    // A cancelled writer can already be publishing its first catalog. Route
    // the mutation through its own worker even when disk has no entry yet.
    for (const input of this.indexWrites.values())
      if (input.documentId === documentId) libraries.add(input.baseId);
    for (const [id, catalog] of await this.catalogs(signal))
      if (Object.hasOwn(catalog.documents, documentId)) libraries.add(id);
    for (const id of libraries)
      await this.run(id, signal, (host, scope) => host[op](documentId, scope));
    return null;
  }
  invalidateDocument(documentId: string, signal: AbortSignal) { return this.mutateDocument('invalidateDocument', documentId, signal); }
  removeDocument(documentId: string, signal: AbortSignal) { return this.mutateDocument('removeDocument', documentId, signal); }

  async removeBase(baseId: string, signal: AbortSignal): Promise<null> {
    if (!validKnowledgeId(baseId) || baseId === 'personal-resume') throw new KnowledgeError('invalid_request', '无效知识库 ID。');
    const existing = this.removals.get(baseId);
    if (existing) return existing;
    const scope = AbortSignal.any([signal, this.lifetime.signal]);
    const work = (async () => {
      await abortable(this.initialize(), scope);
      const worker = this.workers.get(baseId);
      if (worker) await this.retire(baseId, worker);
      await removeLibraryFolder(this.root, baseId, scope);
      return null;
    })().finally(() => { this.removals.delete(baseId); });
    this.removals.set(baseId, work);
    return work;
  }

  async listDocuments(allowIndexCleanup = true) {
    const documents = new Map<string, KnowledgeDocument>();
    this.indexCleanupError = undefined;
    for (const [id, catalog] of await this.catalogs()) {
      if (this.removals.has(id)) continue;
      const needCleanup = allowIndexCleanup && (!!catalog.indexUpgrade ||
        Object.values(catalog.documents).some(entry => entry.document.indexVersion !== KNOWLEDGE_INDEX_VERSION));
      const worker = this.workers.get(id);
      const rows = needCleanup || (worker && !worker.scope.signal.aborted)
        ? await this.run(id, undefined, async (host, scope) => {
            const rows = await host.listDocuments(allowIndexCleanup, scope);
            this.indexCleanupError ??= host.indexCleanupError;
            return rows;
          }) ?? []
        : Object.values(catalog.documents).map(({ document }) => ({ ...document,
            available: document.indexVersion === KNOWLEDGE_INDEX_VERSION && !catalog.blocked?.includes(document.documentId),
          }));
      for (const row of rows) {
        if (this.removals.has(id)) break;
        if (!documents.has(row.documentId) || row.available !== false) documents.set(row.documentId, row);
      }
    }
    return [...documents.values()];
  }

  async search(query: string, topK = 10, mode: KnowledgeMode = 'hybrid', signal: AbortSignal, baseId?: string, options?: KnowledgeSearchOptions) {
    const search = async (id: string) => await this.run(id, signal, (host, scope) => host.search(query, topK, mode, scope, id, options)) ?? [];
    if (baseId !== undefined) return search(baseId);
    const hits: KnowledgeHit[] = [];
    for (const [id, catalog] of await this.catalogs(signal)) {
      if (Object.keys(catalog.documents).length) hits.push(...await search(id));
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async version(baseId: string, signal: AbortSignal) {
    return await this.run(baseId, signal, (host, scope) => host.version(baseId, scope)) ?? emptyVersion;
  }

  async getItem(itemId: string, signal?: AbortSignal, expected?: KnowledgeItemExpectation) {
    if (expected) return await this.run(expected.baseId, signal, (host, scope) => host.getItem(itemId, scope, expected)) ?? null;
    const documentId = itemId.split(':', 1)[0];
    for (const [baseId, catalog] of await this.catalogs(signal)) {
      if (!Object.hasOwn(catalog.documents, documentId) || catalog.blocked?.includes(documentId)) continue;
      const item = await this.run(baseId, signal, (host, scope) => host.getItem(itemId, scope));
      if (item) return item;
    }
    return null;
  }

  async getEvidenceItem(hit: KnowledgeHit, signal: AbortSignal, expected?: KnowledgeItemExpectation) {
    const baseId = expected?.baseId ?? hit.baseId;
    return baseId ? await this.run(baseId, signal, (host, scope) => host.getEvidenceItem(hit, scope, expected)) ?? null : null;
  }

  stop() {
    this.lifetime.abort();
    this.migration?.stop();
    for (const worker of this.workers.values()) {
      worker.scope.abort();
      worker.host.stop();
    }
  }

  close() {
    return this.closing ??= (async () => {
      this.stop();
      const result = await Promise.allSettled([
        ...(this.migration ? [this.migration.stopAndWait()] : []),
        ...[...this.workers].map(([id, worker]) => this.retire(id, worker)),
      ]);
      await Promise.allSettled([...this.removals.values(), this.ready]);
      for (const retired of result) if (retired.status === 'rejected') throw retired.reason;
      this.batches.clear();
      this.migration = undefined;
      this.ready = undefined;
      this.lifetime = new AbortController();
    })().finally(() => { this.closing = undefined; });
  }

  unloadModel() { return this.close(); }
}
