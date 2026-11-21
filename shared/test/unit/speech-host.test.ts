import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const native = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: native.fork } }));
import { SpeechHost } from '../../electron/backend/speech/host';
const hosts: SpeechHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.stop();
  native.fork.mockReset();
  vi.useRealTimers();
});
function createChild() {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    postMessage: vi.fn((m: any) => {
      if (m.init || m.call?.op === 'status')
        queueMicrotask(() => child.emit('message', {
          id: m.id,
          value: m.init ? undefined : { state: 'idle', model: 'synthetic' },
        }));
    }),
  });
  return child;
}
function createHost(qwen?: string) {
  const host = new SpeechHost('model', 'helper', () => {}, 'process', qwen);
  hosts.push(host);
  return host;
}
it('采集中进程消失后，替代进程的正常退出只向本场面试报告一次未收尾', async () => {
  const previous = createChild(), next = createChild();
  const original = next.postMessage.getMockImplementation()!;
  next.postMessage.mockImplementation(m => {
    if (m.call?.op === 'stop') queueMicrotask(() => next.emit('message', {
      id: m.id, value: { state: 'idle', model: 'synthetic' },
    }));
    else original(m);
  });
  native.fork.mockReturnValueOnce(previous).mockReturnValueOnce(next);
  const host = createHost();
  await host.call({ op: 'status' });
  previous.emit('message', { event: { type: 'status', status: { state: 'running', model: 'synthetic' } } });
  previous.emit('exit', 1);
  expect(await host.call({ op: 'status' })).not.toHaveProperty('transcriptTailIncomplete');
  expect(await host.call({ op: 'stop' })).toMatchObject({ state: 'idle', transcriptTailIncomplete: true });
  expect(await host.call({ op: 'stop' })).not.toHaveProperty('transcriptTailIncomplete');
});
it('排空两条原生输出管道，大量诊断输出不会阻塞初始化或 RPC', async () => {
  const child = Object.assign(createChild(), {
    stdout: new PassThrough({ highWaterMark: 1024 }),
    stderr: new PassThrough({ highWaterMark: 1024 }),
  });
  child.postMessage.mockImplementation((m: any) => {
    const ready = m.init
      ? Promise.all([child.stdout, child.stderr].map((stream) =>
          new Promise<void>((resolve, reject) => stream.write(
            Buffer.alloc(256 * 1024, 65), (error) => error ? reject(error) : resolve(),
          )),
        ))
      : Promise.resolve();
    void ready.then(() => child.emit('message', {
      id: m.id, value: { state: 'idle', model: 'synthetic' },
    }));
  });
  native.fork.mockReturnValue(child);
  expect(await createHost().call({ op: 'status' })).toEqual({ state: 'idle', model: 'synthetic' });
  expect(child.stdout.readableLength).toBe(0);
  expect(child.stderr.readableLength).toBe(0);
  child.stdout.destroy();
  child.stderr.destroy();
});
it('停止后等旧进程实际退出才释放请求并启动替代进程，忽略迟到响应', async () => {
  const previous = createChild(), next = createChild();
  native.fork.mockReturnValueOnce(previous).mockReturnValueOnce(next);
  const host = createHost();
  await host.call({ op: 'status' });
  const pending = host.call({ op: 'devices' });
  const rejected = expect(pending).rejects.toThrow('已关闭');
  await Promise.resolve();
  const envelope = previous.postMessage.mock.calls.at(-1)![0];
  host.stop();
  host.stop();
  let finished = false;
  void pending.catch(() => { finished = true; });
  const restarted = host.call({ op: 'status' });
  await Promise.resolve();
  previous.emit('message', { id: envelope.id, value: { state: 'running', model: 'stale' } });
  expect(finished).toBe(false);
  expect(native.fork).toHaveBeenCalledTimes(1);
  expect(previous.kill).toHaveBeenCalledTimes(1);
  previous.emit('exit', 0);
  await rejected;
  expect(await restarted).toEqual({ state: 'idle', model: 'synthetic' });
  expect(native.fork).toHaveBeenCalledTimes(2);
});
it.each([false, true])('退出未确认时超时仍阻止替代，kill 抛错=%s；迟到退出后可恢复', async (throws) => {
  vi.useFakeTimers();
  const previous = createChild(), next = createChild();
  if (throws) previous.kill.mockImplementation(() => { throw Error('synthetic kill failure'); });
  native.fork.mockReturnValueOnce(previous).mockReturnValueOnce(next);
  const host = createHost();
  await host.call({ op: 'status' });
  host.stop();
  const rejected = expect(host.call({ op: 'status' })).rejects.toThrow('尚未退出');
  const closeRejected = expect(host.close()).rejects.toThrow('尚未退出');
  await vi.advanceTimersByTimeAsync(10000);
  await rejected;
  await closeRejected;
  expect(native.fork).toHaveBeenCalledTimes(1);
  previous.emit('exit', 0);
  expect(await host.call({ op: 'status' })).toEqual({ state: 'idle', model: 'synthetic' });
});
it.each([false, true])('kill 失败且不退出时旧请求有限期限拒绝，仍阻止替代进程 (%s)', async (throws) => {
  vi.useFakeTimers();
  const previous = createChild();
  previous.kill.mockImplementation(() => {
    if (throws) throw Error('synthetic kill failure');
    return false;
  });
  native.fork.mockReturnValue(previous);
  const host = createHost();
  await host.call({ op: 'status' });
  const pending = host.call({ op: 'devices' });
  const rejected = expect(pending).rejects.toThrow('尚未退出');
  await Promise.resolve();
  host.stop();
  await vi.advanceTimersByTimeAsync(10000);
  await rejected;
  const blocked = expect(host.call({ op: 'status' })).rejects.toThrow('尚未退出');
  await vi.advanceTimersByTimeAsync(10000);
  await blocked;
  expect(native.fork).toHaveBeenCalledTimes(1);
  previous.emit('exit', 0);
});
it('退休录音进程时先提交尾段，收到确认再释放，退出之前不会复用', async () => {
  const child = createChild();
  const original = child.postMessage.getMockImplementation()!;
  child.postMessage.mockImplementation(m => {
    if (m.call?.directory) queueMicrotask(() => child.emit('message', { id: m.id, value: { recording: true } }));
    else original(m);
  });
  native.fork.mockReturnValue(child);
  const host = createHost();
  await host.call({ op: 'recording', directory: 'synthetic' });
  child.emit('message', { event: { type: 'recording', active: false, draining: true, error: 'synthetic backlog' } });
  const finished = host.finishRecording();
  const request = child.postMessage.mock.calls.at(-1)![0];
  expect(request.call).toEqual({ op: 'recording' });
  expect(child.kill).not.toHaveBeenCalled();
  child.emit('message', { id: request.id });
  expect(child.kill).toHaveBeenCalledTimes(1);
  child.emit('exit', 0);
  await finished;
});
it('Qwen close RPC 失败仍退休进程并等待实际退出', async () => {
  const child = createChild();
  const post = child.postMessage.getMockImplementation()!;
  child.postMessage.mockImplementation((m: any) => {
    if (m.close) queueMicrotask(() => child.emit('message', { id: m.id, error: 'synthetic close failure' }));
    else post(m);
  });
  native.fork.mockReturnValue(child);
  const host = createHost('qwen');
  await host.call({ op: 'status' });
  const rejected = expect(host.close()).rejects.toThrow('synthetic close failure');
  await Promise.resolve();
  await Promise.resolve();
  expect(child.kill).toHaveBeenCalledTimes(1);
  child.emit('exit', 0);
  await rejected;
});
it.each(['switch-recognizer', 'set-input-state'] as const)('%s超时只取消切换，不杀掉继续采集的旧服务；迟到确认不复活请求', async (operation) => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    postMessage: vi.fn((m: any) => {
      if (m.init) queueMicrotask(() => child.emit('message', { id: m.id }));
      if (m.call?.op === 'status')
        queueMicrotask(() =>
          child.emit('message', { id: m.id, value: { state: 'running', model: 'old' } }),
        );
    }),
  });
  native.fork.mockReturnValue(child);
  const host = new SpeechHost(
    'synthetic-model',
    'synthetic-helper',
    () => {},
    'synthetic-process',
    'synthetic-qwen',
  );
  hosts.push(host);
  await host.call({ op: 'status' });
  const pending = host.call(operation === 'switch-recognizer' ? {
    op: 'switch-recognizer',
    options: { sources: ['system'], speechModel: 'qwen', inferenceDevice: 'metal' },
  } : { op: 'set-input-state', state: { inputMode: 'remote', microphoneMuted: true } });
  const rejection = expect(pending).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(operation === 'switch-recognizer' ? 310000 : 200000);
  await rejection;
  const stage = child.postMessage.mock.calls.find(([m]) => m.call?.op === operation)![0];
  expect(child.postMessage.mock.calls.at(-1)?.[0].call).toEqual({ op: operation === 'switch-recognizer' ? 'cancel-switch' : 'cancel-input-state' });
  expect(child.kill).not.toHaveBeenCalled();
  child.emit('message', { id: stage.id, value: { state: 'running', model: 'late' } });
  expect(await host.call({ op: 'status' })).toEqual({ state: 'running', model: 'old' });
});
