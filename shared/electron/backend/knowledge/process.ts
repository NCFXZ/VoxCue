import { KnowledgeService } from './service';
import { parseDocument } from './parser';
import { LocalEmbedder } from './embedding';
import { KnowledgeError } from './errors';
import { projectEvidence } from './evidence';
import { migrateLibraryLayout } from './libraryMigration';
import type { OldIndexDeletion } from '../../contracts/knowledge';
const port = process.parentPort!;
let core: KnowledgeService;
let snapshotGeneration: number | undefined;
let active: string | undefined;
let running = false;
const controllers = new Map<string, AbortController>();
const queued = new Map<string, Record<string, any>>();
port.on('message', ({ data: m }) => {
  if (m.cancel) {
    controllers.get(m.cancel)?.abort();
    const waiting = queued.get(m.cancel);
    if (waiting) {
      // Release imported bytes and the queued envelope before acknowledging
      // retirement. Cancellation must not leave an unaccounted queued document.
      waiting.input = undefined;
      queued.delete(m.cancel);
      controllers.delete(m.cancel);
      port.postMessage({ id: m.cancel, error: '知识库操作已取消。', errorCode: 'cancelled' });
    }
    return;
  }
  if (typeof m.id !== 'string') return;
  const controller = new AbortController();
  controllers.set(m.id, controller);
  queued.set(m.id, m);
  void drain();
});
async function drain() {
  if (running) return;
  running = true;
  try {
    while (queued.size) {
      const [id, m] = queued.entries().next().value!;
      queued.delete(id);
      const controller = controllers.get(id)!;
      active = m.id;
      const signal = controller.signal;
      let steps = 0, lastProgress = -Infinity;
      const deleting = (event: OldIndexDeletion) => port.postMessage({ id, event });
      const erasureProgress = () => {
        const now = performance.now();
        if (signal.aborted || now - lastProgress < 1000) return;
        lastProgress = now;
        port.postMessage({ id: m.id, erasureProgress: ++steps });
      };
      try {
        signal.throwIfAborted();
        port.postMessage({ id: m.id, started: true });
        let value: unknown;
        if (m.init?.layoutMigration) {
          await migrateLibraryLayout(m.init.directory, erasureProgress);
        } else if (m.init) {
          core = new KnowledgeService(
            m.init.directory,
            new LocalEmbedder(m.init.modelPath),
            (event) => {
              if (active && !controllers.get(active)?.signal.aborted)
                port.postMessage({ id: active, event });
            },
            parseDocument,
            undefined,
            m.init.snapshotGeneration !== undefined,
            m.init.databasePath,
          );
          await core.initialize(erasureProgress);
          // Initialization pins a catalog even if its triggering lookup is cancelled before dispatch.
          snapshotGeneration = m.init.snapshotGeneration;
        } else {
          if (m.snapshotGeneration !== undefined && m.snapshotGeneration !== snapshotGeneration) {
            await core.refreshSnapshot();
            snapshotGeneration = m.snapshotGeneration;
          }
          switch (m.op) {
            case 'begin-index-batch':
              value = await core.beginIndexBatch(m.batchId, m.baseId, m.documentIds, signal);
              break;
            case 'finish-index-batch':
              value = await core.finishIndexBatch(m.batchId, m.commit, signal);
              break;
            case 'index':
              value = await core.indexDocument(m.input, signal);
              break;
            case 'invalidate':
              value = await core.invalidateDocument(m.documentId, signal);
              break;
            case 'remove':
              value = await core.removeDocument(m.documentId, signal);
              break;
            case 'remove-base':
              value = await core.removeBase(m.baseId, signal, erasureProgress, deleting);
              break;
            case 'clean-upgraded-index':
              value = await core.cleanUpgradedIndex(signal, erasureProgress, deleting);
              break;
            case 'list':
              value = await core.listDocuments();
              break;
            case 'search':
              value = await core.search(m.query, m.topK, m.mode, signal, m.baseId, m.options);
              break;
            case 'item':
              value = await core.getItem(m.itemId, signal, m.expected);
              break;
            case 'evidence': {
              const item = await core.getItem(m.hit.itemId, signal, m.expected);
              signal.throwIfAborted();
              value = item ? projectEvidence(m.hit, item) : null;
              break;
            }
            case 'version':
              value = await core.version(m.baseId, signal);
              break;
            case 'close':
              await core.close();
              break;
            case 'unload-model':
              await core.unloadModel();
              break;
            default:
              throw new KnowledgeError('invalid_request', '未知知识库操作。');
          }
        }
        // A completed removal may have committed before its pause arrived.
        if (m.op !== 'remove' && m.op !== 'remove-base') signal.throwIfAborted();
        port.postMessage({ id: m.id, value, needsIndexCleanup: core?.needsIndexCleanup });
      } catch (error) {
        port.postMessage({
          id: m.id,
          error: publicError(error),
          errorCode: signal.aborted
            ? 'cancelled'
            : error instanceof KnowledgeError
              ? error.code
              : 'unavailable',
        });
      } finally {
        m.input = undefined;
        controllers.delete(m.id);
        active = undefined;
      }
    }
  } finally {
    running = false;
  }
}
function publicError(error: unknown) {
  if (
    error instanceof Error &&
    /[\u4e00-\u9fff]/.test(error.message) &&
    error.message.length < 500 &&
    !/[A-Z]:[\\/]|Bearer|token=/i.test(error.message)
  )
    return error.message;
  return '知识库处理失败，请重试。';
}
process.on('SIGTERM', () => {
  for (const c of controllers.values()) c.abort();
  if (!core) process.exit(0);
  void core.close().finally(() => process.exit(0));
});
