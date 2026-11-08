import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  KnowledgeDocument,
  KnowledgeItem,
  KnowledgeHit,
  KnowledgeMode,
  KnowledgeStatus,
  KnowledgeItemExpectation,
} from '../../contracts/knowledge';
import type { DocumentInput, KnowledgePort, KnowledgeSearchOptions } from './types';
import { KnowledgeError, knowledgeErrorFromWire } from './errors';
export class KnowledgeHost implements KnowledgePort {
  private child?: UtilityProcess;
  private ready?: Promise<void>;
  private retiring?: Promise<void>;
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
      signal: AbortSignal;
    }
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
      const cancelled = () => new KnowledgeError('cancelled', '知识库操作已取消。');
      const abort = () => {
        if (!this.pending.has(id)) return;
        try {
          this.child?.postMessage({ cancel: id });
        } catch {
          this.stop('本地知识库进程不可用。', 'unavailable');
        }
        // Keep the caller's task/byte reservation until the utility acknowledges
        // retirement. Rejecting now would let repeated cancellation bypass it.
      };
      const timer = setTimeout(() => this.stop('知识库响应超时，请重试。', 'unavailable'), timeout);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      this.pending.set(id, {
        resolve: (value) => (signal.aborted ? reject(cancelled()) : resolve(value)),
        reject: (error) => reject(signal.aborted ? cancelled() : error),
        cleanup,
        signal,
      });
      signal.addEventListener('abort', abort, { once: true });
      try {
        this.child!.postMessage({ id, ...call });
      } catch {
        this.stop('本地知识库进程不可用。', 'unavailable');
      }
    });
  }
  initialize(): Promise<void> {
    if (this.retiring) return this.waitForRetirement().then(() => this.initialize());
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
        if (this.pending.has(m.id) && !this.pending.get(m.id)!.signal.aborted)
          this.progress(m.event);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      p.cleanup();
      m.error ? p.reject(knowledgeErrorFromWire(m.error, m.errorCode)) : p.resolve(m.value);
    });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.ready = undefined;
      for (const p of this.pending.values()) {
        p.cleanup();
        p.reject(new KnowledgeError('unavailable', '本地知识库进程已退出，请重试。'));
      }
      this.pending.clear();
    });
    this.ready = this.send<void>(
      { init: { directory: this.directory, modelPath: this.modelPath } },
      undefined,
      30000,
    ).catch((error) => {
      if (this.child === child) this.stop();
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
    options?: KnowledgeSearchOptions,
  ) {
    return this.call<KnowledgeHit[]>('search', { query, topK, mode, baseId, options }, signal);
  }
  version(baseId: string, signal: AbortSignal) {
    return this.call<string>('version', { baseId }, signal);
  }
  prepareQuery(query: string, fallback: string, signal: AbortSignal) {
    return this.call<string>('prepare-query', { query, fallback }, signal);
  }
  getItem(itemId: string, signal?: AbortSignal, expected?: KnowledgeItemExpectation) {
    return this.call<KnowledgeItem | null>('item', { itemId, expected }, signal);
  }
  private async waitForRetirement(work = this.retiring, timeout = 10000) {
    if (!work) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new KnowledgeError('unavailable', '知识库未能退出，暂时无法删除模型。')),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  close() {
    return this.waitForRetirement(
      (async () => {
        try {
          if (this.child) await this.send({ op: 'close' }, undefined, 10000);
        } finally {
          this.stop();
          await this.retiring;
        }
      })(),
      20000,
    );
  }
  unloadModel() {
    return this.waitForRetirement(
      (async () => {
        try {
          if (this.child) await this.send({ op: 'unload-model' }, undefined, 30000);
        } finally {
          // ONNX can retain mapped model handles until the utility exits.
          await this.close();
        }
      })(),
      50000,
    );
  }
  stop(message = '知识库服务已关闭。', code: 'closed' | 'unavailable' = 'closed') {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.ready = undefined;
    const pending = this.pending;
    this.pending = new Map();
    for (const p of pending.values()) p.cleanup();
    const retired = new Promise<void>((resolve) => {
      child.once('exit', () => {
        for (const p of pending.values()) p.reject(new KnowledgeError(code, message));
        pending.clear();
        resolve();
      });
    });
    this.retiring = retired;
    void retired.then(() => {
      if (this.retiring === retired) this.retiring = undefined;
    });
    try {
      child.kill();
    } catch {
      // Exit remains unconfirmed: keep reservations and block replacement.
      // Explicit close/initialize deadlines report failure without freeing it.
    }
  }
}
