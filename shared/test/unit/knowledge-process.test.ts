import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  index: vi.fn(async (_input: unknown, _signal: AbortSignal): Promise<unknown> => ({})),
  search: vi.fn(async () => []),
}));
vi.mock('../../electron/backend/knowledge/service', () => ({
  KnowledgeService: class {
    initialize = runtime.initialize;
    indexDocument = runtime.index;
    search = runtime.search;
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
  runtime.search.mockClear();
  port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  previousPort = Object.getOwnPropertyDescriptor(process, 'parentPort');
  previousSignals = process.listeners('SIGTERM');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  await import('../../electron/backend/knowledge/process');
  send({ id: 'init', init: { directory: 'synthetic', modelPath: 'synthetic' } });
  await drain();
  port.postMessage.mockClear();
});
afterEach(() => {
  for (const listener of process.listeners('SIGTERM'))
    if (!previousSignals.includes(listener)) process.removeListener('SIGTERM', listener);
  if (previousPort) Object.defineProperty(process, 'parentPort', previousPort);
  else Reflect.deleteProperty(process, 'parentPort');
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
