import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  refreshSnapshot: vi.fn(async () => {}),
  listDocuments: vi.fn(async (): Promise<string[]> => []),
  index: vi.fn(async (_input: unknown, _signal: AbortSignal): Promise<unknown> => ({})),
  removeBase: vi.fn(async (_base: string, _signal: AbortSignal, _step: () => void): Promise<null> => null),
  search: vi.fn(async () => []),
  getItem: vi.fn(),
}));
vi.mock('../../electron/backend/knowledge/service', () => ({
  KnowledgeService: class {
    initialize = runtime.initialize;
    refreshSnapshot = runtime.refreshSnapshot;
    listDocuments = runtime.listDocuments;
    indexDocument = runtime.index;
    removeBase = runtime.removeBase;
    search = runtime.search;
    getItem = runtime.getItem;
  },
}));
vi.mock('../../electron/backend/knowledge/parser', () => ({ parseDocument: vi.fn() }));
vi.mock('../../electron/backend/knowledge/embedding', () => ({ LocalEmbedder: class {} }));

let port: EventEmitter & { postMessage: ReturnType<typeof vi.fn> };
let previousPort: PropertyDescriptor | undefined;
let previousSignals: Function[];
const send = (message: object) => port.emit('message', { data: message });
const drain = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
beforeEach(async () => {
  vi.resetModules();
  runtime.index.mockReset().mockResolvedValue({});
  runtime.removeBase.mockReset().mockResolvedValue(null);
  runtime.search.mockClear();
  runtime.getItem.mockReset();
  runtime.refreshSnapshot.mockReset();
  port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  previousPort = Object.getOwnPropertyDescriptor(process, 'parentPort');
  previousSignals = process.listeners('SIGTERM');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  await import('../../electron/backend/knowledge/process');
  send({ id: 'init', init: { directory: 'synthetic', modelPath: 'synthetic', snapshotGeneration: 0 } });
  await drain();
  port.postMessage.mockClear();
});
afterEach(() => {
  for (const listener of process.listeners('SIGTERM'))
    if (!previousSignals.includes(listener)) process.removeListener('SIGTERM', listener);
  if (previousPort) Object.defineProperty(process, 'parentPort', previousPort);
  else Reflect.deleteProperty(process, 'parentPort');
});

it('reports library progress only after real storage work, scoped to its active request', async () => {
  const gate = Promise.withResolvers<void>();
  runtime.removeBase.mockImplementationOnce(async (_id, _signal, step) => {
    await gate.promise;
    step();
    step();
    return null;
  });
  send({ id: 'erase', op: 'remove-base', baseId: 'example' });
  await drain();
  expect(port.postMessage.mock.calls.map(([message]) => message)).toEqual([{ id: 'erase', started: true }]);
  gate.resolve();
  await drain();
  expect(port.postMessage.mock.calls.map(([message]) => message)).toEqual([
    { id: 'erase', started: true }, { id: 'erase', erasureProgress: 1 }, { id: 'erase', value: null },
  ]);
});

it('仅将匹配版本的已核实摘录送回 RAG，详情仍得到完整条目', async () => {
  const fact = 'PID sensor 37', id = 'root', documentId = 'doc';
  const root = { itemId: id, documentId, kind: 'text', title: 'sensor', section: 'measure',
    content: 'x'.repeat(1024 * 1024) + fact, followUpIds: [],
    source: { baseId: 'kb', revision: 'r1' } };
  const hit = { itemId: id, documentId, baseId: 'kb', revision: 'r1',
    matchedItemId: id, excerpt: 'sensor\n' + fact };
  runtime.getItem.mockResolvedValue(root);
  send({ id: 'probe', op: 'evidence', hit });
  await drain();
  const projected = port.postMessage.mock.lastCall![0].value;
  expect(projected).toMatchObject({ itemId: id, documentId, content: undefined, passage: fact });
  expect(JSON.stringify(projected).length).toBeLessThan(1024);
  runtime.getItem.mockResolvedValue({ ...root, rootContent: root.content });
  send({ id: 'bad-link', op: 'evidence', hit: { ...hit, matchedItemIds: ['absent'] } });
  await drain();
  expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'bad-link', errorCode: 'integrity' }));
  send({ id: 'detail', op: 'item', itemId: id });
  await drain();
  expect(port.postMessage.mock.lastCall![0].value.content).toBe(root.content);
});

it('acknowledges execution only after the preceding index completes; queued cancellation drops bytes immediately', async () => {
  let finish!: () => void;
  runtime.index.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
  send({ id: 'index', op: 'index', input: { bytes: new Uint8Array([1]) } });
  await drain();
  const queued = { id: 'cancelled-index', op: 'index', input: { bytes: new Uint8Array(1024) } };
  send(queued);
  send({ id: 'search', op: 'search', query: 'synthetic' });
  expect(port.postMessage.mock.calls.map(([message]) => message)).toEqual([
    { id: 'index', started: true },
  ]);
  send({ cancel: 'cancelled-index' });
  expect(queued.input).toBeUndefined();
  expect(port.postMessage).toHaveBeenLastCalledWith({
    id: 'cancelled-index', error: '知识库操作已取消。', errorCode: 'cancelled',
  });
  expect(runtime.search).not.toHaveBeenCalled();
  finish();
  await drain();
  expect(runtime.index).toHaveBeenCalledOnce();
  expect(runtime.search).toHaveBeenCalledOnce();
  expect(port.postMessage.mock.calls.map(([message]) => message.id)).toEqual([
    'index', 'cancelled-index', 'index', 'search', 'search',
  ]);
});

it('active cancellation keeps retirement pending until the operation actually releases its input', async () => {
  let finish!: () => void;
  runtime.index.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
  const message = { id: 'active', op: 'index', input: { bytes: new Uint8Array(1024) } };
  send(message);
  await drain();
  send({ cancel: 'active' });
  await drain();
  expect(message.input).toBeDefined();
  expect(port.postMessage).toHaveBeenCalledTimes(1);
  finish();
  await drain();
  expect(message.input).toBeUndefined();
  expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    id: 'active', errorCode: 'cancelled',
  }));
});

it('首次检索在初始化时取消后，下一代读取重新打开撤销后的目录', async () => {
  // No search message reached this process when the first caller cancelled.
  let snapshot = ['withdrawn'];
  runtime.listDocuments.mockImplementation(async () => [...snapshot]);
  runtime.refreshSnapshot.mockImplementationOnce(async () => { snapshot = []; });
  for (const id of ['first-list', 'second-list']) {
    send({ id, op: 'list', snapshotGeneration: 1 });
    await drain();
    expect(port.postMessage).toHaveBeenLastCalledWith({ id, value: [] });
  }
  expect(runtime.refreshSnapshot).toHaveBeenCalledOnce();
});
