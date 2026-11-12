import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SpeechEvent } from '../../electron/contracts/speech';
const runtime = vi.hoisted(() => ({
  workers: [] as any[],
  initialization: undefined as undefined | Promise<void>,
  retirement: undefined as undefined | Promise<void>,
}));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      retired = false;
      constructor() {
        super();
        runtime.workers.push(this);
      }
      postMessage(message: any) {
        void Promise.resolve().then(async () => {
          if (message.op === 'init') {
            await runtime.initialization;
            this.emit('message', { ready: true });
          }
          if (message.op === 'prepare') this.emit('message', { prepared: message.id });
          if (message.op === 'flush') this.emit('message', { flushed: message.id });
          if (message.op === 'close') this.emit('message', { closed: message.id });
          if (message.op === 'audio') this.emit('message', { ack: message.sequence });
        });
      }
      async terminate() {
        await runtime.retirement;
        this.retired = true;
        this.emit('exit', 0);
        return 0;
      }
    },
  };
});
import { SpeechController } from '../../electron/backend/speech/controller';

const controllers: SpeechController[] = [];
const begin = { op: 'start' as const, options: { sources: ['system' as const], system: 'owned' } };
beforeEach(() => {
  vi.useFakeTimers();
  runtime.workers = [];
  runtime.initialization = undefined;
  runtime.retirement = undefined;
});
afterEach(async () => {
  runtime.initialization = undefined;
  runtime.retirement = undefined;
  await Promise.allSettled(controllers.splice(0).map((controller) => controller.close()));
  vi.useRealTimers();
});
function gate() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
}
function fixture(automaticRestart = true, receive?: (event: SpeechEvent) => void) {
  const events: SpeechEvent[] = [];
  const captures: Array<{
    fail(message: string, recoverable?: boolean): void;
    audio: (packet: any) => void;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const devices = vi.fn(async () => [
    { id: 'owned', source: 'system' as const, name: 'Synthetic', default: true },
  ]);
  const start = vi.fn(async () => {});
  const service = new SpeechController(
    'model',
    'helper',
    (event) => {
      events.push(event);
      receive?.(event);
    },
    {
      automaticRestart,
      drainBeforeRetire: true,
      devices,
      create: (_helper, _source, _device, audio, fail) => {
        const capture = { start, fail, audio, stop: vi.fn(async () => {}) };
        captures.push(capture);
        return capture;
      },
    },
  );
  controllers.push(service);
  return { service, captures, events, devices, start };
}

it('waits for actual capture stop and recognizer retirement before delaying and restarting', async () => {
  const f = fixture();
  await f.service.call(begin);
  const captureStop = gate(),
    workerStop = gate();
  f.captures[0].stop.mockImplementationOnce(() => captureStop.pending);
  runtime.retirement = workerStop.pending;
  f.captures[0].fail('synthetic pipe failure', true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(1);
  expect(runtime.workers).toHaveLength(1);
  captureStop.release();
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(1);
  workerStop.release();
  await vi.advanceTimersByTimeAsync(999);
  expect(f.captures).toHaveLength(1);
  expect(runtime.workers[0].retired).toBe(true);
  expect(await f.service.call({ op: 'status' })).toMatchObject({
    state: 'error',
    error: '音频已中断，正在自动重新连接…',
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(f.captures).toHaveLength(2);
  expect(await f.service.call({ op: 'status' })).toMatchObject({ state: 'running' });
});

it.each(['stop', 'pause', 'close'] as const)(
  'a manual %s cancels a scheduled restart',
  async (operation) => {
    const f = fixture();
    await f.service.call(begin);
    f.captures[0].fail('synthetic process exit', true);
    await vi.advanceTimersByTimeAsync(0);
    if (operation === 'close') await f.service.close();
    else await f.service.call({ op: operation });
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.captures).toHaveLength(1);
    expect((await f.service.call({ op: 'status' })).state).toBe(
      operation === 'pause' ? 'paused' : 'idle',
    );
  },
);

it('a manual stop while a replacement initializes prevents any new capture and ignores late readiness', async () => {
  const f = fixture();
  await f.service.call(begin);
  f.captures[0].fail('synthetic process exit', true);
  await vi.advanceTimersByTimeAsync(0);
  const initializing = gate();
  runtime.initialization = initializing.pending;
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.workers).toHaveLength(2);
  const stopping = f.service.call({ op: 'stop' });
  await stopping;
  expect(vi.getTimerCount()).toBe(0);
  initializing.release();
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(1);
  expect(runtime.workers[1].retired).toBe(true);
  expect(await f.service.call({ op: 'status' })).toMatchObject({ state: 'idle' });
});

it('does not restart on unclassified permission/device errors, model errors or initial capture failure', async () => {
  const f = fixture();
  await f.service.call(begin);
  f.captures[0].fail('synthetic permission denied');
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(1);
  await f.service.call(begin);
  runtime.workers.at(-1).emit('message', { error: 'synthetic model/configuration failure' });
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(2);
  f.start.mockRejectedValueOnce(Error('synthetic startup failure'));
  expect(await f.service.call(begin)).toMatchObject({
    state: 'error',
    error: 'synthetic startup failure',
  });
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(3);
});

it('never replaces a capture whose stop failed or whose close is unconfirmed', async () => {
  const f = fixture();
  await f.service.call(begin);
  f.captures[0].stop.mockRejectedValueOnce(Error('synthetic close unconfirmed'));
  f.captures[0].fail('synthetic pipe failure', true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(1);
  expect(await f.service.call({ op: 'status' })).toMatchObject({ state: 'error' });
});

it('uses 1/2/4 second delays, stops after three attempts, and does not reset for a brief successful open', async () => {
  const f = fixture();
  await f.service.call(begin);
  for (const delay of [1000, 2000, 4000]) {
    const previous = f.captures.length;
    f.captures.at(-1)!.fail('synthetic repeated exit', true);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(f.captures).toHaveLength(previous);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.captures).toHaveLength(previous + 1);
  }
  f.captures.at(-1)!.fail('synthetic persistent exit', true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.captures).toHaveLength(4);
  expect(await f.service.call({ op: 'status' })).toMatchObject({
    state: 'error',
    error: expect.stringContaining('重试上限'),
  });
});

it('publishes a terminal interview notice after rapid recovery exhaustion without a healthy frame', async () => {
  const { useInterview } = await import('../../src/stores/interview');
  let receive: (event: SpeechEvent) => void = () => {};
  const f = fixture(true, (event) => receive(event));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('window', {
    desktop: {
      speech: (call: Parameters<SpeechController['call']>[0]) => f.service.call(call),
      onSpeechEvent: (callback: typeof receive) => {
        receive = callback;
        return () => {
          receive = () => {};
        };
      },
    },
  });
  try {
    useInterview.getState().reset();
    useInterview.setState({ configurationLocked: false });
    useInterview.getState().configure({
      mode: 'local',
      aiEnabled: false,
      options: begin.options,
    });
    useInterview.getState().start();
    await vi.advanceTimersByTimeAsync(0);
    expect(useInterview.getState().status).toBe('running');
    for (const delay of [1000, 2000, 4000]) {
      f.captures.at(-1)!.fail('synthetic rapid exit', true);
      await vi.advanceTimersByTimeAsync(0);
      expect(useInterview.getState().speechError).toBe('音频已中断，正在自动重新连接…');
      expect(useInterview.getState().speechWarnings.system).toBe(
        '音频发生中断，不完整片段不会自动用于回答。',
      );
      await vi.advanceTimersByTimeAsync(delay);
    }
    f.captures.at(-1)!.fail('synthetic persistent exit', true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.captures).toHaveLength(4);
    expect(useInterview.getState()).toMatchObject({
      status: 'paused',
      speechError: '音频自动恢复已达到重试上限，请检查设备或模型后重新连接。',
      speechWarnings: { system: '音频发生中断，不完整片段不会自动用于回答。' },
    });
    expect(Object.values(useInterview.getState().speechWarnings).join(' ')).not.toContain(
      '正在自动重新连接',
    );
    expect(useInterview.getState().audioLevels).toEqual({});
    expect(
      f.events.filter((event) => event.type === 'activity' || event.type === 'segment'),
    ).toEqual([]);
  } finally {
    useInterview.getState().reset();
    useInterview.setState({ configurationLocked: false });
    useInterview.getState().configure({ mode: 'mock' });
    vi.unstubAllGlobals();
  }
});

it('replenishes the retry budget only after stable running', async () => {
  const f = fixture();
  await f.service.call(begin);
  for (let count = 0; count < 3; count++) {
    f.captures.at(-1)!.fail('synthetic exit', true);
    await vi.advanceTimersByTimeAsync(1000 * 2 ** count);
  }
  await vi.advanceTimersByTimeAsync(30000);
  f.captures
    .at(-1)!
    .audio({ samples: new Float32Array(160), rate: 16000, timestamp: 30000, flags: 0 });
  await vi.advanceTimersByTimeAsync(0);
  f.captures.at(-1)!.fail('synthetic isolated later exit', true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.captures).toHaveLength(5);
  expect(await f.service.call({ op: 'status' })).toMatchObject({ state: 'running' });
});

it('reports a device lookup failure during recovery as a terminal error', async () => {
  const f = fixture();
  await f.service.call(begin);
  f.captures[0].fail('synthetic process exit', true);
  f.devices.mockRejectedValueOnce(Error('synthetic device unavailable'));
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(1);
  expect(await f.service.call({ op: 'status' })).toMatchObject({
    state: 'error',
    error: 'synthetic device unavailable',
  });
});

it.each(['waiting', 'initializing'] as const)(
  'rejected input/model changes during %s recovery leave its valid owner running',
  async (phase) => {
    const f = fixture();
    await f.service.call(begin);
    f.captures[0].fail('synthetic exit', true);
    await vi.advanceTimersByTimeAsync(0);
    const initializing = gate();
    if (phase === 'initializing') {
      runtime.initialization = initializing.pending;
      await vi.advanceTimersByTimeAsync(1000);
    }
    await expect(
      f.service.call({
        op: 'set-input-state',
        state: { inputMode: 'remote', microphoneMuted: true },
      }),
    ).rejects.toThrow();
    await expect(
      f.service.call({ op: 'switch-recognizer', options: begin.options }),
    ).rejects.toThrow();
    await f.service.call({ op: 'cancel-input-state' });
    await f.service.call({ op: 'cancel-switch' });
    initializing.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.captures).toHaveLength(2);
    expect(await f.service.call({ op: 'status' })).toMatchObject({ state: 'running' });
  },
);

it('a wall-clock jump cannot replenish a repeatedly failing recovery budget', async () => {
  const f = fixture();
  await f.service.call(begin);
  for (let count = 0; count < 3; count++) {
    f.captures.at(-1)!.fail('synthetic exit', true);
    await vi.advanceTimersByTimeAsync(1000 * 2 ** count);
  }
  vi.setSystemTime(Date.now() + 600000);
  f.captures.at(-1)!.audio({ samples: new Float32Array(160), rate: 16000, timestamp: 0, flags: 0 });
  await vi.advanceTimersByTimeAsync(0);
  f.captures.at(-1)!.fail('synthetic repeated exit', true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(4);
  expect(await f.service.call({ op: 'status' })).toMatchObject({
    state: 'error',
    error: expect.stringContaining('重试上限'),
  });
});

it('stops an automatic capture startup without waiting for its ready promise', async () => {
  const f = fixture();
  await f.service.call(begin);
  const starting = gate();
  f.start.mockImplementationOnce(() => starting.pending);
  f.captures[0].fail('synthetic exit', true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.captures).toHaveLength(2);
  await f.service.call({ op: 'stop' });
  expect(f.captures[1].stop).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  starting.release();
  await vi.advanceTimersByTimeAsync(10000);
  expect(await f.service.call({ op: 'status' })).toMatchObject({ state: 'idle' });
  expect(f.captures).toHaveLength(2);
});

it('keeps platforms without the explicit adapter policy on manual recovery', async () => {
  const f = fixture(false);
  await f.service.call(begin);
  f.captures[0].fail('synthetic process exit', true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(1);
});

it('ignores retired capture callbacks after an explicit replacement', async () => {
  const f = fixture();
  await f.service.call(begin);
  const old = f.captures[0];
  old.fail('synthetic exit', true);
  await vi.advanceTimersByTimeAsync(0);
  await f.service.call(begin);
  old.fail('late old process error', true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.captures).toHaveLength(2);
  expect(await f.service.call({ op: 'status' })).toMatchObject({ state: 'running' });
});
