import * as lance from '@lancedb/lancedb';
import { KnowledgeError } from './errors';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, rename, open } from 'node:fs/promises';
import type {
  KnowledgeDocument,
  KnowledgeItem,
  KnowledgeHit,
  KnowledgeMode,
  KnowledgeItemExpectation,
} from '../../contracts/knowledge';
import { isKnowledgeFileName } from '../../contracts/knowledge';
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
import { readRetrievalContext } from '../../contracts/retrievalContext';
import { GroundingProfile, GROUNDING, interleaveSources, type GroundRow } from './grounding';
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
const sqlString = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export class KnowledgeService implements KnowledgePort {
  private connection?: lance.Connection;
  private table?: lance.Table;
  private catalog: Catalog = { schemaVersion: 1, modelVersion: MODEL_REVISION, documents: {} };
  private initialized?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private revisions = new Map<string, Revision>();
  private grounding?: { key: string; profile: GroundingProfile };
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
      throw new KnowledgeError('configuration', '知识库版本不兼容，原数据已保留。');
    this.connection = await lance.connect(path.join(this.directory, 'lance'));
    if (value.tableName) {
      if (!/^chunks_[a-f0-9]+$/.test(value.tableName) || !Number.isSafeInteger(value.tableVersion))
        throw new KnowledgeError('configuration', '知识库索引版本无效。');
      try {
        this.table = await this.connection.openTable(value.tableName);
        await this.table.checkout(value.tableVersion!);
      } catch {
        throw new KnowledgeError('unavailable', '索引恢复失败，原数据与备份已保留。');
      }
    } else if (Object.keys(value.documents).length)
      throw new KnowledgeError('configuration', '知识库元数据缺少索引。');
    for (const e of Object.values(value.documents)) await this.readRevision(e.revision);
    this.catalog = value;
  }
  private enqueue<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    const next = this.tail
      .catch(() => {})
      .then(async () => {
        signal.throwIfAborted();
        if (this.closed) throw new KnowledgeError('closed', '知识库服务已关闭。');
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
      throw new KnowledgeError('unavailable', '文档内容缺失或损坏，请重新导入。');
    }
    if (
      !revision ||
      typeof revision !== 'object' ||
      !Array.isArray(revision.items) ||
      typeof revision.text !== 'string' ||
      revision.items.some(
        (i) => !i || typeof i.itemId !== 'string' || typeof i.content !== 'string',
      )
    )
      throw new KnowledgeError('integrity', '知识库内容格式异常。');
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
        throw new KnowledgeError('invalid_request', '无效的知识文档参数。');
      if (!isKnowledgeFileName(input.name))
        throw new KnowledgeError('invalid_request', '仅支持 PDF、Word、TXT 和 Markdown。');
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
      const parsed = await this.parse(input, signal);
      signal.throwIfAborted();
      if (parsed.text.length > 8_000_000)
        throw new KnowledgeError('invalid_request', '解析后的文字超过 8 MB，请拆分文档。');
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
      if (!validId(id)) throw new KnowledgeError('invalid_request', '无效文档 ID。');
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
      if (!validId(id)) throw new KnowledgeError('invalid_request', '无效文档 ID。');
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
            options.history.length > 6 ||
            options.history.some((v) => typeof v !== 'string' || v.length > 200)))
      )
        throw new KnowledgeError('invalid_request', '无效的知识检索参数。');
      if (!this.table || !Object.keys(this.catalog.documents).length) {
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
      const filters: string[] = [];
      if (this.catalog.blocked?.length)
        filters.push(
          `documentId NOT IN (${this.catalog.blocked.map((id) => `'${id}'`).join(',')})`,
        );
      if (baseId) {
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
        .limit(options?.rawLimit ?? Math.min(topK * 4, 80))
        .toArray();
      signal.throwIfAborted();
      const seen = new Set<string>(),
        results: KnowledgeHit[] = [];
      for (const row of rows) {
        const entry = this.catalog.documents[row.documentId];
        if (!entry || seen.has(row.rootItemId)) continue;
        const revision = await this.readRevision(entry.revision),
          item = revision.items.find((i) => i.itemId === row.rootItemId);
        if (!item) throw new KnowledgeError('integrity', '索引与完整内容不一致。');
        const matched = revision.items.find((i) => i.itemId === row.itemId);
        if (!matched || (matched.itemId !== item.itemId && matched.parentId !== item.itemId))
          throw new KnowledgeError('integrity', '索引追问与根条目身份不一致。');
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
  prepareQuery(query: string, fallback: string, signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      if (!query.trim() || query.length > 1000 || !fallback.trim() || fallback.length > 6000)
        throw new KnowledgeError('invalid_request', '无效检索主题。');
      await this.embedder.initialize();
      signal.throwIfAborted();
      if (readRetrievalContext(query) && this.embedder.count(fallback, 'query') <= 512)
        return query;
      if (this.embedder.count(query, 'query') <= 512) return query;
      if (this.embedder.count(fallback, 'query') <= 512) return fallback;
      // Keep both the leading subject and final correction/question. This is a
      // search-only excerpt; the original generation turn is never truncated.
      let size = 160;
      while (size > 0) {
        const compact = fallback.slice(0, size) + '\n' + fallback.slice(-size);
        if (this.embedder.count(compact, 'query') <= 512) return compact;
        size = Math.floor(size / 2);
      }
      return fallback.slice(-1);
    });
  }
  version(baseId: string, signal: AbortSignal) {
    return this.enqueue(signal, async () => {
      if (!validId(baseId)) throw new KnowledgeError('invalid_request', '无效知识库 ID。');
      return sha(
        JSON.stringify(
          Object.values(this.catalog.documents)
            .filter((entry) => entry.document.baseId === baseId)
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
      for (const entry of Object.values(this.catalog.documents)) {
        if (
          expected &&
          (entry.document.baseId !== expected.baseId ||
            entry.document.documentId !== expected.documentId ||
            sha(entry.revision) !== expected.revision)
        )
          continue;
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
    await this.embedder.close();
  }
  async close() {
    this.closed = true;
    await this.tail.catch(() => {});
    await this.embedder.close();
    this.table?.close();
    this.connection?.close();
    this.revisions.clear();
    this.grounding = undefined;
  }

  private async groundedSearch(
    query: string,
    topK: number,
    signal: AbortSignal,
    baseId: string | undefined,
    options: KnowledgeSearchOptions,
    queued: number,
    started: number,
  ): Promise<KnowledgeHit[]> {
    const entries = Object.values(this.catalog.documents).filter(
      (e) =>
        (!baseId || e.document.baseId === baseId) &&
        !this.catalog.blocked?.includes(e.document.documentId),
    );
    const key = sha(JSON.stringify(entries.map((e) => [e.document.documentId, e.revision])));
    if (this.grounding?.key !== key) {
      const ids = new Set(entries.map((e) => e.document.documentId));
      const stored = ids.size
        ? await this.table!.query()
            .where(`documentId IN (${[...ids].map(sqlString).join(',')})`)
            .select(['chunkId', 'itemId', 'rootItemId', 'documentId', 'text', 'vector'])
            .limit(GROUNDING.backgroundRows)
            .toArray()
        : [];
      signal.throwIfAborted();
      const rows: GroundRow[] = stored
        .filter((r) => ids.has(r.documentId))
        .map((r) => ({
          ...r,
          vector: Array.from(r.vector?.toArray?.() ?? r.vector),
        })) as GroundRow[];
      if (rows.some((r) => r.vector.length !== 384 || r.vector.some((n) => !Number.isFinite(n))))
        throw new KnowledgeError('integrity', '知识检索向量格式无效。');
      const documents = [];
      for (const entry of entries) {
        signal.throwIfAborted();
        documents.push({
          id: entry.document.documentId,
          title: entry.document.title,
          items: (await this.readRevision(entry.revision)).items,
        });
      }
      const profile = new GroundingProfile(documents, rows),
        vectors: number[][] = [];
      for (let i = 0; i < profile.stems.length; i += 4) {
        signal.throwIfAborted();
        vectors.push(
          ...(await this.embedder.encode(profile.stems.slice(i, i + 4), 'query', signal)),
        );
      }
      profile.setStemVectors(vectors);
      this.grounding = { key, profile };
    }
    const profile = this.grounding.profile;
    const thread = options.history ? readRetrievalContext(query) : undefined;
    const current = thread?.current ?? query;
    const previous = thread?.previous ?? [];
    // Limit by model tokens as well as characters. The complete generation
    // question/history are never changed by these local read-time views.
    const bounded = (v: string) => {
      let text = v;
      while (this.embedder.count(text, 'query') > 512 && text.length > 1)
        text = text.slice(0, Math.floor(text.length * 0.8));
      return text;
    };
    await this.embedder.initialize();
    const pool = async (
      vector: number[],
      ids?: string[],
      roots?: string[],
      limit: number = options.rawLimit,
    ) => {
      if (roots && !roots.length) return [];
      let builder = this.table!.vectorSearch(vector).distanceType('cosine').bypassVectorIndex();
      const filters = [];
      if (baseId) filters.push(`baseId = ${sqlString(baseId)}`);
      if (this.catalog.blocked?.length)
        filters.push(`documentId NOT IN (${this.catalog.blocked.map(sqlString).join(',')})`);
      if (ids?.length) filters.push(`documentId IN (${ids.map(sqlString).join(',')})`);
      if (roots?.length) filters.push(`rootItemId IN (${roots.map(sqlString).join(',')})`);
      if (filters.length) builder = builder.where(filters.join(' AND '));
      const rows = await builder
        .select(['chunkId', 'itemId', 'rootItemId', 'documentId', 'text', 'vector'])
        .limit(limit)
        .toArray();
      signal.throwIfAborted();
      return rows.map((r) => ({
        ...r,
        vector: Array.from(r.vector?.toArray?.() ?? r.vector),
      })) as GroundRow[];
    };
    const [currentVector] = await this.embedder.encode([bounded(current)], 'query', signal);
    const unknownProject = profile.unknownProject(current);
    const independent = profile
      .rank(currentVector, await pool(currentVector))
      .filter(
        (r) =>
          profile.accepts(current, r.row.documentId, r.contrast, r.cosine) &&
          (!previous.length || profile.identifies(current, r.row.documentId)),
      )
      .sort((a, b) => b.contrast - a.contrast);
    // Current evidence has priority. History is a proposal only when the
    // current request does not independently identify any supported source.
    let scope = unknownProject ? [] : profile.subjects(current),
      contextual = false,
      anchor: string | undefined;
    if (!scope.length && !unknownProject)
      scope = [...new Set(independent.map((r) => r.row.documentId))];
    if (!scope.length && !unknownProject) {
      for (const prior of [...previous].reverse()) {
        scope = profile.subjects(prior);
        if (scope.length) {
          contextual = true;
          anchor = prior;
          break;
        }
      }
    }
    if (!scope.length && !unknownProject) {
      for (const prior of [...previous].reverse().slice(0, GROUNDING.historyProbes)) {
        const [vector] = await this.embedder.encode([bounded(prior)], 'query', signal);
        const supported = profile
          .rank(vector, await pool(vector))
          .filter((r) => profile.accepts(prior, r.row.documentId, r.contrast, r.cosine))
          .sort((a, b) => b.contrast - a.contrast);
        if (supported.length) {
          scope = [supported[0].row.documentId];
          contextual = true;
          anchor = prior;
          break;
        }
      }
    }
    scope = scope.slice(0, 5);
    const direct = !contextual && scope.length > 0;
    const rootScope = profile.restrictRoots(current, previous, scope);
    const scopedPool = async (vector: number[]) => {
      if (!scope.length) return [];
      const groups =
        rootScope && rootScope.length <= 5
          ? rootScope.map((root) => ({ ids: scope, roots: [root] }))
          : scope.map((id) => ({ ids: [id], roots: rootScope }));
      const rows: GroundRow[] = [];
      const quota = Math.max(1, Math.floor(options.rawLimit / Math.max(1, groups.length)));
      for (const group of groups) rows.push(...(await pool(vector, group.ids, group.roots, quota)));
      return rows;
    };
    const currentRank = profile
      .rank(currentVector, await scopedPool(currentVector))
      .sort((a, b) => b.contrast - a.contrast);
    let eligible = unknownProject ? [] : currentRank;
    if (scope.length) {
      eligible = currentRank.filter((r) => scope.includes(r.row.documentId));
      // Even a known thread cannot force unrelated current content into it.
      if (
        !direct &&
        (!eligible.length ||
          (eligible[0].contrast < GROUNDING.followupContrast &&
            !profile.continuation(current, currentVector)))
      )
        eligible = [];
    } else {
      eligible = unknownProject ? [] : independent;
    }
    let ranked = eligible;
    if (contextual && eligible.length) {
      const [vector] = await this.embedder.encode(
        [bounded(anchor! + '\n' + current)],
        'query',
        signal,
      );
      ranked = profile
        .rank(vector, await scopedPool(vector))
        .filter((r) => scope.includes(r.row.documentId))
        .sort((a, b) => b.contrast - a.contrast);
    }
    const raw = interleaveSources(ranked, (r) =>
      rootScope ? r.row.rootItemId : r.row.documentId,
    ).slice(0, options.rawLimit);
    const seen = new Set<string>(),
      results: KnowledgeHit[] = [];
    for (const candidate of raw) {
      const row = candidate.row;
      if (seen.has(row.rootItemId)) continue;
      seen.add(row.rootItemId);
      const entry = this.catalog.documents[row.documentId];
      const revision = await this.readRevision(entry.revision);
      const item = revision.items.find((i) => i.itemId === row.rootItemId);
      if (
        !item ||
        !revision.items.some(
          (i) =>
            i.itemId === row.itemId && (i.itemId === item.itemId || i.parentId === item.itemId),
        )
      )
        throw new KnowledgeError('integrity', '索引追问与根条目身份不一致。');
      const children = [
        ...new Set([
          ...raw
            .filter((r) => r.row.rootItemId === item.itemId && r.row.itemId !== item.itemId)
            .map((r) => r.row.itemId),
          ...item.followUpIds,
        ]),
      ].slice(0, 5);
      results.push({
        chunkId: row.chunkId,
        itemId: item.itemId,
        matchedItemId: row.itemId,
        matchedItemIds: children,
        revision: sha(entry.revision),
        documentId: row.documentId,
        name: entry.document.name,
        baseId: entry.document.baseId,
        title: item.title,
        excerpt: row.text.slice(0, 1600),
        similarity: candidate.cosine,
        score: candidate.contrast,
        grounding: { contrast: candidate.contrast, contextual },
        mode: 'hybrid',
        section: item.section,
        ...(item.page ? { page: item.page } : {}),
      });
      if (results.length === topK) break;
    }
    signal.throwIfAborted();
    this.diagnostics?.({
      raw: raw.map((r) => ({
        chunkId: r.row.chunkId,
        itemId: r.row.itemId,
        rootItemId: r.row.rootItemId,
        documentId: r.row.documentId,
      })),
      distinctRoots: new Set(raw.map((r) => r.row.rootItemId)).size,
      hits: results.map((r) => r.itemId),
      queueMs: started - queued,
      searchMs: performance.now() - started,
      grounding: { scope, contextual, direct, peakContrast: currentRank[0]?.contrast ?? 0 },
    });
    if (direct && scope.length > 1) {
      const covered = new Set<string>();
      const first = results.filter(
        (hit) => !covered.has(hit.documentId) && !!covered.add(hit.documentId),
      );
      const chosen = new Set(first.map((hit) => hit.itemId));
      return [...first, ...results.filter((hit) => !chosen.has(hit.itemId))];
    }
    return results;
  }
}
export const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[\w-]{1,100}$/.test(id) &&
  !['__proto__', 'constructor', 'prototype'].includes(id);
