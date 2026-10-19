import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { KnowledgeHost } from '../../../shared/electron/backend/knowledge/host';
import { KnowledgeError } from '../../../shared/electron/backend/knowledge/errors';

const native = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: native.fork } }));
const hosts: KnowledgeHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.stop();
});

function setup() {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    postMessage: vi.fn((message: any) => {
      if (message.init || message.op === 'close')
        queueMicrotask(() => child.emit('message', { id: message.id, value: null }));
    }),
  });
  native.fork.mockReturnValue(child);
  const host = new KnowledgeHost('/synthetic/knowledge', '/synthetic/models');
  hosts.push(host);
  return { host, child };
}

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
  await rejected;
  child.emit('message', { id, value: ['late'] });
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
  expect((host as any).pending.size).toBe(0);
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
  expect((host as any).pending.size).toBe(0);
});

it('超时后发送取消失败仍保留 unavailable，并清除定时器和请求', async () => {
  const { host, child } = setup();
  await host.initialize();
  child.postMessage.mockImplementation((message: any) => {
    if (message.cancel) throw Error('synthetic closed timeout port');
  });
  vi.useFakeTimers();
  try {
    const pending = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect((host as any).pending.size).toBe(0);
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
  expect((host as any).child).toBeUndefined();
});
