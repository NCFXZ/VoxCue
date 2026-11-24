import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { LibraryKnowledgeHost as KnowledgeHost } from '../../electron/backend/knowledge/workerHost';
import { KnowledgeError } from '../../../shared/electron/backend/knowledge/errors';
import type { PrepareKnowledgeDatabase } from '../../electron/backend/knowledge/types';
import { KnowledgeCoordinator } from '../../electron/application/knowledge';

const native = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: native.fork } }));
const hosts: KnowledgeHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.stop();
});

function setup(progress = vi.fn(), prepareDatabase?: PrepareKnowledgeDatabase) {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit('exit', 0));
      return true;
    }),
    postMessage: vi.fn((message: any) => {
      if (message.init || message.op === 'close')
        queueMicrotask(() => child.emit('message', { id: message.id, value: null }));
    }),
  });
  native.fork.mockReturnValue(child);
  const host = new KnowledgeHost('/synthetic/knowledge', '/synthetic/models', progress, prepareDatabase);
  hosts.push(host);
  return { host, child };
}

it('releases each native path on fork failure or actual worker exit, and reopens with an independent lease', async () => {
  const leases = Array.from({ length: 3 }, (_, i) => ({ path: 'local-' + i, spawned: vi.fn(), release: vi.fn() }));
  let next = 0;
  const { host, child } = setup(vi.fn(), () => leases[next++]);
  native.fork.mockImplementationOnce(() => { throw Error('synthetic spawn error'); });
  await expect(host.initialize()).rejects.toThrow('synthetic spawn error');
  expect(leases[0].release).toHaveBeenCalledOnce();
  await host.initialize();
  expect(child.postMessage.mock.calls.at(-1)?.[0].init.databasePath).toBe(leases[1].path);
  Object.assign(child, { pid: 123 });
  child.emit('spawn');
  expect(leases[1].spawned).toHaveBeenCalledWith(123);
  child.emit('exit', 1);
  expect(leases[1].release).toHaveBeenCalledOnce();
  const replacement = setup().child;
  await host.initialize();
  expect(replacement.postMessage.mock.calls.at(-1)?.[0].init.databasePath).toBe(leases[2].path);
  expect(leases[2].release).not.toHaveBeenCalled();
  await host.close();
  expect(leases[2].release).toHaveBeenCalledOnce();
});

it('finishes a pending index upgrade on the first document status check and skips subsequent checks', async () => {
  const { host, child } = setup();
  let pending = true;
  child.postMessage.mockImplementation(m => {
    if (m.op === 'clean-upgraded-index') pending = false;
    const value = m.op === 'list' ? (pending ? [{ documentId: 'legacy' }] : []) : null;
    queueMicrotask(() => child.emit('message', { id: m.id, value, needsIndexCleanup: pending }));
  });
  await expect(host.listDocuments(false)).resolves.toEqual([{ documentId: 'legacy' }]);
  await expect(host.listDocuments()).resolves.toEqual([]);
  await expect(host.listDocuments()).resolves.toEqual([]);
  expect(child.postMessage.mock.calls.map(([m]) => m.op).filter(Boolean)).toEqual(['list', 'list', 'clean-upgraded-index', 'list', 'list']);
});

it.each([true, false])('gates a first import and batch on the same pending old-index cleanup, success=%s', async success => {
  const { host, child } = setup();
  const cleaning = Promise.withResolvers<string>();
  child.postMessage.mockImplementation(m => {
    if (m.op === 'clean-upgraded-index') { cleaning.resolve(m.id); return; }
    queueMicrotask(() => child.emit('message', { id: m.id, value: null, needsIndexCleanup: !!m.init }));
  });
  const signal = new AbortController().signal;
  const results = Promise.allSettled([
    host.indexDocument({ documentId: 'one', baseId: 'a', name: 'one.md', bytes: new Uint8Array([1]) }, signal),
    host.beginIndexBatch('batch', 'b', ['two', 'three'], signal),
  ]);
  const id = await cleaning.promise;
  const ops = () => child.postMessage.mock.calls.map(([m]) => m.op).filter(Boolean);
  expect(ops()).toEqual(['clean-upgraded-index']);
  child.emit('message', success ? { id, value: null, needsIndexCleanup: false } : { id, error: '旧索引清理失败' });
  const settled = await results;
  expect(settled.map(r => r.status)).toEqual(success ? ['fulfilled', 'fulfilled'] : ['rejected', 'rejected']);
  expect(ops().sort()).toEqual(success ? ['begin-index-batch', 'clean-upgraded-index', 'index'] : ['clean-upgraded-index']);
});

