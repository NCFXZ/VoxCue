import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SpeechStatus } from '../../../shared/electron/contracts/speech';
const runtime = vi.hoisted(() => ({ mode: 'ready', workers: [] as any[] }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      constructor() {
        super();
        runtime.workers.push(this);
      }
      postMessage(message: any) {
        queueMicrotask(() => {
          if (message.op === 'close') this.emit('message', { closed: message.id });
          if (message.op === 'init') {
            if (runtime.mode === 'exit-loading') this.emit('exit', 1);
            else this.emit('message', { ready: true });
          }
          if (message.op === 'flush') {
            if (runtime.mode === 'exit-flushing') this.emit('exit', 1);
            else if (runtime.mode !== 'stall-flushing')
              this.emit('message', { flushed: message.id });
          }
          if (message.op === 'prepare') {
            if (runtime.mode === 'error-preparing')
              this.emit('message', { error: 'synthetic input preparation failure' });
            else if (runtime.mode !== 'stall-preparing')
              this.emit('message', { prepared: message.id });
          }
        });
      }
      async terminate() {
        this.emit('exit', 0);
        return 0;
      }
    },
  };
});
import { SpeechController, type CaptureAdapter } from '../../../shared/electron/backend/speech/controller';
import { SpeechCoordinator } from '../../electron/application/speech';
import { useInterview } from '../../src/stores/interview';
import { localHistory } from '../../src/services/history';
const controllers: SpeechController[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  runtime.mode = 'ready';
  runtime.workers = [];
});
afterEach(async () => {
  runtime.mode = 'ready';
  await vi.advanceTimersByTimeAsync(61000);
  await Promise.allSettled(controllers.splice(0).map((controller) => controller.close()));
  vi.useRealTimers();
});
function controller(start = async () => {}, stop = async () => {},
  create: CaptureAdapter['create'] = () => ({ start, stop })) {
  const instance = new SpeechController('model', 'helper', () => {}, {
    devices: async () => [{ id: 'mic', source: 'microphone', name: 'Synthetic', default: true }],
    create,
  });
  controllers.push(instance);
  return instance;
}
const begin = { op: 'start' as const, options: { sources: ['microphone' as const] } };
it.each(['dictation', 'audio-test'])('空闲后回收 %s 模型，连续听写复用 Worker', async kind => {
  const service = controller();
  const sessions = new SpeechCoordinator({ call: call => service.call(call), stop: () => {} });
  if (kind === 'audio-test') {
    await sessions.dictation({ op: 'test', id: 'audio-test', options: begin.options });
    await vi.advanceTimersByTimeAsync(10_000);
  } else {
    await sessions.dictation({ op: 'start' });
    await sessions.dictation({ op: 'stop' });
  }
  expect(sessions.busy).toBe(false);
  const retire = vi.spyOn(runtime.workers[0], 'terminate');
  await vi.advanceTimersByTimeAsync(29_999);
  expect(retire).not.toHaveBeenCalled();
  await sessions.dictation({ op: 'start' });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(retire).not.toHaveBeenCalled();
  expect(runtime.workers).toHaveLength(1);
  await sessions.dictation({ op: 'stop' });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(retire).toHaveBeenCalledOnce();
  await sessions.dictation({ op: 'start' });
  expect(runtime.workers).toHaveLength(2);
});
it.each(['inference', 'exit', 'capture-overflow'])('采集或识别失败后，结束面试仍归档为尾段可能不完整（%s）', async failure => {
  let overflow!: () => void;
  const service = controller(undefined, undefined, (_helper, _source, _device, _audio, fail, lost) => {
    overflow = () => { lost(); fail('synthetic capture overflow', false); };
    return { start: async () => {}, stop: async () => {} };
  });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', { desktop: { speech: service.call.bind(service) } });
  try {
    await service.call(begin);
    useInterview.setState({ mode: 'local', status: 'running', sessionId: crypto.randomUUID(),
      startedAt: Date.now(), transcriptTailIncomplete: false });
    if (failure === 'exit') runtime.workers[0].emit('exit', 1);
    else if (failure === 'capture-overflow') overflow();
    else runtime.workers[0].emit('message', { error: 'synthetic inference failure' });
    await vi.advanceTimersByTimeAsync(1);
    expect((await service.call({ op: 'status' })).state).toBe('error');
    await useInterview.getState().end({ generateTitle: false });
    expect(localHistory.list()[0]).toMatchObject({ status: 'interrupted', transcriptTailIncomplete: true });
    expect(await service.call({ op: 'stop' })).not.toHaveProperty('transcriptTailIncomplete');
    await service.call(begin);
    expect(await service.call({ op: 'stop' })).not.toHaveProperty('transcriptTailIncomplete');
  } finally {
    useInterview.getState().reset();
    vi.unstubAllGlobals();
  }
});
it('重新启动后的健康 ASR 不会清掉本次面试已丢失的尾段', async () => {
  const service = controller();
  await service.call(begin);
  runtime.workers[0].emit('exit', 1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await service.call(begin)).state).toBe('running');
  expect((await service.call({ op: 'stop' })).transcriptTailIncomplete).toBe(true);
  expect((await service.call({ op: 'stop' })).transcriptTailIncomplete).toBeUndefined();
});
it('ASR Worker 在初始化前退出时立即结束加载，允许重新启动，不等待 60 秒', async () => {
  runtime.mode = 'exit-loading';
  const service = controller();
  let completed: SpeechStatus | undefined;
  const pending = service.call(begin).then((value) => {
    completed = value;
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(completed).toMatchObject({ state: 'error' });
  await pending;
  runtime.mode = 'ready';
  expect(await service.call(begin)).toMatchObject({ state: 'running' });
});
it('prepares recognition inputs before opening capture, and can restart after a preparation failure', async () => {
  const start = vi.fn(async () => {});
  const service = controller(start);
  runtime.mode = 'error-preparing';
  const failed = service.call(begin);
  await vi.advanceTimersByTimeAsync(1);
  expect(await failed).toMatchObject({ state: 'error', error: 'synthetic input preparation failure' });
  expect(start).not.toHaveBeenCalled();
  runtime.mode = 'ready';
  expect(await service.call(begin)).toMatchObject({ state: 'running' });
  expect(start).toHaveBeenCalledTimes(1);
});
it('retires a stalled recognition worker without opening a capture device', async () => {
  const start = vi.fn(async () => {});
  const service = controller(start);
  runtime.mode = 'stall-preparing';
  const pending = service.call(begin);
  await vi.advanceTimersByTimeAsync(10001);
  expect(await pending).toMatchObject({
    state: 'error',
    error: expect.stringContaining('语音输入准备超时'),
  });
  expect(start).not.toHaveBeenCalled();
  runtime.mode = 'ready';
  expect(await service.call(begin)).toMatchObject({ state: 'running' });
});
it('启动失败且采集清理也抛错时仍退休 Worker、报告首个故障并允许重试', async () => {
  const start = vi
    .fn()
    .mockRejectedValueOnce(Error('synthetic device disconnected'))
    .mockResolvedValue(undefined);
  const stop = vi
    .fn()
    .mockRejectedValueOnce(Error('synthetic cleanup failed'))
    .mockResolvedValue(undefined);
  const service = controller(start, stop);
  await expect(service.call(begin)).resolves.toMatchObject({
    state: 'error',
    error: 'synthetic device disconnected',
    failureSource: 'microphone',
  });
  expect(await service.call(begin)).toMatchObject({ state: 'running' });
  expect(runtime.workers).toHaveLength(2);
});
it('启动失败时已交给旧 Worker 的音频不能计入下次启动的积压', async () => {
  let attempts = 0;
  const service = new SpeechController('model', 'helper', () => {}, {
    devices: async () => [{ id: 'mic', source: 'microphone', name: 'Synthetic', default: true }],
    create: (_helper, _source, _device, audio) => ({
      start: async () => {
        const first = ++attempts === 1;
        audio({
          samples: new Float32Array(first ? 32000 : 16),
          rate: 16000,
          timestamp: 0,
          flags: 0,
        });
        if (first) throw Error('synthetic startup loss after initial audio');
      },
      stop: async () => {},
    }),
  });
  controllers.push(service);
  expect(await service.call(begin)).toMatchObject({ state: 'error' });
  expect(await service.call(begin)).toMatchObject({ state: 'running' });
});
it('停止时 Worker 突然退出，尾段请求立即失败，不悬挂五秒或保留 running 状态', async () => {
  const service = controller();
  await service.call(begin);
  runtime.mode = 'exit-flushing';
  let failure: unknown;
  const pending = service.call({ op: 'stop' }).catch((error) => {
    failure = error;
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(failure).toBeInstanceOf(Error);
  await pending;
  expect(await service.call({ op: 'status' })).toMatchObject({ state: 'error' });
});

it.each(['paraformer', 'qwen'] as const)(
  '%s Worker报错后立即退休，重新开始不等待无法完成的尾段',
  async (speechModel) => {
    const service = controller();
    Object.assign(service, { qwenDirectory: 'synthetic-qwen' });
    const start = { ...begin, options: { ...begin.options, speechModel } };
    await service.call(start);
    runtime.mode = 'stall-flushing';
    const old = runtime.workers[0];
    old.emit('message', { error: 'synthetic inference failure' });
    const restarted = service.call(start);
    await vi.advanceTimersByTimeAsync(1);
    await expect(restarted).resolves.toMatchObject({ state: 'running' });
    expect(runtime.workers).toHaveLength(2);
  },
);

it('Worker error事件在已有尾段请求时立即拒绝并退休，不等待超时', async () => {
  const service = controller();
  await service.call(begin);
  runtime.mode = 'stall-flushing';
  const stopped = expect(service.call({ op: 'stop' })).rejects.toThrow('尾段无法处理');
  await vi.advanceTimersByTimeAsync(1);
  runtime.workers[0].emit('error', Error('synthetic worker failure'));
  await stopped;
  runtime.mode = 'ready';
  await expect(service.call(begin)).resolves.toMatchObject({ state: 'running' });
});
it('停止采集抛错仍清除旧回调与 Worker，下一次启动使用新实例', async () => {
  const stop = vi
    .fn()
    .mockRejectedValueOnce(Error('synthetic stop failed'))
    .mockResolvedValue(undefined);
  const service = controller(async () => {}, stop);
  await service.call(begin);
  await expect(service.call({ op: 'stop' })).rejects.toThrow();
  expect(await service.call({ op: 'status' })).toMatchObject({ state: 'error' });
  expect(await service.call(begin)).toMatchObject({ state: 'running' });
  expect(runtime.workers).toHaveLength(2);
});
it('尾段处理超时后状态为 error 并退休旧 Worker，恢复时重新加载', async () => {
  const service = controller();
  await service.call(begin);
  runtime.mode = 'stall-flushing';
  const pending = service.call({ op: 'stop' }).catch((error) => error);
  await vi.advanceTimersByTimeAsync(5001);
  expect(await pending).toBeInstanceOf(Error);
  expect(await service.call({ op: 'status' })).toMatchObject({ state: 'error' });
  runtime.mode = 'ready';
  expect(await service.call(begin)).toMatchObject({ state: 'running' });
  expect(runtime.workers).toHaveLength(2);
});
it('采集启动期间同步报错不能再广播 running，失败后可重新开始', async () => {
  const states: string[] = [];
  let failOnce = true;
  const service = new SpeechController(
    'model',
    'helper',
    (event) => {
      if (event.type === 'status') states.push(event.status.state);
    },
    {
      devices: async () => [{ id: 'mic', source: 'microphone', name: 'Synthetic', default: true }],
      create: (_helper, _source, _device, _audio, failure) => ({
        start: async () => {
          if (failOnce) {
            failOnce = false;
            failure('synthetic startup loss');
          }
        },
        stop: async () => {},
      }),
    },
  );
  controllers.push(service);
  expect(await service.call(begin)).toMatchObject({ state: 'error', failureSource: 'microphone' });
  expect(states).not.toContain('running');
  await vi.advanceTimersByTimeAsync(1);
  expect(await service.call(begin)).toMatchObject({ state: 'running' });
});
