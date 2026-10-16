import * as lance from '@lancedb/lancedb';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, rename, open } from 'node:fs/promises';
import type {
  KnowledgeDocument,
  KnowledgeItem,
  KnowledgeHit,
  KnowledgeMode,
} from '../../contracts/knowledge';
import {
  MODEL_REVISION,
  INDEX_VERSION,
  type DocumentInput,
  type Embedder,
  type KnowledgePort,
  type ParsedDocument,
  type Progress,
} from './types';
import { parseText, searchUnits, sha } from './chunks';
interface Entry {
  document: KnowledgeDocument;
  revision: string;
}
interface Catalog {
  schemaVersion: 1;
  modelVersion: string;
  tableName?: string;
  tableVersion?: number;
  documents: Record<string, Entry>;
  blocked?: string[];
}
interface Revision {
  items: KnowledgeItem[];
  text: string;
}
export class KnowledgeService implements KnowledgePort {
  private connection?: lance.Connection;
  private table?: lance.Table;
  private catalog: Catalog = { schemaVersion: 1, modelVersion: MODEL_REVISION, documents: {} };
  private initialized?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private revisions = new Map<string, Revision>();
  constructor(
    private directory: string,
    private embedder: Embedder,
    private progress: Progress = () => {},
    private parse: (input: DocumentInput) => Promise<ParsedDocument> = async (input) =>
      parseText(
        new TextDecoder('utf-8', { fatal: true }).decode(input.bytes),
        input.documentId,
        input.name,
      ),
  ) {}
  initialize() {
    return (this.initialized ??= this.load().catch((e) => {
      this.initialized = undefined;
      this.table?.close();
      this.table = undefined;
      this.connection?.close();
      this.connection = undefined;
      throw e;
    }));
  }
  private async load() {
    await mkdir(path.join(this.directory, 'revisions'), { recursive: true });
    let value: Catalog;
    try {
      value = JSON.parse(await readFile(path.join(this.directory, 'catalog.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw Error('知识库目录损坏。原件与备份已保留，请恢复 catalog 备份后重试。');
      value = this.catalog;
    }
    if (
      value.blocked &&
      (!Array.isArray(value.blocked) || value.blocked.some((id) => !validId(id)))
    )
      throw Error('知识库停用状态损坏，数据已保留。');
    if (
      value.schemaVersion !== 1 ||
      value.modelVersion !== MODEL_REVISION ||
      !value.documents ||
      typeof value.documents !== 'object' ||
      Array.isArray(value.documents) ||
      Object.entries(value.documents).some(
        ([id, e]) =>
          !validId(id) ||
          !e?.document ||
          e.document.documentId !== id ||
          !/^rev-[\w-]+\.json$/.test(e.revision),
      )
    )
      throw Error('知识库 Schema 或模型版本不兼容，原数据已保留，不能自动覆盖。');
    this.connection = await lance.connect(path.join(this.directory, 'lance'));
    if (value.tableName) {
      if (!/^chunks_[a-f0-9]+$/.test(value.tableName) || !Number.isSafeInteger(value.tableVersion))
        throw Error('知识库索引版本无效。');
      try {
        this.table = await this.connection.openTable(value.tableName);
        await this.table.checkout(value.tableVersion!);
      } catch {
        throw Error('知识库索引无法恢复，原目录与 catalog 备份已保留。');
      }
    } else if (Object.keys(value.documents).length) throw Error('知识库元数据缺少索引。');
    for (const e of Object.values(value.documents)) await this.readRevision(e.revision);
    this.catalog = value;
  }
  private enqueue<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    const next = this.tail
      .catch(() => {})
      .then(async () => {
        signal.throwIfAborted();
        if (this.closed) throw Error('知识库服务已关闭。');
        await this.initialize();
        signal.throwIfAborted();
        return run();
      });
    this.tail = next;
    return next;
  }
  private async readRevision(name: string) {
    if (this.revisions.has(name)) return this.revisions.get(name)!;
    let revision: Revision;
    try {
      revision = JSON.parse(await readFile(path.join(this.directory, 'revisions', name), 'utf8'));
    } catch {
      throw Error('知识库完整内容文件缺失或损坏，原件未删除，请重新索引该文档。');
    }
    if (
      !Array.isArray(revision.items) ||
      typeof revision.text !== 'string' ||
      revision.items.some((i) => typeof i.itemId !== 'string' || typeof i.content !== 'string')
    )
      throw Error('知识库内容格式异常。');
    this.revisions.set(name, revision);
    return revision;
  }
  private async writable() {
    if (!this.table) return;
    await this.table.checkoutLatest();
    if ((await this.table.version()) !== this.catalog.tableVersion) {
      await this.table.checkout(this.catalog.tableVersion!);
      await this.table.restore();
    }
  }
  private async commit(value: Catalog, signal: AbortSignal) {
    const file = path.join(this.directory, 'catalog.json'),
      temporary = path.join(this.directory, `catalog-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await copyFile(file, path.join(this.directory, `catalog-backup-${randomUUID()}.json`));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    signal.throwIfAborted();
    await rename(temporary, file);
    this.catalog = value;
  }
  indexDocument(input: DocumentInput, signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      if (
        !validId(input.documentId) ||
        !validId(input.baseId) ||
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        input.name.length > 240 ||
        /[\\/\x00-\x1f]/.test(input.name) ||
        !(input.bytes instanceof Uint8Array) ||
        !input.bytes.length ||
        input.bytes.length > 20 * 1024 * 1024
      )
        throw Error('无效的知识文档参数。');
      const old = this.catalog.documents[input.documentId];
      const contentHash = sha(input.bytes);
      const publish = (
        phase: 'parsing' | 'embedding' | 'indexing' | 'ready',
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
        old.document.baseId === input.baseId
      ) {
        publish('ready', 1, 1);
        return old.document;
      }
      publish('parsing');
      const parsed = await this.parse(input);
      signal.throwIfAborted();
      if (parsed.text.length > 8_000_000) throw Error('解析后的文字超过 8 MB，请拆分文档。');
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
      const revision = `rev-${randomUUID()}.json`;
      await writeFile(
        path.join(this.directory, 'revisions', revision),
        JSON.stringify({
          items: parsed.items.map(({ answer, ...item }) => item),
          text: parsed.text,
        }),
        { flag: 'wx' },
      );
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
      try {
        await this.writable();
        let tableName = this.catalog.tableName;
        if (!this.table) {
          tableName = `chunks_${randomUUID().replaceAll('-', '')}`;
          this.table = await this.connection!.createTable(tableName, rows);
        } else
          await this.table
            .mergeInsert('chunkId')
            .whenMatchedUpdateAll()
            .whenNotMatchedInsertAll()
            .whenNotMatchedBySourceDelete({ where: `documentId = '${input.documentId}'` })
            .execute(rows);
        signal.throwIfAborted();
        await this.table.createIndex('text', {
          config: lance.Index.fts({
            baseTokenizer: 'icu',
            stem: false,
            removeStopWords: false,
            asciiFolding: false,
            lowercase: true,
            withPosition: false,
          }),
          replace: true,
        });
        const next: Catalog = {
          ...this.catalog,
          blocked: (this.catalog.blocked ?? []).filter((id) => id !== input.documentId),
          tableName,
          tableVersion: await this.table.version(),
          documents: { ...this.catalog.documents, [input.documentId]: { document, revision } },
        };
        await this.commit(next, signal);
        await this.table.checkout(next.tableVersion!);
        publish('ready', units.length, units.length);
        return document;
      } catch (error) {
        if (this.catalog.tableVersion) await this.table?.checkout(this.catalog.tableVersion);
        else {
          this.table?.close();
          this.table = undefined;
        }
        throw error;
      }
    });
  }
  updateDocument(input: DocumentInput, signal: AbortSignal) {
    return this.indexDocument(input, signal);
  }
  invalidateDocument(id: string, signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      if (!validId(id)) throw Error('无效文档 ID。');
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
      if (!validId(id)) throw Error('无效文档 ID。');
      if (!this.catalog.documents[id]) return null;
      const documents = { ...this.catalog.documents };
      delete documents[id];
      try {
        await this.writable();
        await this.table!.delete(`documentId = '${id}'`);
        await this.table!.createIndex('text', {
          config: lance.Index.fts({
            baseTokenizer: 'icu',
            stem: false,
            removeStopWords: false,
            asciiFolding: false,
            lowercase: true,
            withPosition: false,
          }),
          replace: true,
        });
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
  listDocuments() {
    return this.enqueue(new AbortController().signal, async () =>
      Object.values(this.catalog.documents).map((e) => ({
        ...e.document,
        available: !this.catalog.blocked?.includes(e.document.documentId),
      })),
    );
  }
  search(
    query: string,
    topK: number = 10,
    mode: KnowledgeMode = 'hybrid',
    signal: AbortSignal,
    baseId?: string,
  ) {
    return this.enqueue(signal, async () => {
      if (
        !query.trim() ||
        query.length > 6000 ||
        !Number.isSafeInteger(topK) ||
        topK < 1 ||
        topK > 20 ||
        !['keyword', 'vector', 'hybrid'].includes(mode)
      )
        throw Error('无效的知识检索参数。');
      if (!this.table || !Object.keys(this.catalog.documents).length) return [];
      let builder, queryVector: number[] | undefined;
      if (mode === 'keyword')
        builder = this.table.query().fullTextSearch(query, { columns: ['text'] });
      else {
        const [vector] = await this.embedder.encode([query], 'query', signal);
        queryVector = vector;
        builder = this.table.vectorSearch(vector).distanceType('cosine').bypassVectorIndex();
        if (mode === 'hybrid') builder = builder.fullTextSearch(query, { columns: ['text'] });
      }
      const filters: string[] = [];
      if (this.catalog.blocked?.length)
        filters.push(
          `documentId NOT IN (${this.catalog.blocked.map((id) => `'${id}'`).join(',')})`,
        );
      if (baseId) {
        if (!validId(baseId)) throw Error('无效知识库 ID。');
        filters.push(`baseId = '${baseId}'`);
      }
      if (filters.length) builder = builder.where(filters.join(' AND '));
      const rows = await builder
        .select([
          'chunkId',
          'itemId',
          'rootItemId',
          'documentId',
          'text',
          ...(mode === 'keyword' ? ['_score'] : mode === 'vector' ? ['_distance'] : ['vector']),
        ])
        .limit(Math.min(topK * 4, 80))
        .toArray();
      signal.throwIfAborted();
      const seen = new Set<string>(),
        results: KnowledgeHit[] = [];
      for (const row of rows) {
        const entry = this.catalog.documents[row.documentId];
        if (!entry || seen.has(row.rootItemId)) continue;
        const revision = await this.readRevision(entry.revision),
          item = revision.items.find((i) => i.itemId === row.rootItemId);
        if (!item) throw Error('索引与完整内容不一致。');
        const key = sha(item.content);
        if (seen.has(key)) continue;
        seen.add(row.rootItemId);
        seen.add(key);
        const score =
          mode === 'vector'
            ? 1 - row._distance
            : mode === 'hybrid'
              ? row._relevance_score
              : row._score;
        if (!Number.isFinite(score)) throw Error('知识检索返回无效分数。');
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
      return results;
    });
  }
  getItem(id: string, signal = new AbortController().signal) {
    return this.enqueue(signal, async () => {
      if (typeof id !== 'string' || id.length > 240) return null;
      for (const entry of Object.values(this.catalog.documents)) {
        if (this.catalog.blocked?.includes(entry.document.documentId)) continue;
        const revision = await this.readRevision(entry.revision),
          item = revision.items.find((i) => i.itemId === id);
        if (item) {
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
            },
            content: [item.content, ...children.map((c) => c.content)].join('\n\n'),
            followUps: children,
          };
        }
      }
      return null;
    });
  }
  async close() {
    this.closed = true;
    await this.tail.catch(() => {});
    await this.embedder.close();
    this.table?.close();
    this.connection?.close();
    this.revisions.clear();
  }
}
export const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[\w-]{1,100}$/.test(id) &&
  !['__proto__', 'constructor', 'prototype'].includes(id);