it('ends the deletion indicator if a cleanup worker exits after announcing deletion', async () => {
  const progress = vi.fn();
  const { host, child } = setup(progress);
  child.postMessage.mockImplementation(m => queueMicrotask(() => {
    if (m.op === 'clean-upgraded-index') {
      child.emit('message', { id: m.id, event: { type: 'old-index-deletion', active: true, documentIds: ['retired'] } });
      child.emit('exit', 1);
    } else child.emit('message', { id: m.id, value: m.op === 'list' ? [] : null, needsIndexCleanup: true });
  }));
  await host.listDocuments();
  expect(progress.mock.calls.flat()).toEqual([
    { type: 'old-index-deletion', active: true, documentIds: ['retired'] }, { type: 'old-index-deletion', active: false },
  ]);
  expect(host.indexCleanupError).toBeTruthy();
});

it.each(['complete', 'stall'] as const)('allows a busy library erase past ten minutes but retires a stalled writer: %s', async outcome => {
  const { host, child } = setup();
  await host.initialize();
  vi.useFakeTimers();
  try {
    const removal = host.removeBase('erase', new AbortController().signal);
    const settled = outcome === 'complete' ? expect(removal).resolves.toBeNull() :
      expect(removal).rejects.toMatchObject({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(0);
    const request = child.postMessage.mock.lastCall![0];
    expect(request.op).toBe('remove-base');
    child.emit('message', { id: request.id, started: true });
    const waiting = new AbortController();
    const other = host.search('unrelated', 5, 'keyword', waiting.signal);
    const cancelled = expect(other).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(550000);
    child.emit('message', { id: request.id, erasureProgress: 1 });
    await vi.advanceTimersByTimeAsync(550000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.postMessage.mock.calls.some(([m]) => m.op === 'search')).toBe(false);
    waiting.abort();
    await cancelled;
    if (outcome === 'complete') {
      child.emit('message', { id: request.id, erasureProgress: 2 });
      await vi.advanceTimersByTimeAsync(550000);
      expect(child.kill).not.toHaveBeenCalled();
      child.emit('message', { id: request.id, value: null });
    } else {
      child.emit('message', { id: request.id, erasureProgress: 1 });
      child.emit('message', { id: 'unrelated-request', erasureProgress: 2 });
      await vi.advanceTimersByTimeAsync(50001);
      expect(child.kill).toHaveBeenCalledOnce();
    }
    await settled;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it.each([
  'unavailable',
  'invalid_request',
  'configuration',
  'integrity',
  'not_ready',
  'cancelled',
  'closed',
] as const)('utilityProcess 的 %s 分类完整传递，下一次请求仍能完成', async (code) => {
  const { host, child } = setup();
  await host.initialize();
  const pending = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'KnowledgeError', code });
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(2));
  child.emit('message', {
    id: child.postMessage.mock.calls[1][0].id,
    error: '合成故障',
    errorCode: code,
  });
  await rejected;
  const next = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(3));
  child.emit('message', { id: child.postMessage.mock.calls[2][0].id, value: [] });
  await expect(next).resolves.toEqual([]);
});

it('进程退出属于可用性故障，主动关闭和取消不能回退；迟到消息不复活请求', async () => {
  const { host, child } = setup();
  await host.initialize();
  const controller = new AbortController();
  const cancelled = host.search('synthetic', 5, 'hybrid', controller.signal);
  const rejected = expect(cancelled).rejects.toBeInstanceOf(KnowledgeError);
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(2));
  const id = child.postMessage.mock.calls[1][0].id;
  controller.abort();
  child.emit('message', { id, value: ['late'] });
  await rejected;
  const pending = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
  const exited = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(4));
  child.emit('exit');
  await exited;
  const other = setup();
  await other.host.initialize();
  const pendingClose = other.host.search('synthetic', 5, 'hybrid', new AbortController().signal);
  const closed = expect(pendingClose).rejects.toMatchObject({ code: 'closed' });
  await vi.waitFor(() => expect(other.child.postMessage).toHaveBeenCalledTimes(2));
  other.host.stop();
  await closed;
});

