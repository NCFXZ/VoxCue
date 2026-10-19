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
import { KnowledgeError, knowledgeErrorFromWire } from './errors';
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
        try {
          this.child?.postMessage({ cancel: id });
        } catch {
          // The port may already be gone. Preserve the original cancellation,
          // timeout or availability error after retiring this pending request.
        }
        reject(error);
      };
      const abort = () => finish(new KnowledgeError('cancelled', '知识库操作已取消。'));
      const timer = setTimeout(
        () => finish(new KnowledgeError('unavailable', '本地知识库服务超时，请稍后重试。')),
        timeout,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal.addEventListener('abort', abort, { once: true });
      try {
        this.child!.postMessage({ id, ...call });
      } catch (error) {
        finish(new KnowledgeError('unavailable', '本地知识库进程不可用。'));
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
      m.error ? p.reject(knowledgeErrorFromWire(m.error, m.errorCode)) : p.resolve(m.value);
    });
    child.on('exit', () => {
      if (this.child === child) this.stop('本地知识库进程已退出，请重试。', 'unavailable');
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
    const child = this.child;
    if (!child) return;
    let onExit = () => {};
    const exited = new Promise<void>((resolve) => {
      onExit = () => resolve();
      child.once('exit', onExit);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.send({ op: 'close' }, undefined, 10000);
    } finally {
      this.stop();
      try {
        await Promise.race([
          exited,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(new KnowledgeError('unavailable', '知识库进程未能及时退出，模型尚未删除。')),
              10000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        child.removeListener('exit', onExit);
      }
    }
  }
  async unloadModel() {
    if (!this.child) return;
    await this.send({ op: 'unload-model' }, undefined, 30000);
    // ONNX can retain mapped model handles until the utility process exits.
    // Retire the idle consumer before component deletion; the next operation
    // reopens the same catalog/index without changing its persisted data.
    await this.close();
  }
  stop(message = '知识库服务已关闭。', code: 'closed' | 'unavailable' = 'closed') {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    child?.kill();
    for (const p of this.pending.values()) {
      p.cleanup();
      p.reject(new KnowledgeError(code, message));
    }
    this.pending.clear();
  }
}
