import * as lance from '@lancedb/lancedb';
import { KnowledgeError } from './errors';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, copyFile, rename, open, lstat, rm } from 'node:fs/promises';
import type {
  KnowledgeDocument,
  OldIndexDeletion,
  KnowledgeItem,
  KnowledgeHit,
  KnowledgeMode,
  KnowledgeItemExpectation,
} from '../../contracts/knowledge';
import { isKnowledgeFileName, knowledgeBatchLimit, validKnowledgeDocumentName, validKnowledgeId as validId } from '../../contracts/knowledge';
import { MAX_RETRIEVAL_HISTORY, MAX_RETRIEVAL_HISTORY_CHARS } from '../../contracts/retrievalContext';
import {
  MODEL_REVISION,
  INDEX_VERSION,
  type DocumentInput,
  type Embedder,
  type KnowledgePort,
  type ParsedDocument,
  type Progress,
  type KnowledgeSearchTrace,
  type KnowledgeSearchOptions,
} from './types';
import { GroundingIndex, cleanGroundingQuery, isGroundingFollowUp, selectHistory, unitVector, type GroundQuery, type GroundRow } from './grounding';
import { knowledgeItemId, parseText, searchUnits, sha } from './chunks';
import { eraseLibrary, recoverLibraryErasure, indexText, tableExists, type Catalog } from './eraseLibrary';
import { finishIndexUpgrade, legacyDocumentIds, legacyTable, supportedIndexVersion } from './indexUpgrade';
import { clearBatchMarker, recoverIndexBatch, reserveBatch, reservedRevision, reservedTable, type BatchReservation } from './indexBatch';
interface Revision {
  baseId?: string;
  items: KnowledgeItem[];
  text: string;
}
const revisionCacheBytes = 16 * 1024 * 1024;
type CatalogEntry = Catalog['documents'][string];
interface IndexStage {
  id: string;
  baseId: string;
  members: Set<string>;
  entries: Map<string, CatalogEntry>;
  revisions: Set<string>;
  reservation?: BatchReservation;
  revoked?: boolean;
  table?: lance.Table;
  tableName?: string;
}
const indexStage = (id: string, baseId: string, members: string[]): IndexStage => ({
  id, baseId, members: new Set(members), entries: new Map(), revisions: new Set(),
});
function validRevision(value: Revision, doc: KnowledgeDocument) {
  if (!value || typeof value.text !== 'string' || !Array.isArray(value.items) ||
      value.items.length !== doc.itemCount || (value.baseId !== undefined && value.baseId !== doc.baseId)) return false;
  const items = new Map<string, KnowledgeItem>(), claimed = new Set<string>();
  for (const item of value.items) {
    if (!item || item.documentId !== doc.documentId || typeof item.itemId !== 'string' || !item.itemId ||
        items.has(item.itemId) || (item.kind !== 'text' && item.kind !== 'qa') ||
        typeof item.content !== 'string' || typeof item.title !== 'string' || typeof item.section !== 'string' ||
        !Array.isArray(item.followUpIds) || (item.parentId !== undefined && typeof item.parentId !== 'string')) return false;
    if (doc.indexVersion === INDEX_VERSION || doc.indexVersion === 'qa-linked-v2') {
      const line = item.startLine;
      if (!Number.isSafeInteger(line) || line! < 1) return false;
      // PDF QA keeps its text ID; page-split prose uses page/global line coordinates.
      if (item.itemId !== knowledgeItemId(doc.documentId, 0, line! - 1, item.content) &&
          !(doc.format === 'pdf' && item.page && (
            item.itemId === knowledgeItemId(doc.documentId, item.page, line!, item.content) ||
            item.itemId === knowledgeItemId(doc.documentId, item.page, line! - 1, item.content)))) return false;
    }
    items.set(item.itemId, item);
  }
  for (const item of items.values()) {
    if (item.parentId !== undefined && (!items.has(item.parentId) || item.followUpIds.length)) return false;
    for (const child of item.followUpIds) {
      if (items.get(child)?.parentId !== item.itemId || claimed.has(child)) return false;
      claimed.add(child);
    }
  }
  return value.items.every(item => item.parentId === undefined || claimed.has(item.itemId));
}
type SearchItem = Pick<KnowledgeItem, 'itemId' | 'parentId' | 'followUpIds' | 'title' | 'section' | 'page'> &
  { contentHash?: string };