it('发送失败时取消消息也可能失败，仍保留可用性错误码并清理请求', async () => {
  const { host, child } = setup();
  await host.initialize();
  child.postMessage.mockImplementation(() => {
    throw Error('synthetic disconnected utility port');
  });
  await expect(
    host.search('synthetic', 5, 'hybrid', new AbortController().signal),
  ).rejects.toMatchObject({
    name: 'KnowledgeError',
    code: 'unavailable',
  });
  expect((host as any).primary.pending.size).toBe(0);
});

it('取消时端口已退出仍返回 cancelled，迟到响应不能恢复请求', async () => {
  const { host, child } = setup();
  await host.initialize();
  child.postMessage.mockImplementation((message: any) => {
    if (message.cancel) throw Error('synthetic closed cancel port');
  });
  const controller = new AbortController();
  const pending = host.search('synthetic', 5, 'hybrid', controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(2));
  const id = child.postMessage.mock.calls[1][0].id;
  controller.abort();
  await rejected;
  child.emit('message', { id, value: ['late'] });
  expect((host as any).primary.pending.size).toBe(0);
});

it('超时确认进程退出后保留 unavailable，并清除定时器和请求', async () => {
  const { host, child } = setup();
  await host.initialize();
  child.postMessage.mockImplementation((message: any) => {
    if (message.cancel) throw Error('synthetic closed timeout port');
  });
  vi.useFakeTimers();
  try {
    const pending = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    await Promise.resolve();
    child.emit('message', { id: child.postMessage.mock.calls.at(-1)![0].id, started: true });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect((host as any).primary.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('holds reads behind a library purge while allowing the caller to cancel its wait', async () => {
  const { host, child } = setup();
  const purging = host.removeBase('target', new AbortController().signal);
  const waiting = new AbortController();
  const cancelled = expect(host.search('synthetic', 5, 'keyword', waiting.signal)).rejects.toMatchObject({ name: 'AbortError' });
  const listing = host.listDocuments(false);
  waiting.abort();
  await cancelled;
  await vi.waitFor(() => expect(child.postMessage.mock.calls.at(-1)?.[0].op).toBe('remove-base'));
  expect(child.postMessage.mock.calls.some(([m]) => m.op === 'list' || m.op === 'search')).toBe(false);
  child.emit('message', { id: child.postMessage.mock.calls.at(-1)![0].id, value: null });
  await purging;
  await vi.waitFor(() => expect(child.postMessage.mock.calls.at(-1)?.[0].op).toBe('list'));
  child.emit('message', { id: child.postMessage.mock.calls.at(-1)![0].id, value: [] });
  await expect(listing).resolves.toEqual([]);
});

it.each([
  ['remove-base', true], ['remove-base', false], ['remove', true], ['remove', false],
] as const)('%s allows another library to finish its batch, removal starts first = %s', async (op, removalFirst) => {
  const { host, child } = setup();
  const coordinator = new KnowledgeCoordinator(host, '/synthetic/models', vi.fn());
  const attempts: string[] = [];
  child.postMessage.mockImplementation(m => {
    if (m.op === op) {
      attempts.push(m.id);
      return;
    }
    const reply = m.cancel ? { id: m.cancel, error: '知识库操作已取消。', errorCode: 'cancelled' } : { id: m.id, value: null };
    queueMicrotask(() => child.emit('message', reply));
  });
  const remove = () => coordinator.call(op === 'remove-base'
    ? { op, baseId: 'target', requestId: 'delete' }
    : { op, documentId: 'deleted-file', requestId: 'delete' });
  const imported = (documentId: string, baseId = 'keep', batchId?: string) => coordinator.call({
    op: 'import', requestId: 'index-' + documentId, documentId, baseId, batchId,
    name: 'synthetic.txt', bytes: new Uint8Array([1]),
  });
  let removal = removalFirst ? remove() : undefined;
  if (removalFirst) await vi.waitFor(() => expect(attempts).toHaveLength(1));
  try {
    await coordinator.call({ op: 'begin-index-batch', requestId: 'batch', baseId: 'keep', documentIds: ['one', 'two'] });
    removal ??= remove();
    await expect(imported('deleted-file', 'target')).rejects.toThrow(/处理中/);
    await imported('one', 'keep', 'batch');
    // The writer must keep its reservation even while no import call is active.
    expect(attempts).toHaveLength(removalFirst ? 1 : 0);
    await imported('two', 'keep', 'batch');
    await coordinator.call({ op: 'finish-index-batch', requestId: 'commit', batchId: 'batch', commit: true });
    await vi.waitFor(() => expect(attempts).toHaveLength(removalFirst ? 2 : 1));
    expect(child.postMessage.mock.calls.map(([m]) => m.op).filter(Boolean)).toEqual([
      ...(removalFirst ? [op] : []), 'begin-index-batch', 'index', 'index', 'finish-index-batch', op,
    ]);
    if (removalFirst) expect(child.postMessage).toHaveBeenCalledWith({ cancel: attempts[0] });
    child.emit('message', { id: attempts.at(-1), value: null });
    await expect(removal).resolves.toBeNull();
  } finally {
    await coordinator.cancelBatch().catch(() => {});
    await coordinator.call({ op: 'cancel', requestId: 'delete' }).catch(() => {});
    await removal?.catch(() => {});
  }
});

it('does not repeat a deletion that commits while a new import is asking it to pause', async () => {
  const { host, child } = setup();
  const started = Promise.withResolvers<string>();
  child.postMessage.mockImplementation(m => {
    if (m.op === 'remove-base') { started.resolve(m.id); return; }
    if (m.cancel) return;
    queueMicrotask(() => child.emit('message', { id: m.id, value: m.op === 'index' ? { documentId: 'new' } : null }));
  });
  const signal = new AbortController().signal;
  const deleting = host.removeBase('target', signal);
  const id = await started.promise;
  const indexing = host.indexDocument({ documentId: 'new', baseId: 'keep', name: 'new.txt', bytes: new Uint8Array([1]) }, signal);
  expect(child.postMessage).toHaveBeenCalledWith({ cancel: id });
  child.emit('message', { id, value: null });
  await expect(deleting).resolves.toBeNull();
  await expect(indexing).resolves.toMatchObject({ documentId: 'new' });
  expect(child.postMessage.mock.calls.map(([m]) => m.op).filter(Boolean)).toEqual(['remove-base', 'index']);
});

it('waits for a stalled erase worker to exit before indexing, then resumes deletion', async () => {
  const { host, child: stalled } = setup();
  await host.initialize();
  const { child: replacement } = setup();
  replacement.postMessage.mockImplementation(m => queueMicrotask(() => replacement.emit('message', { id: m.id, value: null })));
  const signal = new AbortController().signal;
  vi.useFakeTimers();
  try {
    const deleting = host.removeBase('target', signal);
    const deleted = expect(deleting).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    const request = stalled.postMessage.mock.lastCall![0];
    expect(request.op).toBe('remove-base');
    const indexing = host.indexDocument({ documentId: 'new', baseId: 'keep', name: 'new.txt', bytes: new Uint8Array([1]) }, signal);
    const indexed = expect(indexing).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(9999);
    expect(stalled.postMessage).toHaveBeenCalledWith({ cancel: request.id });
    expect(stalled.kill).not.toHaveBeenCalled();
    expect(replacement.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([indexed, deleted]);
    expect(stalled.kill).toHaveBeenCalledOnce();
    expect(replacement.postMessage.mock.calls.map(([m]) => m.op).filter(Boolean)).toEqual(['index', 'remove-base']);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it.each([false, true])('deletion resumes after retiring an unresponsive cancelled index writer, batch=%s', async (batch) => {
  const { host, child: stalled } = setup();
  stalled.postMessage.mockImplementation(m => {
    if (m.init || m.op === 'begin-index-batch') {
      queueMicrotask(() => stalled.emit('message', { id: m.id, value: null }));
    } else if (m.op === 'index') {
      queueMicrotask(() => stalled.emit('message', { id: m.id, started: true }));
    }
  });
  const coordinator = new KnowledgeCoordinator(host, '/synthetic/models', vi.fn());
  await host.initialize();
  if (batch) await coordinator.call({ op: 'begin-index-batch', requestId: 'batch', baseId: 'target', documentIds: ['one', 'two'] });
  const { child: replacement } = setup();
  replacement.postMessage.mockImplementation(m => queueMicrotask(() => replacement.emit('message', { id: m.id, value: null })));
  vi.useFakeTimers();
  try {
    const indexing = coordinator.call({
      op: 'import', requestId: 'index', documentId: 'one', baseId: 'target', name: 'synthetic.md',
      bytes: new Uint8Array([1]), ...(batch && { batchId: 'batch' }),
    });
    const cancelled = expect(indexing).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    const indexRequest = stalled.postMessage.mock.lastCall![0];
    expect(indexRequest.op).toBe('index');
    const deleting = coordinator.call({ op: 'remove-base', requestId: 'delete', baseId: 'target' });
    const deleted = expect(deleting).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(9999);
    expect(stalled.postMessage).toHaveBeenCalledWith({ cancel: indexRequest.id });
    expect(stalled.kill).not.toHaveBeenCalled();
    expect(replacement.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([cancelled, deleted]);
    expect(stalled.kill).toHaveBeenCalledOnce();
    expect(replacement.postMessage.mock.calls.map(([m]) => m.op).filter(Boolean))
      .toEqual(batch ? ['finish-index-batch', 'remove-base'] : ['remove-base']);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('serves committed reads while a writer is still indexing and retires the extra reader afterwards', async () => {
  const { host, child: writer } = setup();
  await host.initialize();
  const indexing = host.indexDocument(
    { documentId: 'new', baseId: 'base', name: 'new.txt', bytes: new Uint8Array([1]) },
    new AbortController().signal,
  );
  const { child: reader } = setup();
  const controller = new AbortController();
  const lookup = host.search('synthetic', 5, 'hybrid', controller.signal);
  await vi.waitFor(() => expect(reader.postMessage.mock.calls.at(-1)?.[0].op).toBe('search'));
  expect(reader.postMessage.mock.calls[0][0].init.snapshotGeneration).toBe(0);
  const message = reader.postMessage.mock.calls.at(-1)![0];
  reader.emit('message', { id: message.id, started: true });
  reader.emit('message', { id: message.id, value: [{ documentId: 'committed' }] });
  await expect(lookup).resolves.toEqual([{ documentId: 'committed' }]);
  expect(writer.postMessage.mock.calls.at(-1)?.[0].op).toBe('index');
  expect(reader.kill).not.toHaveBeenCalled();
  writer.emit('message', { id: writer.postMessage.mock.calls.at(-1)![0].id, value: { documentId: 'new' } });
  await indexing;
  expect(reader.kill).toHaveBeenCalledOnce();
});

it.each(['close', 'unloadModel'] as const)('索引和查询取消后等读进程完成 %s 再退出', async lifecycle => {
  const { host, child: writer } = setup();
  await host.initialize();
  const signal = new AbortController();
  const indexing = host.indexDocument(
    { documentId: 'doc', baseId: 'base', name: 'doc.txt', bytes: new Uint8Array([1]) },
    signal.signal,
  );
  const { child: reader } = setup();
  const searching = host.search('synthetic', 5, 'keyword', signal.signal);
  await vi.waitFor(() => expect(reader.postMessage.mock.calls.at(-1)?.[0].op).toBe('search'));
  const children = [writer, reader];
  function acknowledge(child: typeof writer, op: string) {
    const message = child.postMessage.mock.calls.find(([m]) => m.op === op)![0];
    child.emit('message', { id: message.id, value: null });
  }
  // Both utilities process shutdown after the in-flight requests they acknowledge.
  for (const child of children) child.postMessage.mockImplementation(() => {});
  signal.abort();
  const closing = host[lifecycle]();
  const settled = Promise.allSettled([indexing, searching]);
  acknowledge(writer, 'index');
  acknowledge(reader, 'search');
  expect((await settled).map(r => r.status === 'rejected' && r.reason.code)).toEqual(['cancelled', 'cancelled']);
  expect(reader.kill).not.toHaveBeenCalled();
  if (lifecycle === 'unloadModel') {
    for (const child of children) acknowledge(child, 'unload-model');
    await vi.waitFor(() => expect(reader.postMessage.mock.calls.at(-1)?.[0].op).toBe('close'));
  }
  for (const child of children) acknowledge(child, 'close');
  await expect(closing).resolves.toBeUndefined();
  for (const child of children) expect(child.kill).toHaveBeenCalledOnce();
});

it('进程从不确认检索开始时仍有存活期限，不会永久保留请求', async () => {
  const { host, child } = setup();
  await host.initialize();
  vi.useFakeTimers();
  try {
    const rejected = expect(
      host.search('synthetic', 5, 'hybrid', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(600001);
    await rejected;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it.each([undefined, 'future-code'])(
  '缺失或未知 wire 错误码 %s 按 integrity 处理',
  async (errorCode) => {
    const { host, child } = setup();
    await host.initialize();
    const pending = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'integrity' });
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(2));
    child.emit('message', {
      id: child.postMessage.mock.calls[1][0].id,
      error: 'synthetic wire error',
      errorCode,
    });
    await rejected;
  },
);

it('模型卸载必须等真实 exit 事件，不能在 kill 返回时宣称文件已释放', async () => {
  const { host, child } = setup();
  child.kill.mockImplementation(() => true);
  await host.initialize();
  child.postMessage.mockImplementation((message: any) => {
    if (['unload-model', 'close'].includes(message.op))
      queueMicrotask(() => child.emit('message', { id: message.id, value: null }));
  });
  let completed = false;
  const unloading = host.unloadModel().then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1));
  expect(completed).toBe(false);
  expect(child.listenerCount('exit')).toBe(2);
  child.emit('exit', 0);
  await unloading;
  expect(completed).toBe(true);
  expect(child.listenerCount('exit')).toBe(1);
  expect((host as any).primary.child).toBeUndefined();
});

it('取消保留在途请求直到 utility 确认退休，丢弃进度和迟到成功', async () => {
  const progress = vi.fn();
  const { host, child } = setup(progress);
  await host.initialize();
  const controller = new AbortController();
  const operation = host.indexDocument(
    { documentId: 'doc', baseId: 'base', name: 'a.doc', bytes: new Uint8Array([1]) },
    controller.signal,
  );
  let settled = false;
  void operation.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const rejected = expect(operation).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(2));
  const id = child.postMessage.mock.calls[1][0].id;
  controller.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect((host as any).primary.pending.size).toBe(1);
  expect(child.postMessage).toHaveBeenLastCalledWith({ cancel: id });
  child.emit('message', { id, event: { documentId: 'doc', phase: 'ready' } });
  expect(progress).not.toHaveBeenCalled();
  child.emit('message', { id, value: { documentId: 'doc' } });
  await rejected;
  expect((host as any).primary.pending.size).toBe(0);
});

it.each([false, true])('kill 未确认退出时旧请求有限失败，仍不启动替代或假称关闭 (%s)', async (throws) => {
  const { host, child } = setup();
  child.kill.mockImplementation(() => {
    if (throws) throw Error('synthetic kill failure');
    return false;
  });
  await host.initialize();
  vi.useFakeTimers();
  try {
    const operation = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
    const rejected = expect(operation).rejects.toMatchObject({ code: 'unavailable' });
    let settled = false;
    void operation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    host.stop();
    const forks = native.fork.mock.calls.length;
    const posted = child.postMessage.mock.calls.length;
    const closing = expect(host.close()).rejects.toMatchObject({ code: 'unavailable' });
    const replacement = expect(host.initialize()).rejects.toMatchObject({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(20001);
    await Promise.all([rejected, closing, replacement]);
    expect(settled).toBe(true);
    expect(native.fork).toHaveBeenCalledTimes(forks);
    expect(child.postMessage).toHaveBeenCalledTimes(posted);
    child.emit('exit', 0);
    setup(); // A fresh utility becomes available only after the old exit.
    await host.initialize();
    expect(native.fork).toHaveBeenCalledTimes(forks + 1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('卸载请求超时且 kill 未退出时明确失败，仍阻止替代进程', async () => {
  const { host, child } = setup();
  child.kill.mockImplementation(() => true);
  await host.initialize();
  child.postMessage.mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    const unloading = expect(host.unloadModel()).rejects.toMatchObject({ code: 'unavailable' });
    const forks = native.fork.mock.calls.length;
    await vi.advanceTimersByTimeAsync(50001);
    await unloading;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(native.fork).toHaveBeenCalledTimes(forks);
    child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
