import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { KnowledgePort } from '../backend/knowledge/types';
import type {
  KnowledgeCall,
  KnowledgeState,
  KnowledgeStatus,
  KnowledgeValue,
  RagMode,
} from '../contracts/knowledge';

const id = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[\w-]{1,100}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
export function validateKnowledge(value: unknown): KnowledgeCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('无效知识库请求。');
  const v = value as KnowledgeCall;
  const fields: Record<KnowledgeCall['op'], string[]> = {
    status: ['op'],
    import: ['op', 'requestId', 'documentId', 'baseId', 'name', 'bytes', 'force'],
    invalidate: ['op', 'requestId', 'documentId'],
    remove: ['op', 'requestId', 'documentId'],
    cancel: ['op', 'requestId'],
    search: ['op', 'requestId', 'query', 'topK', 'mode', 'baseId'],
    item: ['op', 'requestId', 'itemId'],
    settings: ['op', 'mode'],
  };
  if (!Object.hasOwn(fields, v.op) || Object.keys(v).some((key) => !fields[v.op].includes(key)))
    throw Error('未知知识库操作或字段。');
  const optional =
    v.op === 'search' ? ['topK', 'mode', 'baseId'] : v.op === 'import' ? ['force'] : [];
  if (fields[v.op].some((key) => !optional.includes(key) && !Object.hasOwn(v, key)))
    throw Error('知识库请求缺少必要字段。');
  if ('requestId' in v && !id(v.requestId)) throw Error('无效请求 ID。');
  if ('documentId' in v && !id(v.documentId)) throw Error('无效文档 ID。');
  if ('baseId' in v && v.baseId !== undefined && !id(v.baseId)) throw Error('无效知识库 ID。');
  if (v.op === 'import' && v.force !== undefined && typeof v.force !== 'boolean')
    throw Error('无效重建参数。');
  if (
    v.op === 'import' &&
    (typeof v.name !== 'string' ||
      !v.name.trim() ||
      v.name.length > 240 ||
      /[\\/\x00-\x1f]/.test(v.name) ||
      !(v.bytes instanceof Uint8Array) ||
      !v.bytes.length ||
      v.bytes.length > 20 * 1024 * 1024)
  )
    throw Error('无效文件或文件超过 20 MB。');
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
  if (v.op === 'settings' && !['local', 'function'].includes(v.mode))
    throw Error('无效 RAG 模式。');
  return v;
}
export class KnowledgeCoordinator {
  private active = new Map<string, { controller: AbortController; documentId?: string }>();
  private tasks = new Map<string, KnowledgeStatus>();
  private mode: RagMode = 'local';
  private settingsError: unknown;
  private saving = false;
  private snapshot?: Promise<KnowledgeState>;
  private changeVersion = 0;
  private pending = 0;
  private settingReady: Promise<void>;
  constructor(
    readonly core: KnowledgePort,
    private directory: string,
    private modelPath: string,
    private emit: (status: KnowledgeStatus) => void,
    private functionStatus: () => KnowledgeState['functionCalling'] = () => ({
      supported: null,
      reason: 'OAuth 文档允许命名空间工具，当前账户与模型尚未实测。',
    }),
  ) {
    this.settingReady = this.loadSettings().catch((error) => {
      this.settingsError = error;
    });
  }
  private async loadSettings() {
    try {
      const value = JSON.parse(await readFile(path.join(this.directory, 'settings.json'), 'utf8'));
      if (!['local', 'function'].includes(value.mode)) throw Error();
      this.mode = value.mode;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw Error('知识库设置损坏，原设置已保留，请恢复 settings 备份。');
    }
  }
  async getMode() {
    await this.settingReady;
    if (this.settingsError) throw this.settingsError;
    return this.mode;
  }
  progress(status: KnowledgeStatus) {
    this.changeVersion++;
    const requestId = [...this.active.entries()].find(
      ([, request]) => request.documentId === status.documentId,
    )?.[0];
    status = { ...status, ...(requestId ? { requestId } : {}) };
    this.tasks.set(status.documentId, status);
    // Keep bounded metadata only; never retain excerpts in a log or task record.
    if (this.tasks.size > 1000) this.tasks.delete(this.tasks.keys().next().value!);
    this.emit(status);
  }
  get busy() {
    return this.pending > 0;
  }
  call(call: KnowledgeCall): Promise<KnowledgeValue> {
    this.pending++;
    return this.run(call).finally(() => this.pending--);
  }
  private async run(call: KnowledgeCall): Promise<KnowledgeValue> {
    await this.settingReady;
    if (this.settingsError) throw this.settingsError;
    if (call.op === 'cancel') {
      this.active.get(call.requestId)?.controller.abort();
      return null;
    }
    if (call.op === 'settings') {
      if (call.mode === this.mode) return null;
      if (this.saving) throw Error('设置正在保存，请稍后重试。');
      this.saving = true;
      try {
        await mkdir(this.directory, { recursive: true });
        const file = path.join(this.directory, 'settings.json'),
          temp = file + '.tmp-' + randomUUID();
        try {
          await copyFile(
            file,
            path.join(this.directory, 'settings-backup-' + randomUUID() + '.json'),
          );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        await writeFile(temp, JSON.stringify({ mode: call.mode }), { flag: 'wx' });
        await rename(temp, file);
        this.mode = call.mode;
        return null;
      } finally {
        this.saving = false;
      }
    }
    if (call.op === 'status') {
      return (this.snapshot ??= (async () => {
        let documents;
        do {
          const version = this.changeVersion;
          documents = await this.core.listDocuments();
          if (version === this.changeVersion) break;
        } while (true);
        const state: KnowledgeState = {
          documents,
          tasks: [...this.tasks.values()],
          modelReady: existsSync(path.join(this.modelPath, 'onnx/model_quantized.onnx')),
          mode: this.mode,
          functionCalling: this.functionStatus(),
        };
        return state;
      })().finally(() => {
        this.snapshot = undefined;
      }));
    }
    if (this.active.size >= 24 || this.active.has(call.requestId))
      throw Error('知识库请求过多或请求 ID 重复。');
    if (
      call.op === 'import' &&
      [...this.active.values()].some((a) => a.documentId === call.documentId)
    )
      throw Error('该文档正在处理，请先取消或等待完成。');
    const controller = new AbortController(),
      documentId = call.op === 'import' ? call.documentId : undefined;
    this.active.set(call.requestId, { controller, documentId });
    const signal = controller.signal;
    try {
      switch (call.op) {
        case 'import':
          this.progress({ documentId: call.documentId, phase: 'queued', completed: 0, total: 0 });
          return await this.core.indexDocument(call, signal);
        case 'invalidate':
        case 'remove':
          for (const a of this.active.values())
            if (a.documentId === call.documentId) a.controller.abort();
          if (call.op === 'invalidate')
            return await this.core.invalidateDocument(call.documentId, signal);
          await this.core.removeDocument(call.documentId, signal);
          this.tasks.delete(call.documentId);
          return null;
        case 'search':
          return await this.core.search(
            call.query,
            call.topK ?? 10,
            call.mode ?? 'hybrid',
            signal,
            call.baseId,
          );
        case 'item':
          return await this.core.getItem(call.itemId, signal);
      }
    } catch (error) {
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
      this.active.delete(call.requestId);
    }
  }
  cancelAll() {
    for (const active of this.active.values()) active.controller.abort();
  }
}
export function safeKnowledgeError(error: unknown) {
  return error instanceof Error &&
    /[\u4e00-\u9fff]/.test(error.message) &&
    error.message.length < 500 &&
    !/[A-Z]:[\\/]|Bearer|token=/i.test(error.message)
    ? error.message
    : '本地知识库操作失败，原件与备份已保留。';
}