function searchItems(body: Revision, hashContent: boolean) {
  const items = new Map<string, SearchItem>();
  for (const { itemId, parentId, followUpIds, title, section, page, content } of body.items)
    items.set(itemId, { itemId, parentId, followUpIds, title, section, page,
      ...(hashContent ? { contentHash: sha(content) } : {}) });
  return items;
}
const sqlString = (value: string) => "'" + value.replaceAll("'", "''") + "'";
async function* groundingRows(table: lance.Table, documentIds: string[], baseId: string | undefined, signal: AbortSignal): AsyncGenerator<GroundRow> {
  if (!documentIds.length) return;
  const filters = [`documentId IN (${documentIds.map(sqlString).join(',')})`];
  if (baseId) filters.push(`baseId = ${sqlString(baseId)}`);
  const query = table.query().where(filters.join(' AND '))
    .select(['documentId', 'chunkId', 'rootItemId', 'itemId', 'text', 'vector']);
  for await (const batch of query) {
    signal.throwIfAborted();
    const documents = batch.getChild('documentId'), chunks = batch.getChild('chunkId');
    const roots = batch.getChild('rootItemId'), items = batch.getChild('itemId');
    const texts = batch.getChild('text'), vectors = batch.getChild('vector');
    if (!documents || !chunks || !roots || !items || !texts || !vectors)
      throw new KnowledgeError('integrity', '知识检索片段格式无效。');
    for (let i = 0; i < batch.numRows; i++) {
      const documentId = documents.get(i), chunkId = chunks.get(i);
      const rootItemId = roots.get(i), itemId = items.get(i), text = texts.get(i);
      if (typeof documentId !== 'string' || typeof chunkId !== 'string' || typeof rootItemId !== 'string' ||
          typeof itemId !== 'string' || typeof text !== 'string')
        throw new KnowledgeError('integrity', '知识检索片段格式无效。');
      yield { documentId, chunkId, rootItemId, itemId, text, vector: vectors.get(i)?.toArray?.() };
    }
  }
}
export class KnowledgeService implements KnowledgePort {
  private connection?: lance.Connection;
  private stage?: IndexStage;
  private table?: lance.Table;
  private catalog: Catalog = { schemaVersion: 1, modelVersion: MODEL_REVISION, documents: {} };
  private initialized?: Promise<void>;
  private cleanupPending = false;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private revisions = new Map<string, { value: Revision; identity: string; bytes: number; epoch: number; source: string }>();
  private failedRevisions = new Set<string>();
  private cachedBytes = 0;
  private epoch = 0;
  private grounding?: { key: string; index: GroundingIndex };
  private historyVectors = new Map<string, Float32Array>();
  constructor(
    private directory: string,
    private embedder: Embedder,
    private progress: Progress = () => {},
    private parse: (input: DocumentInput, signal: AbortSignal) => Promise<ParsedDocument> = async (input) =>
      parseText(
        new TextDecoder('utf-8', { fatal: true }).decode(input.bytes),
        input.documentId,
        input.name,
      ),
    private diagnostics?: (trace: KnowledgeSearchTrace) => void,
    private readonly snapshotReader = false,
    private readonly databasePath = path.join(directory, 'lance'),
  ) {}
  initialize(erasureProgress?: () => void) {
    return (this.initialized ??= this.load(erasureProgress).catch((e) => {
      this.initialized = undefined;
      this.table?.close();
      this.table = undefined;
      this.connection?.close();
      this.connection = undefined;
      throw e;
    }));
  }
  private async load(erasureProgress?: () => void) {
    await mkdir(path.join(this.directory, 'revisions'), { recursive: true });
    this.connection = await lance.connect(this.databasePath);
    await recoverLibraryErasure(this.directory, this.connection, this.snapshotReader, erasureProgress);
    if (!this.snapshotReader) await recoverIndexBatch(this.directory, this.connection);
    let value: Catalog;
    try {
      value = JSON.parse(await readFile(path.join(this.directory, 'catalog.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new KnowledgeError('configuration', '知识库目录损坏，请恢复备份后重试。');
      value = this.catalog;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new KnowledgeError('configuration', '知识库版本不兼容，原数据已保留。');
    if (
      value.blocked &&
      (!Array.isArray(value.blocked) || value.blocked.some((id) => !validId(id)))
    )
      throw new KnowledgeError('configuration', '知识库停用状态损坏，数据已保留。');
    if (
      value.schemaVersion !== 1 ||
      value.modelVersion !== MODEL_REVISION ||
      !supportedIndexVersion(value.indexFormat) ||
      !value.documents ||
      typeof value.documents !== 'object' ||
      Array.isArray(value.documents) ||
      Object.entries(value.documents).some(
        ([id, e]) =>
          !validId(id) ||
          !e?.document ||
          e.document.documentId !== id ||
          !supportedIndexVersion(e.document.indexVersion) ||
          !/^rev-[\w-]+\.json$/.test(e.revision),
      )
    )
      throw new KnowledgeError('configuration', '知识库版本不兼容，原数据已保留。');
    const legacySource = !this.snapshotReader && await legacyTable(this.directory, value, erasureProgress);
    if (value.tableName) {
      if (!/^chunks_[a-f0-9]+$/.test(value.tableName) || !Number.isSafeInteger(value.tableVersion))
        throw new KnowledgeError('configuration', '知识库索引版本无效。');
      try {
        if (legacySource !== value.tableName || Object.values(value.documents).some(e => e.document.indexVersion === INDEX_VERSION) ||
            await tableExists(this.directory, value.tableName)) {
          this.table = await this.connection.openTable(value.tableName);
          await this.table.checkout(value.tableVersion!);
        }
      } catch {
        throw new KnowledgeError('unavailable', '索引恢复失败，原数据与备份已保留。');
      }
    } else if (Object.keys(value.documents).length)
      throw new KnowledgeError('configuration', '知识库元数据缺少索引。');
    this.cleanupPending = !!legacySource || Object.values(value.documents).some(e => e.document.indexVersion !== INDEX_VERSION);
    // Revalidate lazily on the first read of each body in this pinned snapshot.
    this.epoch++;
    this.failedRevisions.clear();
    this.adoptCatalog(value);
  }
  // Only the separate, serial read process refreshes its view between requests.
  async refreshSnapshot() {
    this.table?.close();
    this.connection?.close();
    this.table = undefined;
    this.connection = undefined;
    this.initialized = undefined;
    this.grounding = undefined;
    await this.initialize();
  }
  private enqueue<T>(signal: AbortSignal, run: () => Promise<T>, erasureProgress?: () => void): Promise<T> {
    const next = this.tail
      .catch(() => {})
      .then(async () => {
        signal.throwIfAborted();
        if (this.closed) throw new KnowledgeError('closed', '知识库服务已关闭。');
        await this.initialize(erasureProgress);
        signal.throwIfAborted();
        return run();
      });
    this.tail = next;
    return next;
  }
  private forgetRevision(name: string) {
    const cached = this.revisions.get(name);
    if (cached) {
      this.cachedBytes -= cached.bytes;
      this.revisions.delete(name);
    }
  }
  private async readRevision(entry: CatalogEntry, verify = false) {
    const name = entry.revision, source = JSON.stringify([entry.document.documentId, entry.document.baseId,
      entry.document.itemCount, entry.document.indexVersion, entry.document.format]);
    const stored = this.revisions.get(name), cached = stored?.source === source ? stored : undefined;
    try {
      if (cached && cached.epoch === this.epoch && !verify) {
        this.revisions.delete(name);
        this.revisions.set(name, cached);
        return cached.value;
      }
      const file = path.join(this.directory, 'revisions', name);
      const info = await lstat(file, { bigint: true });
      if (!info.isFile()) throw Error('Invalid revision file');
      const identity = [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
      if (cached?.identity === identity) {
        cached.epoch = this.epoch;
        return cached.value;
      }
      const revision: Revision = JSON.parse(await readFile(file, 'utf8'));
      if (!validRevision(revision, entry.document))
        throw new KnowledgeError('integrity', '知识库内容格式异常。');
      this.forgetRevision(name);
      const bytes = Number(info.size);
      if (bytes <= revisionCacheBytes) {
        while (this.cachedBytes + bytes > revisionCacheBytes)
          this.forgetRevision(this.revisions.keys().next().value!);
        this.revisions.set(name, { value: revision, identity, bytes, epoch: this.epoch, source });
        this.cachedBytes += bytes;
      }
      this.failedRevisions.delete(name);
      return revision;
    } catch (error) {
      this.forgetRevision(name);
      this.failedRevisions.add(name);
      this.grounding = undefined;
      if (error instanceof KnowledgeError) throw error;
      throw new KnowledgeError('unavailable', '文档内容缺失或损坏，请重新导入。');
    }
  }
  private async availableRevision(entry: CatalogEntry) {
    if (this.failedRevisions.has(entry.revision)) return;
    try { return await this.readRevision(entry); }
    catch (error) { if (!this.failedRevisions.has(entry.revision)) throw error; }
  }
  // Keep candidate metadata only for one query. Oversized bodies never enter the resident cache.
  private queryItems(hashContent: boolean) {
    const documents = new Map<string, Map<string, SearchItem>>();
    return async (entry: CatalogEntry, known?: Revision) => {
      const cached = documents.get(entry.revision);
      if (cached) return cached;
      const body = known ?? await this.availableRevision(entry);
      if (!body) return;
      const items = searchItems(body, hashContent);
      documents.set(entry.revision, items);
      return items;
    };
  }
  private excludedDocuments() {
    const excluded = [...(this.catalog.blocked ?? [])];
    if (this.failedRevisions.size || this.cleanupPending) for (const entry of Object.values(this.catalog.documents))
      if (entry.document.indexVersion !== INDEX_VERSION || this.failedRevisions.has(entry.revision)) excluded.push(entry.document.documentId);
    return excluded;
  }
  private async writable(table = this.table) {
    if (!table) return;
    await table.checkoutLatest();
    if ((await table.version()) !== this.catalog.tableVersion) {
      await table.checkout(this.catalog.tableVersion!);
      await table.restore();
    }
  }
  private async discardStage(stage = this.stage) {
    if (!stage) return;
    stage.revoked = true;
    stage.table?.close();
    stage.table = undefined;
    // Even a failed native create may have allocated the reserved directory.
    const name = stage.reservation?.createsTable ? reservedTable(stage.reservation) : stage.tableName;
    if (name && name !== this.catalog.tableName && await tableExists(this.directory, name))
      await this.connection!.dropTable(name);
    for (const name of stage.revisions)
      await rm(path.join(this.directory, 'revisions', name), { force: true });
    if (stage.reservation) await clearBatchMarker(this.directory);
    if (this.stage === stage) this.stage = undefined;
  }
  beginIndexBatch(id: string, baseId: string, documentIds: string[], signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      this.requireCleanIndex();
      if (!validId(id) || !validId(baseId) || baseId === 'personal-resume' || !Array.isArray(documentIds) || documentIds.length < 2 ||
          documentIds.length > knowledgeBatchLimit || !Array.from(documentIds).every(validId) ||
          new Set(documentIds).size !== documentIds.length)
        throw new KnowledgeError('invalid_request', '无效的知识库导入批次。');
      await this.discardStage();
      const stage = indexStage(id, baseId, documentIds);
      stage.reservation = await reserveBatch(this.directory, baseId, documentIds, !this.catalog.tableName);
      this.stage = stage;
    });
  }
  private async publishStage(stage: IndexStage, signal: AbortSignal) {
    if (stage.entries.size !== stage.members.size)
      throw new KnowledgeError('invalid_request', '知识库导入批次尚未完整。');
    if (stage.table) {
      signal.throwIfAborted();
      await indexText(stage.table);
      const version = await stage.table.version();
      await stage.table.checkout(version);
      await this.commit({
        ...this.catalog, tableName: stage.tableName, tableVersion: version,
        blocked: (this.catalog.blocked ?? []).filter(id => !stage.entries.has(id)),
        documents: { ...this.catalog.documents, ...Object.fromEntries(stage.entries) },
      }, signal, stage.reservation?.nonce);
      stage.revisions.clear();
      const previous = this.table;
      this.table = stage.table;
      stage.table = undefined;
      previous?.close();
    } else if ([...stage.entries].some(([id, entry]) => this.catalog.documents[id] !== entry)) {
      await this.commit({ ...this.catalog, documents: { ...this.catalog.documents, ...Object.fromEntries(stage.entries) } }, signal, stage.reservation?.nonce);
    }
    for (const { document } of stage.entries.values()) this.progress({
      documentId: document.documentId, indexVersion: document.indexVersion, phase: 'ready', completed: document.chunkCount, total: document.chunkCount,
    });
  }
  finishIndexBatch(id: string, commit: boolean, signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      const stage = this.stage;
      if (!stage || stage.id !== id) {
        if (commit) throw new KnowledgeError('cancelled', '知识库导入批次已取消。');
        return;
      }
      try {
        if (commit) {
          if (stage.revoked) throw new KnowledgeError('cancelled', '知识库导入批次已取消。');
          await this.publishStage(stage, signal);
        }
      } finally { await this.discardStage(stage); }
    });
  }
  private async commit(value: Catalog, signal: AbortSignal, nonce: string = randomUUID()) {
    if (value.indexFormat !== INDEX_VERSION) value = { ...value, indexFormat: INDEX_VERSION };
    const file = path.join(this.directory, 'catalog.json'),
      temporary = path.join(this.directory, `catalog-${nonce}.tmp`),
      backup = path.join(this.directory, `catalog-backup-${nonce}.json`),
      pendingBackup = path.join(this.directory, `.catalog-backup-${nonce}.tmp`);
    const handle = await open(temporary, 'wx');
    let published = false;
    try {
      try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
      } finally { await handle.close(); }
      try {
        await copyFile(file, pendingBackup);
        await rename(pendingBackup, backup);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      signal.throwIfAborted();
      await rename(temporary, file);
      published = true;
      this.adoptCatalog(value);
    } finally {
      if (!published) {
        await rm(temporary, { force: true });
        await rm(pendingBackup, { force: true });
      }
    }
  }
  private adoptCatalog(value: Catalog) {
    this.catalog = value;
    // Keep recovery files on disk, but do not retain superseded document bodies in RAM.
    const current = new Set(Object.values(value.documents).map((entry) => entry.revision));
    for (const name of this.revisions.keys())
      if (!current.has(name)) this.forgetRevision(name);
    for (const name of this.failedRevisions)
      if (!current.has(name)) this.failedRevisions.delete(name);
    this.grounding = undefined;
  }
  indexDocument(input: DocumentInput, signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      this.requireCleanIndex();
      if (!input.batchId) await this.discardStage();
      const stage = input.batchId ? this.stage : indexStage('', input.baseId, [input.documentId]);
      if (!stage || stage.revoked || (input.batchId && stage.id !== input.batchId) || stage.baseId !== input.baseId ||
          !stage.members.has(input.documentId) || stage.entries.has(input.documentId))
        throw new KnowledgeError('cancelled', '知识库导入批次已取消或文档不属于本批次。');
      try {
        const document = await this.stageDocument(input, stage, signal);
        if (!input.batchId) {
          await this.publishStage(stage, signal);
        }
        return document;
      } catch (error) {
        await this.discardStage(stage);
        throw error;
      }
    });
  }
  private async stageDocument(input: DocumentInput, stage: IndexStage, signal: AbortSignal) {
    if (
      !validId(input.documentId) ||
      !validId(input.baseId) ||
      !validKnowledgeDocumentName(input.name) ||
      !(input.bytes instanceof Uint8Array) ||
      !input.bytes.length ||
      input.bytes.length > 20 * 1024 * 1024
    )
      throw new KnowledgeError('invalid_request', '无效的知识文档参数。');
    if (!isKnowledgeFileName(input.name))
      throw new KnowledgeError('invalid_request', '仅支持 PDF、Word、TXT 和 Markdown。');
    const old = this.catalog.documents[input.documentId];
    const contentHash = sha(input.bytes);
    const publish = (
      phase: 'parsing' | 'embedding' | 'indexing',
      completed = 0,
      total = 0,
    ) => {
      if (!signal.aborted)
        this.progress({ documentId: input.documentId, phase, completed, total });
    };
    if (
      !input.force &&
      old &&
      old.document.indexVersion === INDEX_VERSION &&
      !this.catalog.blocked?.includes(input.documentId) &&
      old.document.contentHash === contentHash &&
      old.document.name === input.name &&
      old.document.baseId === input.baseId &&
      await this.readRevision(old, true).then(() => true, () => false)
    ) {
      stage.entries.set(input.documentId, old);
      return old.document;
    }
    publish('parsing');
    const parsed = await this.parse(input, signal);
    signal.throwIfAborted();
    if (parsed.text.length > 8_000_000)
      throw new KnowledgeError('invalid_request', '解析后的文字超过 8 MB，请拆分文档。');
    const items = parsed.items.map(({ answer, ...item }) => item);
    await this.embedder.initialize();
    signal.throwIfAborted();
    const units = searchUnits(parsed.items, this.embedder, signal);
    const rows: {
      chunkId: string;
      itemId: string;
      rootItemId: string;
      documentId: string;
      baseId: string;
      text: string;
      vector: number[];
    }[] = [];
    const embeddings = new Map<string, number[]>();
    publish('embedding', 0, units.length);
    for (let offset = 0; offset < units.length; offset += 4) {
      signal.throwIfAborted();
      const batch = units.slice(offset, offset + 4),
        missing = batch.filter((u) => !embeddings.has(u.hash));
      if (missing.length) {
        const vectors = await this.embedder.encode(
          missing.map((u) => u.text),
          'passage',
          signal,
        );
        missing.forEach((u, i) => embeddings.set(u.hash, vectors[i]));
      }
      for (const u of batch)
        rows.push({
          chunkId: u.chunkId,
          itemId: u.itemId,
          rootItemId: u.rootItemId,
          documentId: input.documentId,
          baseId: input.baseId,
          text: u.text,
          vector: embeddings.get(u.hash)!,
        });
      publish('embedding', Math.min(offset + 4, units.length), units.length);
    }
    signal.throwIfAborted();
    publish('indexing', 0, rows.length);
    const revision = stage.reservation ? reservedRevision(stage.reservation, input.documentId) : `rev-${randomUUID()}.json`;
    const handle = await open(path.join(this.directory, 'revisions', revision), 'wx');
    stage.revisions.add(revision);
    try {
      await handle.writeFile(JSON.stringify({
        baseId: input.baseId,
        items,
        text: parsed.text,
      }));
    } finally { await handle.close(); }
    const document: KnowledgeDocument = {
      documentId: input.documentId,
      baseId: input.baseId,
      name: input.name,
      title: parsed.title,
      format: input.name.split('.').pop()!.toLowerCase(),
      contentHash,
      createdAt: old?.document.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      indexVersion: INDEX_VERSION,
      itemCount: parsed.items.length,
      chunkCount: units.length,
      schemaVersion: 1,
      modelVersion: MODEL_REVISION,
      originalReference: `indexeddb:copilot-local-documents/documents/${input.documentId}`,
    };
    if (!stage.table && this.catalog.tableName) {
      stage.tableName = this.catalog.tableName;
      stage.table = await this.connection!.openTable(stage.tableName);
      await this.writable(stage.table);
    }
    if (!stage.table) {
      const name = stage.reservation ? reservedTable(stage.reservation) : `chunks_${randomUUID().replaceAll('-', '')}`;
      stage.tableName = name;
      stage.table = await this.connection!.createTable(name, rows);
    } else {
      await stage.table.mergeInsert('chunkId')
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .whenNotMatchedBySourceDelete({ where: `documentId = '${input.documentId}'` })
        .execute(rows);
    }
    signal.throwIfAborted();
    stage.entries.set(input.documentId, { document, revision });
    return document;
  }
  updateDocument(input: DocumentInput, signal: AbortSignal) {
    return this.indexDocument(input, signal);
  }
  invalidateDocument(id: string, signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      this.requireCleanIndex();
      if (!validId(id)) throw new KnowledgeError('invalid_request', '无效文档 ID。');
      await this.discardStage();
      if (this.catalog.documents[id] && !this.catalog.blocked?.includes(id))
        await this.commit(
          { ...this.catalog, blocked: [...(this.catalog.blocked ?? []), id] },
          signal,
        );
      return null;
    });
  }
  removeDocument(id: string, signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      this.requireCleanIndex();
      if (!validId(id)) throw new KnowledgeError('invalid_request', '无效文档 ID。');
      await this.discardStage();
      if (!this.catalog.documents[id]) return null;
      const documents = { ...this.catalog.documents };
      delete documents[id];
      try {
        await this.writable();
        await this.table!.delete(`documentId = '${id}'`);
        await indexText(this.table!);
        await this.commit(
          {
            ...this.catalog,
            documents,
            blocked: (this.catalog.blocked ?? []).filter((blocked) => blocked !== id),
            tableVersion: await this.table!.version(),
          },
          signal,
        );
        await this.table!.checkout(this.catalog.tableVersion!);
        return null;
      } catch (error) {
        await this.table?.checkout(this.catalog.tableVersion!);
        throw error;
      }
    });
  }
  removeBase(baseId: string, signal: AbortSignal, progressed?: () => void, deleting?: (event: OldIndexDeletion) => void): Promise<null> {
    return this.enqueue(signal, async () => {
      if (!validId(baseId) || baseId === 'personal-resume' || this.snapshotReader)
        throw new KnowledgeError('invalid_request', '无效知识库 ID。');
      await this.discardStage();
      this.table?.close();
      this.table = undefined;
      try {
        if (this.needsIndexCleanup) {
          await this.finishUpgrade(signal, progressed, deleting);
        }
        await eraseLibrary(this.directory, this.connection!, baseId, signal, progressed);
      } catch (error) {
        // An interrupted rewrite must retire its private table before opening
        // another snapshot. The receipt also covers interruption by process exit.
        if (signal.aborted && error === signal.reason)
          await recoverLibraryErasure(this.directory, this.connection!, false, progressed);
        throw error;
      } finally {
        this.connection?.close();
        this.connection = undefined;
        this.revisions.clear();
        this.cachedBytes = 0;
        this.failedRevisions.clear();
        this.grounding = undefined;
        this.initialized = undefined;
      }
      return null;
    }, progressed);
  }
  listDocuments() {
    return this.enqueue(new AbortController().signal, async () =>
      Object.values(this.catalog.documents).map((e) => ({
        ...e.document,
        available: e.document.indexVersion === INDEX_VERSION && !this.catalog.blocked?.includes(e.document.documentId) && !this.failedRevisions.has(e.revision),
      })),
    );
  }
  get needsIndexCleanup() { return !this.snapshotReader && !this.stage && this.cleanupPending; }
  private requireCleanIndex() {
    if (this.cleanupPending) throw new KnowledgeError('unavailable', '旧索引清理尚未完成，请重试。');
  }
  private async verifyUpgrade(signal: AbortSignal, progressed?: () => void) {
    for (const entry of Object.values(this.catalog.documents)) {
      if (entry.document.indexVersion !== INDEX_VERSION) continue;
      signal.throwIfAborted();
      await this.readRevision(entry, true);
      progressed?.();
    }
  }
  private async finishUpgrade(signal: AbortSignal, progressed?: () => void, deleting?: (event: OldIndexDeletion) => void) {
    try {
      if (deleting) deleting({ type: 'old-index-deletion', active: true,
        documentIds: await legacyDocumentIds(this.directory, this.catalog, signal, progressed) });
      signal.throwIfAborted();
      await this.verifyUpgrade(signal, progressed);
      await finishIndexUpgrade(this.directory, this.connection!, this.catalog, signal, progressed);
    } finally {
      deleting?.({ type: 'old-index-deletion', active: false });
    }
  }
  cleanUpgradedIndex(signal: AbortSignal, progressed?: () => void, deleting?: (event: OldIndexDeletion) => void) {
    return this.enqueue(signal, async () => {
      if (!this.needsIndexCleanup) return null;
      this.table?.close();
      this.table = undefined;
      try {
        await this.finishUpgrade(signal, progressed, deleting);
        this.cleanupPending = false;
      } finally {
        this.connection?.close();
        this.connection = undefined;
        this.initialized = undefined;
      }
      return null;
    }, progressed);
  }
  search(
    query: string,
    topK: number = 10,
    mode: KnowledgeMode = 'hybrid',
    signal: AbortSignal,
    baseId?: string,
    options?: KnowledgeSearchOptions,
  ) {
    const queued = performance.now();
    return this.enqueue(signal, async () => {
      const started = performance.now();
      if (
        !query.trim() ||
        query.length > 6000 ||
        !Number.isSafeInteger(topK) ||
        topK < 1 ||
        topK > 20 ||
        !['keyword', 'vector', 'hybrid'].includes(mode) ||
        (baseId !== undefined && !validId(baseId)) ||
        (options !== undefined && ![20, 40, 60, 80].includes(options.rawLimit)) ||
        (options?.history !== undefined &&
          (!Array.isArray(options.history) ||
            options.history.length > MAX_RETRIEVAL_HISTORY ||
            options.history.some((v) => typeof v !== 'string' || !v.trim() || v.length > MAX_RETRIEVAL_HISTORY_CHARS)))
      )
        throw new KnowledgeError('invalid_request', '无效的知识检索参数。');
      if (!this.table || !Object.values(this.catalog.documents).some(e => e.document.indexVersion === INDEX_VERSION)) {
        this.diagnostics?.({
          raw: [],
          distinctRoots: 0,
          hits: [],
          queueMs: started - queued,
          searchMs: performance.now() - started,
        });
        return [];
      }
      if (options?.grounded && mode === 'hybrid')
        return this.groundedSearch(query, topK, signal, baseId, options, queued, started);
      let builder, queryVector: number[] | undefined;
      if (mode === 'keyword')
        builder = this.table.query().fullTextSearch(query, { columns: ['text'] });
      else {
        const [vector] = await this.embedder.encode([query], 'query', signal);
        queryVector = vector;
        builder = this.table.vectorSearch(vector).distanceType('cosine').bypassVectorIndex();
        if (mode === 'hybrid') builder = builder.fullTextSearch(query, { columns: ['text'] });
      }
      const results: KnowledgeHit[] = [], seen = new Set<string>();
      const itemsFor = this.queryItems(true);
      let rows;
      // If unreadable bodies filled the ranked page, ask again with those documents excluded.
      do {
        const failedBefore = this.failedRevisions.size;
        const filters: string[] = [];
        const excluded = this.excludedDocuments();
        if (excluded.length) filters.push(`documentId NOT IN (${excluded.map(sqlString).join(',')})`);
        if (baseId) {
          filters.push(`baseId = '${baseId}'`);
        }
        if (filters.length) builder = builder.where(filters.join(' AND '));
        rows = await builder
          .select([
            'chunkId',
            'itemId',
            'rootItemId',
            'documentId',
            'text',
            ...(mode === 'keyword' ? ['_score'] : mode === 'vector' ? ['_distance'] : ['vector']),
          ])
          .limit(options?.rawLimit ?? Math.min(topK * 4, 80))
          .toArray();
        signal.throwIfAborted();
        for (const row of rows) {
          const entry = this.catalog.documents[row.documentId];
          if (!entry || seen.has(row.rootItemId)) continue;
          const items = await itemsFor(entry);
          if (!items) continue;
          const item = items.get(row.rootItemId);
          if (!item) throw new KnowledgeError('integrity', '索引与完整内容不一致。');
          const matched = items.get(row.itemId);
          if (!matched || (matched.itemId !== item.itemId && matched.parentId !== item.itemId))
            throw new KnowledgeError('integrity', '索引追问与根条目身份不一致。');
          const key = item.contentHash!;
          if (seen.has(key)) continue;
          seen.add(row.rootItemId);
          seen.add(key);
          const score =
            mode === 'vector'
              ? 1 - row._distance
              : mode === 'hybrid'
                ? row._relevance_score
                : row._score;
          if (!Number.isFinite(score))
            throw new KnowledgeError('integrity', '知识检索返回无效分数。');
          const values = row.vector?.toArray?.() ?? row.vector;
          const similarity =
            mode === 'vector'
              ? 1 - row._distance
              : queryVector && values?.length === 384
                ? Array.from(values as ArrayLike<number>).reduce(
                    (sum, n, i) => sum + n * queryVector![i],
                    0,
                  ) /
                  Math.sqrt(
                    Array.from(values as ArrayLike<number>).reduce((sum, n) => sum + n * n, 0) *
                      queryVector.reduce((sum, n) => sum + n * n, 0),
                  )
                : undefined;
          results.push({
            chunkId: row.chunkId,
            itemId: item.itemId,
            matchedItemId: matched.itemId,
            revision: sha(entry.revision),
            documentId: row.documentId,
            name: entry.document.name,
            baseId: entry.document.baseId,
            title: item.title,
            excerpt: String(row.text).slice(0, 1600),
            ...(Number.isFinite(similarity) ? { similarity } : {}),
            score,
            mode,
            section: item.section,
            ...(item.page ? { page: item.page } : {}),
          });
          if (results.length === topK) break;
        }
        if (results.length === topK || failedBefore === this.failedRevisions.size) break;
      } while (!signal.aborted);
      signal.throwIfAborted();
      this.diagnostics?.({
        raw: rows.map((row) => ({
          chunkId: row.chunkId,
          itemId: row.itemId,
          rootItemId: row.rootItemId,
          documentId: row.documentId,
        })),
        distinctRoots: new Set(rows.map((row) => row.documentId + ':' + row.rootItemId)).size,
        hits: results.map((hit) => hit.itemId),
        queueMs: started - queued,
        searchMs: performance.now() - started,
      });
      return results;
    });
  }
  version(baseId: string, signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      if (!validId(baseId)) throw new KnowledgeError('invalid_request', '无效知识库 ID。');
      return sha(
        JSON.stringify(
          Object.values(this.catalog.documents)
            .filter((entry) => entry.document.baseId === baseId && entry.document.indexVersion === INDEX_VERSION)
            .map((entry) => [
              entry.document.documentId,
              entry.revision,
              this.catalog.blocked?.includes(entry.document.documentId) ?? false,
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ),
      );
    });
  }
  getItem(id: string, signal = new AbortController().signal, expected?: KnowledgeItemExpectation) {
    return this.enqueue(signal, async () => {
      if (typeof id !== 'string' || id.length > 240) return null;
      const source = expected?.documentId ?? id.split(':', 1)[0];
      const direct = Object.hasOwn(this.catalog.documents, source) ? this.catalog.documents[source] : undefined;
      for (const entry of direct ? [direct] : Object.values(this.catalog.documents)) {
        if (
          expected &&
          (entry.document.baseId !== expected.baseId ||
            entry.document.documentId !== expected.documentId ||
            sha(entry.revision) !== expected.revision)
        )
          continue;
        if (entry.document.indexVersion !== INDEX_VERSION || this.catalog.blocked?.includes(entry.document.documentId)) continue;
        const revision = direct ? await this.readRevision(entry) : await this.availableRevision(entry);
        const item = revision?.items.find((i) => i.itemId === id);
        if (revision && item) {
          const children = revision.items.filter((i) => item.followUpIds.includes(i.itemId));
          return {
            ...item,
            source: {
              name: entry.document.name,
              format: entry.document.format,
              updatedAt: entry.document.updatedAt,
              contentHash: entry.document.contentHash,
              modelVersion: entry.document.modelVersion,
              indexVersion: entry.document.indexVersion,
              baseId: entry.document.baseId,
              revision: sha(entry.revision),
            },
            rootContent: item.content,
            content: [item.content, ...children.map((c) => c.content)].join('\n\n'),
            followUps: children,
          };
        }
      }
      return null;
    });
  }
  async unloadModel() {
    await this.tail.catch(() => {});
    await this.discardStage();
    this.grounding = undefined;
    this.historyVectors.clear();
    await this.embedder.close();
  }
  async close() {
    this.closed = true;
    await this.tail.catch(() => {});
    await this.discardStage();
    this.historyVectors.clear();
    await this.embedder.close();
    this.table?.close();
    this.connection?.close();
    this.revisions.clear();
    this.cachedBytes = 0;
    this.failedRevisions.clear();
    this.grounding = undefined;
  }

  private async groundedSearch(
    query: string, topK: number, signal: AbortSignal, baseId: string | undefined,
    options: KnowledgeSearchOptions, queued: number, started: number,
  ): Promise<KnowledgeHit[]> {
    let entries = Object.values(this.catalog.documents).filter(e =>
      e.document.indexVersion === INDEX_VERSION && (!baseId || e.document.baseId === baseId) && !this.catalog.blocked?.includes(e.document.documentId) &&
      !this.failedRevisions.has(e.revision));
    const itemsFor = this.queryItems(false);
    const cacheKey = () => sha(JSON.stringify([this.catalog.tableName, this.catalog.tableVersion, baseId, entries.map(e => e.revision)]));
    let scope = entries.map(entry => entry.document.documentId);
    const read = () => groundingRows(this.table!, scope, baseId, signal);
    if (this.grounding?.key !== cacheKey()) {
      this.grounding = undefined;
      const healthy: CatalogEntry[] = [];
      for (const entry of entries) {
        signal.throwIfAborted();
        const body = await this.availableRevision(entry);
        if (!body) continue;
        healthy.push(entry);
        if (!this.revisions.has(entry.revision)) await itemsFor(entry, body);
      }
      entries = healthy;
      scope = healthy.map(entry => entry.document.documentId);
      const index = await GroundingIndex.load(read, signal);
      this.grounding = { key: cacheKey(), index };
    }
    if (!scope.length) {
      this.diagnostics?.({ raw: [], distinctRoots: 0, hits: [], queueMs: started - queued,
        searchMs: performance.now() - started });
      return [];
    }
    const followUp = isGroundingFollowUp(query);
    const history = followUp ? [...(options.history ?? [])].reverse() : [];
    const [current, ...prior] = await this.groundingQueries(query, history, signal);
    const anchor = selectHistory(query, current, prior);
    const ranked = await this.grounding.index.rank(read, current, anchor, signal);
    const accepted = followUp || (ranked[0]?.cosine ?? -Infinity) >= 0.8811;
    const results: KnowledgeHit[] = [];
    for (const candidate of accepted ? ranked.slice(0, topK) : []) {
      const { row } = candidate;
      const entry = this.catalog.documents[row.documentId];
      const items = await itemsFor(entry);
      // A body evicted since building the profile may now be unavailable. Exclude it and rerank.
      if (!items) return this.groundedSearch(query, topK, signal, baseId, options, queued, started);
      const root = items.get(row.rootItemId), matched = items.get(row.itemId);
      if (!root || root.parentId || !matched || (matched.itemId !== root.itemId && matched.parentId !== root.itemId))
        throw new KnowledgeError('integrity', '索引追问与根条目身份不一致。');
      const children = row.itemId === root.itemId ? root.followUpIds :
        [row.itemId, ...root.followUpIds.filter(id => id !== row.itemId)];
      results.push({
        chunkId: row.chunkId, itemId: root.itemId, matchedItemId: row.itemId, matchedItemIds: children.slice(0, 5),
        revision: sha(entry.revision), documentId: row.documentId, name: entry.document.name, baseId: entry.document.baseId,
        title: root.title, excerpt: row.text, similarity: candidate.cosine, score: candidate.score,
        grounding: { contrast: candidate.score, contextual: !!anchor }, mode: 'hybrid', section: root.section,
        ...(root.page ? { page: root.page } : {}),
      });
    }
    signal.throwIfAborted();
    this.diagnostics?.({
      raw: ranked.map(({ row: { chunkId, itemId, rootItemId, documentId } }) => ({ chunkId, itemId, rootItemId, documentId })),
      distinctRoots: ranked.length, hits: results.map(hit => hit.itemId),
      queueMs: started - queued, searchMs: performance.now() - started,
      grounding: { scope, contextual: !!anchor, direct: !followUp, peakContrast: ranked[0]?.cosine ?? 0 },
    });
    return results;
  }

  private async groundingQueries(current: string, history: string[], signal: AbortSignal): Promise<GroundQuery[]> {
    await this.embedder.initialize();
    const texts = [current, ...history].map(cleanGroundingQuery);
    // Keep both the subject and final question when recognition exceeds the encoder token budget.
    const bounded = texts.map(text => {
      let compact = text, size = Math.ceil(text.length / 2);
      while (this.embedder.count(compact, 'query') > 512 && size > 1) {
        size = Math.max(1, Math.floor(size * 0.8));
        compact = text.slice(0, size) + '\n' + text.slice(-size);
      }
      return compact;
    });
    const keys = bounded.map(sha);
    const pending = new Map<string, string>();
    bounded.forEach((text, i) => {
      if (i === 0 || !this.historyVectors.has(keys[i])) pending.set(keys[i], text);
    });
    const vectors = await this.embedder.encode([...pending.values()], 'query', signal);
    signal.throwIfAborted();
    const fresh = new Map([...pending.keys()].map((key, i) => [key, unitVector(vectors[i])]));
    const queries = texts.map((text, i) => ({ text, vector: fresh.get(keys[i]) ?? this.historyVectors.get(keys[i])! }));
    // Only explicitly supplied history can use a previous embedding. Never reuse search results.
    for (let i = keys.length - 1; i >= 0; i--) {
      this.historyVectors.delete(keys[i]);
      this.historyVectors.set(keys[i], queries[i].vector);
    }
    while (this.historyVectors.size > 8) this.historyVectors.delete(this.historyVectors.keys().next().value!);
    return queries;
  }
}
export { validId };
