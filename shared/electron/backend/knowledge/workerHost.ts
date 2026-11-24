import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  KnowledgeDocument,
  KnowledgeItem,
  KnowledgeHit,
  KnowledgeMode,
  KnowledgeEvent,
  KnowledgeItemExpectation,
} from '../../contracts/knowledge';
import type { DocumentInput, KnowledgePort, KnowledgeSearchOptions, PrepareKnowledgeDatabase } from './types';
import { KnowledgeError, knowledgeErrorFromWire } from './errors';
import { abortable } from '../cancellable';
import type { EvidenceItem } from './evidence';

const cancellationGraceMs = 10_000;
class KnowledgeWorkerRestart extends KnowledgeError {
  constructor() {
    super('unavailable', '操作取消后未退出，知识库进程已重新启动。');
  }
}

export class KnowledgeProcess {
  needsIndexCleanup = false;
  private child?: UtilityProcess;
  private ready?: Promise<void>;
  private retiring?: Promise<void>;
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
      started: () => void;
      erasureProgress: (step: unknown) => void;
      signal: AbortSignal;
    }
  >();
  constructor(
    private directory: string,
    private modelPath: string,
    private progress: (status: KnowledgeEvent) => void = () => {},
    private prepareDatabase?: PrepareKnowledgeDatabase,
    private readonly layoutMigration = false,
  ) {}
  private send<T>(
    call: Record<string, unknown>,
    signal = new AbortController().signal,
    timeout = 600000,
  ): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const removing = call.op === 'remove' || call.op === 'remove-base';
      const cancelled = () => new KnowledgeError('cancelled', '知识库操作已取消。');
      const abort = () => {
        if (!this.pending.has(id)) return;
        try {
          this.child?.postMessage({ cancel: id });
        } catch {
          this.stop('本地知识库进程不可用。', 'unavailable');
          return;
        }
        if (removing || call.op === 'index' || call.op === 'begin-index-batch' ||
            (call.op === 'finish-index-batch' && call.commit)) {
          // A native write may be unable to observe cancellation yet. Wait for
          // actual exit before another request can reopen and recover the index.
          clearTimeout(timer);
          timer = setTimeout(() => this.retire(new KnowledgeWorkerRestart()), cancellationGraceMs);
        }
        // Keep the caller's task/byte reservation until the utility acknowledges
        // retirement. Rejecting now would let repeated cancellation bypass it.
      };
      let executing = call.op !== 'search', began = false, lastStep = 0;
      const expired = () => this.stop('知识库响应超时，请重试。', 'unavailable');
      // Retain the existing longest-operation watchdog for an unresponsive
      // process even if it never acknowledges starting the queued search.
      let timer = setTimeout(expired, executing ? timeout : 600000);
      const started = () => {
        began = true;
        if (executing) return;
        executing = true;
        clearTimeout(timer);
        timer = setTimeout(expired, timeout);
      };
      const erasureProgress = (step: unknown) => {
        if (!began || signal.aborted || (!call.init && call.op !== 'remove-base' && call.op !== 'clean-upgraded-index') ||
            typeof step !== 'number' || !Number.isSafeInteger(step) || step <= lastStep) return;
        lastStep = step;
        clearTimeout(timer);
        timer = setTimeout(expired, 600000);
      };
      // Start the execution timeout only when this process starts the queued search.
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      this.pending.set(id, {
        resolve: (value) => (signal.aborted && !removing ? reject(cancelled()) : resolve(value)),
        reject: (error) => reject(signal.aborted ? cancelled() : error),
        cleanup,
        started,
        erasureProgress,
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
  initialize(snapshotGeneration?: number): Promise<void> {
    if (this.retiring) return this.waitForRetirement().then(() => this.initialize(snapshotGeneration));
    if (this.ready) return this.ready;
    let database: ReturnType<PrepareKnowledgeDatabase>;
    let child: UtilityProcess;
    try {
      if (!this.layoutMigration) database = this.prepareDatabase?.(path.join(this.directory, 'lance'));
      child = utilityProcess.fork(
        path.join(__dirname, 'process.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'),
        [],
        { serviceName: 'VoxCue 本地知识库', stdio: 'pipe' },
      );
    } catch (error) {
      database?.release();
      return Promise.reject(error);
    }
    if (database) {
      child.once('spawn', () => { if (child.pid) database.spawned(child.pid); });
      child.once('exit', () => database.release());
    }
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
      if (m.started === true) {
        p.started();
        return;
      }
      if ('erasureProgress' in m) {
        p.erasureProgress(m.erasureProgress);
        return;
      }
      this.pending.delete(m.id);
      p.cleanup();
      if (!m.error && typeof m.needsIndexCleanup === 'boolean') this.needsIndexCleanup = m.needsIndexCleanup;
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
      { init: { directory: this.directory, modelPath: this.modelPath, snapshotGeneration,
        ...(this.layoutMigration && { layoutMigration: true }),
        ...(database && { databasePath: database.path }) } },
      undefined,
      30000,
    ).catch((error) => {
      if (this.child === child) this.stop();
      throw error;
    });
    return this.ready;
  }
  async call<T>(op: string, data: Record<string, unknown> & { snapshotGeneration?: number }, signal?: AbortSignal) {
    const run = async () => {
      signal?.throwIfAborted();
      await this.initialize(data.snapshotGeneration);
      signal?.throwIfAborted();
      return this.send<T>({ op, ...data }, signal, op === 'search' ? 30000 : 600000);
    };
    try {
      return await run();
    } catch (error) {
      if (error instanceof KnowledgeWorkerRestart &&
          (op === 'remove' || op === 'remove-base' || (op === 'finish-index-batch' && data.commit === false))) {
        return run();
      }
      throw error;
    }
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
  stopIfIdle() {
    // Explicit close and unload also own pending replies until the utility acknowledges them.
    if (!this.pending.size) this.stop();
  }
  stop(message = '知识库服务已关闭。', code: 'closed' | 'unavailable' = 'closed') {
    this.retire(new KnowledgeError(code, message));
  }
  stopAndWait() {
    this.stop();
    return this.waitForRetirement();
  }
  private retire(error: KnowledgeError) {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.ready = undefined;
    const pending = this.pending;
    this.pending = new Map();
    for (const p of pending.values()) p.cleanup();
    const settle = (error: KnowledgeError) => {
      for (const p of pending.values()) p.reject(error);
      pending.clear();
    };
    // Callers must fail within a deadline even if kill fails. The separate
    // retirement fence still blocks new work and model removal until actual exit.
    const timer = pending.size
      ? setTimeout(
          () => settle(new KnowledgeError('unavailable', '知识库进程尚未退出，请稍后重试。')),
          10000,
        )
      : undefined;
    const retired = new Promise<void>((resolve) => {
      child.once('exit', () => {
        clearTimeout(timer);
        settle(error);
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
      // Exit remains unconfirmed: keep the retirement fence after callers fail.
      // Explicit close/initialize deadlines cannot authorize replacement/removal.
    }
  }
}

export class LibraryKnowledgeHost implements KnowledgePort {
  indexCleanupError?: string;
  private readonly primary: KnowledgeProcess;
  private readonly reader: KnowledgeProcess;
  private writes = 0;
  private destructiveWrites = 0;
  private withdrawal = 0;
  private snapshotReads = 0;
  private generation = 0;
  private exclusiveWrite?: Promise<null>;
  private indexCleanup?: Promise<void>;
  private removalWork?: Promise<null>;
  private removalPause?: AbortController;
  private readonly foreground = new Set<Promise<void>>();
  private readonly batchReleases = new Map<string, () => void>();

  constructor(directory: string, modelPath: string, private readonly progress: (status: KnowledgeEvent) => void = () => {}, prepareDatabase?: PrepareKnowledgeDatabase) {
    this.primary = new KnowledgeProcess(directory, modelPath, progress, prepareDatabase);
    this.reader = new KnowledgeProcess(directory, modelPath, undefined, prepareDatabase);
  }
  initialize() { return this.primary.initialize(); }

  private async mutate<T>(op: 'begin-index-batch' | 'finish-index-batch' | 'index' | 'invalidate' | 'remove' | 'remove-base' | 'clean-upgraded-index', data: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    const replacesTable = op === 'remove-base' || op === 'clean-upgraded-index';
    if (!replacesTable && op !== 'remove' && this.exclusiveWrite) {
      await abortable(this.exclusiveWrite.catch(() => {}), signal);
      return this.mutate<T>(op, data, signal);
    }
    signal.throwIfAborted();
    this.writes++;
    const withdraws = op === 'invalidate' || op === 'remove' || replacesTable;
    if (withdraws) {
      this.destructiveWrites++;
      this.withdrawal++;
    }
    try {
      if (replacesTable) await this.reader.close();
      if (op === 'index' || op === 'begin-index-batch') {
        await this.primary.initialize();
        signal.throwIfAborted();
        if (this.primary.needsIndexCleanup || this.indexCleanup)
          await abortable(this.cleanOldIndex(), signal);
        signal.throwIfAborted();
      }
      return await this.primary.call<T>(op, data, signal);
    } finally {
      if (withdraws || (op === 'index' && !(data.input as DocumentInput).batchId) ||
          (op === 'finish-index-batch' && data.commit)) this.generation++;
      this.writes--;
      if (replacesTable) this.progress({ type: 'old-index-deletion', active: false });
      if (withdraws) this.destructiveWrites--;
      this.releaseReader();
    }
  }
  private async read<T>(op: string, data: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    if (this.exclusiveWrite) {
      const settled = this.exclusiveWrite.catch(() => {});
      await (signal ? abortable(settled, signal) : settled);
      return this.read<T>(op, data, signal);
    }
    if (!this.writes || this.destructiveWrites) return this.primary.call<T>(op, data, signal);
    // A second utility opens only on contention. Lance checkout pins it to
    // the atomically published catalog while the writer builds its next version.
    this.snapshotReads++;
    const withdrawal = this.withdrawal;
    try {
      const value = await this.reader.call<T>(op, { ...data, snapshotGeneration: this.generation }, signal);
      if (withdrawal !== this.withdrawal) return this.read<T>(op, data, signal);
      return value;
    } finally {
      this.snapshotReads--;
      this.releaseReader();
    }
  }
  private releaseReader() {
    if (!this.writes && !this.snapshotReads) this.reader.stopIfIdle();
  }
  async close() { await Promise.all([this.primary.close(), this.reader.close()]); }
  async unloadModel() { await Promise.all([this.primary.unloadModel(), this.reader.unloadModel()]); }
  stop() { this.primary.stop(); this.reader.stop(); }
  async stopAndWait() { await Promise.all([this.primary.stopAndWait(), this.reader.stopAndWait()]); }
  private holdForeground() {
    let resolve!: () => void;
    const promise = new Promise<void>(settle => { resolve = settle; });
    this.foreground.add(promise);
    this.removalPause?.abort();
    return () => {
      this.foreground.delete(promise);
      resolve();
    };
  }
  private async prioritize<T>(signal: AbortSignal | undefined, work: () => Promise<T>) {
    signal?.throwIfAborted();
    const release = this.holdForeground();
    try { return await work(); } finally { release(); }
  }
  async beginIndexBatch(id: string, baseId: string, documentIds: string[], signal: AbortSignal) {
    signal.throwIfAborted();
    // Keep the reservation across all staged imports and the final publish.
    const release = this.holdForeground();
    this.batchReleases.set(id, release);
    try {
      await this.mutate<void>('begin-index-batch', { batchId: id, baseId, documentIds }, signal);
    } catch (error) {
      this.batchReleases.delete(id);
      release();
      throw error;
    }
  }
  async finishIndexBatch(id: string, commit: boolean, signal: AbortSignal) {
    const release = this.batchReleases.get(id);
    try {
      await this.mutate<void>('finish-index-batch', { batchId: id, commit }, signal);
    } finally {
      if (release && this.batchReleases.get(id) === release) {
        this.batchReleases.delete(id);
        release();
      }
    }
  }
  indexDocument(input: DocumentInput, signal: AbortSignal) {
    return this.prioritize(signal, () => this.mutate<KnowledgeDocument>('index', { input }, signal));
  }
  updateDocument(input: DocumentInput, signal: AbortSignal) {
    return this.indexDocument(input, signal);
  }
  invalidateDocument(documentId: string, signal: AbortSignal) {
    return this.prioritize(signal, () => this.mutate<null>('invalidate', { documentId }, signal));
  }
  removeDocument(documentId: string, signal: AbortSignal) {
    return this.remove('remove', { documentId }, signal);
  }
  removeBase(baseId: string, signal: AbortSignal) {
    return this.remove('remove-base', { baseId }, signal);
  }
  private remove(op: 'remove' | 'remove-base', data: Record<string, unknown>, signal: AbortSignal) {
    const previous = this.removalWork;
    const work = (async () => {
      if (previous) await previous.catch(() => {});
      for (;;) {
        signal.throwIfAborted();
        while (this.foreground.size) await abortable(Promise.all(this.foreground), signal);
        const pause = new AbortController();
        this.removalPause = pause;
        try {
          const result = await this.exclusive(op, data, AbortSignal.any([signal, pause.signal]));
          signal.throwIfAborted();
          return result;
        } catch (error) {
          signal.throwIfAborted();
          // Retry after the foreground work settles. The utility acknowledges
          // cancellation only after retiring the current write.
          const cancelled = error === pause.signal.reason ||
            (error instanceof KnowledgeError && error.code === 'cancelled');
          if (!pause.signal.aborted || !cancelled) throw error;
        } finally {
          this.removalPause = undefined;
        }
      }
    })().finally(() => {
      if (this.removalWork === work) this.removalWork = undefined;
    });
    this.removalWork = work;
    return work;
  }
  private exclusive(op: 'remove' | 'remove-base' | 'clean-upgraded-index', data: Record<string, unknown>, signal: AbortSignal) {
    const previous = this.exclusiveWrite ?? Promise.resolve();
    const work: Promise<null> = previous.catch(() => {}).then(() =>
      this.mutate<null>(op, data, signal),
    ).finally(() => {
      if (this.exclusiveWrite === work) this.exclusiveWrite = undefined;
    });
    this.exclusiveWrite = work;
    return work;
  }
  private cleanOldIndex() {
    return this.indexCleanup ??= this.exclusive('clean-upgraded-index', {}, new AbortController().signal)
      .then(() => { this.indexCleanupError = undefined; }, error => {
        this.indexCleanupError = error instanceof Error ? error.message : '旧索引清理尚未完成，请重试。';
        throw error;
      }).finally(() => { this.indexCleanup = undefined; });
  }
  async listDocuments(allowIndexCleanup = true, signal?: AbortSignal) {
    if (!allowIndexCleanup) return this.read<KnowledgeDocument[]>('list', {}, signal);
    // Reconciliation needs the published catalog to queue missing originals.
    return this.prioritize(signal, async () => {
      const documents = await this.read<KnowledgeDocument[]>('list', {}, signal);
      if (!this.primary.needsIndexCleanup && !this.indexCleanup) {
        this.indexCleanupError = undefined;
        return documents;
      }
      // Status returns the resulting catalog and exposes cleanup failures through indexCleanupError.
      signal?.throwIfAborted();
      const cleanup = this.cleanOldIndex().catch(() => {});
      await (signal ? abortable(cleanup, signal) : cleanup);
      return this.read<KnowledgeDocument[]>('list', {}, signal);
    });
  }
  search(
    query: string,
    topK = 10,
    mode: KnowledgeMode = 'hybrid',
    signal: AbortSignal,
    baseId?: string,
    options?: KnowledgeSearchOptions,
  ) {
    return this.read<KnowledgeHit[]>('search', { query, topK, mode, baseId, options }, signal);
  }
  version(baseId: string, signal: AbortSignal) {
    return this.read<string>('version', { baseId }, signal);
  }
  getItem(itemId: string, signal?: AbortSignal, expected?: KnowledgeItemExpectation) {
    return this.read<KnowledgeItem | null>('item', { itemId, expected }, signal);
  }
  getEvidenceItem(hit: KnowledgeHit, signal: AbortSignal, expected?: KnowledgeItemExpectation) {
    return this.read<EvidenceItem | null>('evidence', { hit, expected }, signal);
  }
}
