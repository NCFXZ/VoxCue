import { KnowledgeService } from './service';
import { parseDocument } from './parser';
import { LocalEmbedder } from './embedding';
import { KnowledgeError } from './errors';
const port = process.parentPort!;
let core: KnowledgeService;
let active: string | undefined;
let queue: Promise<unknown> = Promise.resolve();
const controllers = new Map<string, AbortController>();
port.on('message', ({ data: m }) => {
  if (m.cancel) {
    controllers.get(m.cancel)?.abort();
    return;
  }
  if (typeof m.id !== 'string') return;
  const controller = new AbortController();
  controllers.set(m.id, controller);
  queue = queue
    .catch(() => {})
    .then(async () => {
      active = m.id;
      const signal = controller.signal;
      try {
        signal.throwIfAborted();
        let value: unknown;
        if (m.init) {
          core = new KnowledgeService(
            m.init.directory,
            new LocalEmbedder(m.init.modelPath),
            (event) => {
              if (active && !controllers.get(active)?.signal.aborted)
                port.postMessage({ id: active, event });
            },
            parseDocument,
          );
          await core.initialize();
        } else
          switch (m.op) {
            case 'index':
              value = await core.indexDocument(m.input, signal);
              break;
            case 'invalidate':
              value = await core.invalidateDocument(m.documentId, signal);
              break;
            case 'remove':
              value = await core.removeDocument(m.documentId, signal);
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
            case 'version':
              value = await core.version(m.baseId, signal);
              break;
            case 'prepare-query':
              value = await core.prepareQuery(m.query, m.fallback, signal);
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
        signal.throwIfAborted();
        port.postMessage({ id: m.id, value });
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
    });
});
function publicError(error: unknown) {
  if (
    error instanceof Error &&
    /[\u4e00-\u9fff]/.test(error.message) &&
    error.message.length < 500 &&
    !/[A-Z]:[\\/]|Bearer|token=/i.test(error.message)
  )
    return error.message;
  return '知识库处理失败，请重试或重新索引。';
}
process.on('SIGTERM', () => {
  for (const c of controllers.values()) c.abort();
  void core?.close().finally(() => process.exit(0));
});
