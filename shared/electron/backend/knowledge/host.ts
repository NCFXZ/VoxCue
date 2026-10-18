import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  KnowledgeDocument,
  KnowledgeItem,
  KnowledgeHit,
  KnowledgeMode,
  KnowledgeStatus,
} from '../../contracts/knowledge';
import type { DocumentInput, KnowledgePort } from './types';
export class KnowledgeHost implements KnowledgePort {
  private child?: UtilityProcess;
  private ready?: Promise<void>;
  private pending = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void; cleanup: () => void }
  >();
  constructor(
    private directory: string,
    private modelPath: string,
    private progress: (status: KnowledgeStatus) => void = () => {},
  ) {}
  private send<T>(
    call: Record<string, unknown>,
    signal = new AbortController().signal,
    timeout = 600000,
  ): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const finish = (error: Error) => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        p.cleanup();
        this.child?.postMessage({ cancel: id });
        reject(error);
      };
      const abort = () => finish(Error('知识库操作已取消。'));
      const timer = setTimeout(() => finish(Error('本地知识库服务超时，请稍后重试。')), timeout);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal.addEventListener('abort', abort, { once: true });
      try {
        this.child!.postMessage({ id, ...call });
      } catch (error) {
        finish(error as Error);
      }
    });
  }
  initialize() {
    if (this.ready) return this.ready;
    const child = utilityProcess.fork(
      path.join(__dirname, 'process.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'),
      [],
      { serviceName: 'VoxCue 本地知识库', stdio: 'pipe' },
    );
    this.child = child;
    // Never forward parser/native stderr: it may contain local paths or document content.
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', () => {});
    child.on('message', (m) => {
      if (this.child !== child) return;
      if (m.event) {
        if (this.pending.has(m.id)) this.progress(m.event);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      p.cleanup();
      m.error ? p.reject(Error(m.error)) : p.resolve(m.value);
    });
    child.on('exit', () => {
      if (this.child === child) this.stop('本地知识库进程已退出，请重试。');
    });
    this.ready = this.send<void>(
      { init: { directory: this.directory, modelPath: this.modelPath } },
      undefined,
      30000,
    ).catch((error) => {
      this.stop();
      throw error;
    });
    return this.ready;
  }
  private async call<T>(op: string, data: Record<string, unknown>, signal?: AbortSignal) {
    await this.initialize();
    signal?.throwIfAborted();
    return this.send<T>({ op, ...data }, signal, op === 'search' ? 30000 : 600000);
  }
  indexDocument(input: DocumentInput, signal: AbortSignal) {
    return this.call<KnowledgeDocument>('index', { input }, signal);
  }
  updateDocument(input: DocumentInput, signal: AbortSignal) {
    return this.indexDocument(input, signal);
  }
  invalidateDocument(documentId: string, signal: AbortSignal) {
    return this.call<null>('invalidate', { documentId }, signal);
  }
  removeDocument(documentId: string, signal: AbortSignal) {
    return this.call<null>('remove', { documentId }, signal);
  }
  listDocuments() {
    return this.call<KnowledgeDocument[]>('list', {});
  }
  search(
    query: string,
    topK = 10,
    mode: KnowledgeMode = 'hybrid',
    signal: AbortSignal,
    baseId?: string,
  ) {
    return this.call<KnowledgeHit[]>('search', { query, topK, mode, baseId }, signal);
  }
  getItem(itemId: string, signal?: AbortSignal) {
    return this.call<KnowledgeItem | null>('item', { itemId }, signal);
  }
  async close() {
    if (!this.child) return;
    try {
      await this.send({ op: 'close' }, undefined, 10000);
    } finally {
      this.stop();
    }
  }
  async unloadModel() {
    if (this.child) await this.send({ op: 'unload-model' }, undefined, 30000);
  }
  stop(message = '知识库服务已关闭。') {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    child?.kill();
    for (const p of this.pending.values()) {
      p.cleanup();
      p.reject(Error(message));
    }
    this.pending.clear();
  }
}
