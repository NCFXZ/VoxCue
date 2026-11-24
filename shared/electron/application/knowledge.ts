import path from 'node:path';
import { existsSync } from 'node:fs';
import type { KnowledgePort } from '../backend/knowledge/types';
import type {
  KnowledgeCall,
  KnowledgeEvent,
  KnowledgeState,
  KnowledgeStatus,
  KnowledgeValue,
} from '../contracts/knowledge';
import { isKnowledgeFileName, knowledgeBatchChanged, knowledgeBatchLimit, knowledgeIndexCancelled, validKnowledgeDocumentName, validKnowledgeId as id } from '../contracts/knowledge';
export function validateKnowledge(value: unknown): KnowledgeCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('无效知识库请求。');
  const v = value as KnowledgeCall;
  const fields: Record<KnowledgeCall['op'], string[]> = {
    status: ['op'],
    import: ['op', 'requestId', 'documentId', 'baseId', 'name', 'bytes', 'force', 'batchId'],
    'begin-index-batch': ['op', 'requestId', 'baseId', 'documentIds'],
    'finish-index-batch': ['op', 'requestId', 'batchId', 'commit'],
    invalidate: ['op', 'requestId', 'documentId'],
    remove: ['op', 'requestId', 'documentId'],
    'remove-base': ['op', 'requestId', 'baseId'],
    cancel: ['op', 'requestId'],
    search: ['op', 'requestId', 'query', 'topK', 'mode', 'baseId'],
    item: ['op', 'requestId', 'itemId', 'expected'],
  };
  if (!Object.hasOwn(fields, v.op) || Object.keys(v).some((key) => !fields[v.op].includes(key)))
    throw Error('未知知识库操作或字段。');
  const optional =
    v.op === 'search'
      ? ['topK', 'mode', 'baseId']
      : v.op === 'import'
        ? ['force', 'batchId']
        : v.op === 'item'
          ? ['expected']
          : [];
  if (fields[v.op].some((key) => !optional.includes(key) && !Object.hasOwn(v, key)))
    throw Error('知识库请求缺少必要字段。');
  if ('requestId' in v && !id(v.requestId)) throw Error('无效请求 ID。');
  if ('documentId' in v && !id(v.documentId)) throw Error('无效文档 ID。');
  if ('batchId' in v && (!id(v.batchId) || v.batchId === v.requestId)) throw Error('无效索引批次。');
  if (v.op === 'begin-index-batch' && (v.baseId === 'personal-resume' ||
    !Array.isArray(v.documentIds) || v.documentIds.length < 2 || v.documentIds.length > knowledgeBatchLimit ||
    !Array.from(v.documentIds).every(id) || new Set(v.documentIds).size !== v.documentIds.length))
    throw Error('无效索引批次。');
  if (v.op === 'finish-index-batch' && typeof v.commit !== 'boolean') throw Error('无效索引批次。');
  if ('baseId' in v && (v.op !== 'search' || v.baseId !== undefined) && !id(v.baseId)) throw Error('无效知识库 ID。');
  if (v.op === 'remove-base' && v.baseId === 'personal-resume') throw Error('无效知识库 ID。');
  if (v.op === 'import' && v.force !== undefined && typeof v.force !== 'boolean')
    throw Error('无效重建参数。');
  if (
    v.op === 'import' &&
    (!validKnowledgeDocumentName(v.name) ||
      !(v.bytes instanceof Uint8Array) ||
      !v.bytes.length ||
      v.bytes.length > 20 * 1024 * 1024)
  )
    throw Error('无效文件或文件超过 20 MB。');
  if (v.op === 'import' && !isKnowledgeFileName(v.name))
    throw Error('仅支持 PDF、Word、TXT 和 Markdown。');
  if (
    v.op === 'search' &&
    (typeof v.query !== 'string' ||
      !v.query.trim() ||
      v.query.length > 6000 ||
      (v.topK !== undefined && (!Number.isSafeInteger(v.topK) || v.topK < 1 || v.topK > 20)) ||
      (v.mode !== undefined && !['keyword', 'vector', 'hybrid'].includes(v.mode)))
  )
    throw Error('无效检索参数。');
  if (
    v.op === 'item' &&
    (typeof v.itemId !== 'string' || v.itemId.length > 240 || !/^[\w:-]+$/.test(v.itemId))
  )
    throw Error('无效知识单元 ID。');
  if (
    v.op === 'item' &&
    v.expected !== undefined &&
    (!v.expected ||
      typeof v.expected !== 'object' ||
      Array.isArray(v.expected) ||
      Object.keys(v.expected).length !== 3 ||
      !id(v.expected.baseId) ||
      !id(v.expected.documentId) ||
      typeof v.expected.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(v.expected.revision))
  )
    throw Error('无效资料版本。');
  return v;
}
interface IndexBatch {
  id: string;
  baseId: string;
  members: Set<string>;
  requests: Map<string, string>;
  staged: Set<string>;
  controller: AbortController;
  rollback?: Promise<void>;
  committing?: boolean;
}
export class KnowledgeCoordinator {
  private batch?: IndexBatch;
  private withdrawnRequests = new Set<string>();
  private active = new Map<string, { controller: AbortController; documentId?: string; baseId?: string; withdrawn?: boolean }>();
  private removingBases = new Set<string>();
  private removingDocuments = new Set<string>();
  private tasks = new Map<string, { status: KnowledgeStatus; baseId?: string }>();
  private deletingOldIndex?: Extract<KnowledgeEvent, { active: true }>;
  private snapshot?: Promise<KnowledgeState>;
  private changeVersion = 0;
  private pending = 0;
  private importBytes = 0;
  constructor(
    readonly core: KnowledgePort,
    private modelPath: string,
    private emit: (status: KnowledgeEvent) => void,
    private isInterviewActive: () => boolean = () => false,
  ) {}
  progress(status: KnowledgeEvent) {
    if ('type' in status) {
      if (!status.active && !this.deletingOldIndex) return;
      this.deletingOldIndex = status.active ? status : undefined;
      this.emit(status);
      return;
    }
    this.changeVersion++;
    const request = [...this.active.entries()].find(
      ([, request]) => request.documentId === status.documentId,
    );
    if (request?.[1].withdrawn) return;
    const batchRequest = this.batch?.requests.get(status.documentId);
    if (batchRequest && !request && this.batch?.controller.signal.aborted && status.phase === 'ready') return;
    const requestId = request?.[0] ?? batchRequest;
    const task = { ...status, ...(requestId ? { requestId } : {}) };
    this.tasks.set(status.documentId, { status: task, baseId: request?.[1].baseId ?? this.tasks.get(status.documentId)?.baseId });
    // Keep bounded metadata only; never retain excerpts in a log or task record.
    if (this.tasks.size > 1000) this.tasks.delete(this.tasks.keys().next().value!);
    this.emit(task);
  }
  get busy() {
    return this.pending > 0 || !!this.batch;
  }
  get indexing() {
    return !!this.batch || [...this.active.values()].some((request) => request.documentId !== undefined);
  }
  async assertInterviewReady(baseId?: string | null) {
    if (baseId && this.indexing &&
      !(await this.core.listDocuments(false)).some((doc) => doc.baseId === baseId && doc.available !== false))
      throw Error('资料仍在索引，请稍后开始面试。');
  }
  call(call: KnowledgeCall): Promise<KnowledgeValue> {
    this.pending++;
    return this.run(call).finally(() => this.pending--);
  }
  private withdraw(id: string) {
    this.withdrawnRequests.add(id);
    if (this.withdrawnRequests.size > 1000) this.withdrawnRequests.delete(this.withdrawnRequests.keys().next().value!);
  }
  cancelBatch(withdraw = true) {
    const batch = this.batch;
    if (!batch) return Promise.resolve();
    if (withdraw) this.withdraw(batch.id);
    batch.controller.abort();
    return batch.rollback ??= this.core.finishIndexBatch!(batch.id, false, new AbortController().signal)
      .finally(() => {
        if (this.batch !== batch) return;
        for (const [documentId, requestId] of batch.requests) {
          const task = this.tasks.get(documentId)?.status;
          if (task?.requestId === requestId && task.phase !== 'ready' && task.phase !== 'failed' && task.phase !== 'cancelled')
            this.progress({ documentId, phase: 'cancelled', completed: 0, total: 0 });
        }
        this.batch = undefined;
      });
  }
  private async run(call: KnowledgeCall): Promise<KnowledgeValue> {
    if ((call.op === 'import' || call.op === 'begin-index-batch') && this.isInterviewActive())
      throw Error('面试中无法索引，请结束后重试。');
    if (call.op === 'cancel') {
      this.active.get(call.requestId)?.controller.abort();
      if (this.batch && (this.batch.id === call.requestId || [...this.batch.requests.values()].includes(call.requestId))) {
        this.withdraw(call.requestId);
        await this.cancelBatch(this.batch.id === call.requestId);
      }
      return null;
    }
    if (call.op === 'status') {
      // A window can subscribe while an existing status request is waiting for cleanup.
      if (this.deletingOldIndex) this.emit(this.deletingOldIndex);
      return (this.snapshot ??= (async () => {
        let documents;
        do {
          const version = this.changeVersion;
          documents = await this.core.listDocuments(!this.isInterviewActive());
          if (version === this.changeVersion) break;
        } while (true);
        const state: KnowledgeState = {
          documents,
          tasks: [...this.tasks.values()].map(task => task.status),
          modelReady: existsSync(path.join(this.modelPath, 'onnx/model_quantized.onnx')),
          ...(this.core.indexCleanupError && { error: this.core.indexCleanupError }),
        };
        return state;
      })().finally(() => {
        this.snapshot = undefined;
      }));
    }
    if (this.active.size >= 24 || this.active.has(call.requestId))
      throw Error('知识库请求过多或请求 ID 重复。');
    if ((call.op === 'import' || call.op === 'begin-index-batch' || call.op === 'remove-base') && this.removingBases.has(call.baseId))
      throw Error('资料处理中，请稍后重试。');
    if ((call.op === 'begin-index-batch' && call.documentIds.some(id => this.removingDocuments.has(id))) ||
        ('documentId' in call && this.removingDocuments.has(call.documentId)))
      throw Error('文档处理中，请稍后重试。');
    const batch = this.batch;
    if ((call.op === 'begin-index-batch' && this.withdrawnRequests.has(call.requestId)) ||
      (call.op === 'import' && (this.withdrawnRequests.has(call.requestId) ||
        (call.batchId && this.withdrawnRequests.has(call.batchId)))) ||
      (call.op === 'finish-index-batch' && call.commit && this.withdrawnRequests.has(call.batchId)))
      throw Error(knowledgeIndexCancelled);
    if (batch?.id === call.requestId || (batch && [...batch.requests.values()].includes(call.requestId)))
      throw Error('知识库请求过多或请求 ID 重复。');
    if (call.op === 'import' && (batch || call.batchId) && (!batch || batch.controller.signal.aborted ||
      batch.committing || batch.id !== call.batchId || batch.baseId !== call.baseId ||
      !batch.members.has(call.documentId) || batch.requests.has(call.documentId) ||
      [...this.active.values()].some(request => request.documentId)))
      throw Error(knowledgeBatchChanged);
    if (
      call.op === 'import' &&
      [...this.active.values()].some((a) => a.documentId === call.documentId)
    )
      throw Error('文档处理中，请稍后重试。');
    if (
      call.op === 'import' &&
      (this.importBytes + call.bytes.byteLength > 40 * 1024 * 1024 ||
        [...this.active.values()].filter((a) => a.documentId !== undefined).length >= 2)
    )
      throw Error('资料处理中，请稍后重试。');
    const controller = new AbortController(),
      documentId = call.op === 'import' ? call.documentId : undefined;
    this.active.set(call.requestId, { controller, documentId, baseId: call.op === 'import' ? call.baseId : undefined });
    if (call.op === 'import') this.importBytes += call.bytes.byteLength;
    const signal = batch && (call.op === 'import' && call.batchId || call.op === 'finish-index-batch' && call.commit)
      ? AbortSignal.any([controller.signal, batch.controller.signal]) : controller.signal;
    try {
      switch (call.op) {
        case 'begin-index-batch': {
          if (batch || this.indexing) throw Error('资料处理中，请稍后重试。');
          if (!this.core.beginIndexBatch || !this.core.finishIndexBatch) throw Error('批量索引不可用。');
          const opened: IndexBatch = { id: call.requestId, baseId: call.baseId, members: new Set(call.documentIds),
            requests: new Map(), staged: new Set(), controller };
          this.batch = opened;
          try {
            await this.core.beginIndexBatch(opened.id, opened.baseId, call.documentIds, signal);
            signal.throwIfAborted();
          } catch (error) {
            if (this.batch === opened) await this.cancelBatch(false).catch(() => {});
            throw error;
          }
          return null;
        }
        case 'finish-index-batch': {
          if (!batch || batch.id !== call.batchId) {
            if (!call.commit) return null;
            throw Error('索引批次已失效。');
          }
          if (!call.commit) { await this.cancelBatch(false); return null; }
          if (batch.committing || batch.staged.size !== batch.members.size || batch.controller.signal.aborted)
            throw Error('索引批次尚未准备完成。');
          batch.committing = true;
          try {
            await this.core.finishIndexBatch!(batch.id, true, signal);
            this.changeVersion++;
            if (this.batch === batch && !batch.rollback) this.batch = undefined;
          } catch (error) {
            await this.cancelBatch(false).catch(() => {});
            throw error;
          }
          return null;
        }
        case 'import': {
          if (batch) batch.requests.set(call.documentId, call.requestId);
          this.progress({ documentId: call.documentId, phase: 'queued', completed: 0, total: 0 });
          const document = await this.core.indexDocument(call, signal);
          signal.throwIfAborted();
          batch?.staged.add(call.documentId);
          return document;
        }
        case 'invalidate':
        case 'remove':
          if (call.op === 'remove') this.removingDocuments.add(call.documentId);
          if (batch && (call.op === 'invalidate' || batch.members.has(call.documentId)))
            await this.cancelBatch(false);
          for (const a of this.active.values())
            if (a.documentId === call.documentId) a.controller.abort();
          if (call.op === 'invalidate')
            return await this.core.invalidateDocument(call.documentId, signal);
          await this.core.removeDocument(call.documentId, signal);
          this.tasks.delete(call.documentId);
          this.changeVersion++;
          return null;
        case 'remove-base': {
          this.removingBases.add(call.baseId);
          const rollback = batch?.baseId === call.baseId ? this.cancelBatch(false).catch(() => {}) : undefined;
          for (const entry of this.active.values()) {
            if (entry.baseId !== call.baseId || !entry.documentId) continue;
            this.progress({ documentId: entry.documentId, phase: 'cancelled', completed: 0, total: 0 });
            entry.withdrawn = true;
            entry.controller.abort();
          }
          try { await this.core.removeBase(call.baseId, signal); }
          finally { await rollback; }
          for (const [id, task] of this.tasks)
            if (task.baseId === call.baseId) this.tasks.delete(id);
          this.changeVersion++;
          return null;
        }
        case 'search':
          return await this.core.search(
            call.query,
            call.topK ?? 10,
            call.mode ?? 'hybrid',
            signal,
            call.baseId,
          );
        case 'item':
          return await this.core.getItem(call.itemId, signal, call.expected);
        default:
          throw Error('未知知识库操作。');
      }
    } catch (error) {
      if (call.op === 'import' && batch?.controller.signal.aborted)
        throw Error(this.withdrawnRequests.has(batch.id) ? knowledgeIndexCancelled : knowledgeBatchChanged);
      if (documentId)
        this.progress({
          documentId,
          phase: signal.aborted ? 'cancelled' : 'failed',
          completed: 0,
          total: 0,
          error: signal.aborted ? '已取消，可重新索引。' : safeKnowledgeError(error),
        });
      throw error;
    } finally {
      if (call.op === 'import') this.importBytes -= call.bytes.byteLength;
      if (call.op === 'remove-base') this.removingBases.delete(call.baseId);
      if (call.op === 'remove') this.removingDocuments.delete(call.documentId);
      this.active.delete(call.requestId);
    }
  }
  cancelAll() {
    for (const active of this.active.values()) active.controller.abort();
    void this.cancelBatch().catch(() => {});
  }
}
export function safeKnowledgeError(error: unknown) {
  return error instanceof Error &&
    /[\u4e00-\u9fff]/.test(error.message) &&
    error.message.length < 500 &&
    !/[A-Z]:[\\/]|Bearer|token=/i.test(error.message)
    ? error.message
    : '知识库操作失败，请重试。';
}
