import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ captures: [] as any[], workers: [] as any[] }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      messages: any[] = [];
      constructor() {
        super();
        state.workers.push(this);
      }
      postMessage(message: any) {
        this.messages.push(message);
        queueMicrotask(() => {
          if (message.op === 'init') this.emit('message', { ready: true });
          if (message.op === 'prepare') this.emit('message', { prepared: message.id });
          if (message.op === 'flush') this.emit('message', { flushed: message.id });
          if (message.op === 'close') this.emit('message', { closed: message.id });
          if (message.op === 'audio')
            this.emit('message', { ack: message.sequence, ms: message.ms });
        });
      }
      async terminate() {
        this.emit('exit');
        return 0;
      }
    },
  };
});
vi.mock('../../../windows/electron/speech/capture', () => ({
  devices: async () => [
    { id: 'system', source: 'system' },
    { id: 'microphone', source: 'microphone' },
  ],
  WasapiCapture: class {
    constructor(
      _helper: string,
      public source: string,
      _device: string,
      public packet: (p: any) => void,
      public failure: (message: string, recoverable?: boolean) => void,
    ) {
      state.captures.push(this);
    }
    async start() {}
    async stop() {}
  },
}));
import { SpeechController } from '../../../windows/electron/speech/controller';
import type { SpeechEvent } from '../../../shared/electron/contracts/speech';
const controllers: SpeechController[] = [];
beforeEach(() => {
  state.captures.length = 0;
  state.workers.length = 0;
});
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.close();
  vi.useRealTimers();
});
function controller() {
  const events: SpeechEvent[] = [];
  const service = new SpeechController('test-model', 'test-helper', (event) => events.push(event));
  controllers.push(service);
  return { service, events };
}
const packet = (flags = 0) => ({
  samples: new Float32Array(160),
  rate: 16000,
  flags,
  timestamp: Date.now(),
});
it('单次音频间断划分识别边界且继续采集，持续故障明确停止', async () => {
  const { service, events } = controller();
  await service.call({ op: 'start', options: { sources: ['system'] } });
  state.captures[0].packet(packet());
  state.captures[0].packet(packet(1));
  state.captures[0].packet(packet());
  expect((await service.call({ op: 'status' })).state).toBe('running');
  expect(events.filter((event) => event.type === 'gap')).toHaveLength(1);
  expect(
    state.workers[0].messages
      .filter((m: any) => ['audio', 'gap'].includes(m.op))
      .map((m: any) => m.op),
  ).toEqual(['audio', 'gap', 'audio', 'audio']);
  for (let i = 0; i < 4; ++i) state.captures[0].packet(packet(1));
  await service.call({ op: 'status' });
  expect(
    events.some((event) => event.type === 'status' && event.status.error?.includes('五次')),
  ).toBe(true);
});
it('关闭和重开重置时间锚点及间断计数，旧采集回调不能破坏新采集', async () => {
  const { service, events } = controller();
  await service.call({ op: 'start', options: { sources: ['system'] } });
  const old = state.captures[0];
  for (let i = 0; i < 4; ++i) old.packet(packet(1));
  await service.call({ op: 'pause' });
  await service.call({ op: 'start', options: { sources: ['system'] } });
  const count = events.length;
  old.packet(packet(1));
  old.failure('旧采集迟到错误');
  expect(events).toHaveLength(count);
  state.captures[1].packet(packet(1));
  expect((await service.call({ op: 'status' })).state).toBe('running');
  expect(events.some((event) => event.type === 'status' && event.status.state === 'error')).toBe(
    false,
  );
});
it('故障退出的旧 Worker 迟到错误不能停止新 Worker', async () => {
  const { service, events } = controller();
  await service.call({ op: 'start', options: { sources: ['system'] } });
  const old = state.workers[0];
  await old.terminate();
  await service.call({ op: 'status' });
  await service.call({ op: 'start', options: { sources: ['system'] } });
  const count = events.length;
  old.emit('error', Error('old worker error'));
  expect(events).toHaveLength(count);
  expect((await service.call({ op: 'status' })).state).toBe('running');
});

it('does not replace an unretired WASAPI capture on manual reconnect', async () => {
  const { service } = controller();
  const start = () => service.call({ op: 'start', options: { sources: ['system'] } });
  await start();
  const old = state.captures[0];
  old.stop = async () => {
    old.retiring = true;
    throw Error('Unconfirmed close');
  };
  await expect(service.call({ op: 'stop' })).rejects.toThrow('未能正常停止');
  expect(await start()).toMatchObject({ state: 'error', error: expect.stringContaining('尚未退出') });
  expect(state.captures).toEqual([old]);
  old.retiring = false;
  expect(await start()).toMatchObject({ state: 'running' });
  expect(state.captures).toHaveLength(2);
});

it('retires both Windows inputs and the old Worker before rebuilding either input on 1/2/4s backoff', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const { service, events } = controller();
  const options = { sources: ['system', 'microphone'] as ('system' | 'microphone')[] };
  await service.call({ op: 'start', options });
  const [system, mic] = state.captures;
  let microphoneClosed!: () => void, workerExited!: () => void;
  mic.stop = () => new Promise<void>(resolve => { microphoneClosed = resolve; });
  const oldWorker = state.workers[0];
  oldWorker.terminate = () => new Promise<number>(resolve => {
    workerExited = () => { oldWorker.emit('exit', 0); resolve(0); };
  });
  system.failure('synthetic endpoint invalidated', true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(state.captures).toHaveLength(2);
  expect(state.workers).toHaveLength(1);
  microphoneClosed();
  await vi.advanceTimersByTimeAsync(10000);
  expect(state.captures).toHaveLength(2);
  expect(state.workers).toHaveLength(1);
  workerExited();
  for (const [index, delay] of [1000, 2000, 4000].entries()) {
    if (index) state.captures.at(-1).failure('synthetic endpoint invalidated', true);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(state.captures).toHaveLength((index + 1) * 2);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.captures.slice(-2).map(capture => capture.source)).toEqual(options.sources);
    expect(state.captures).toHaveLength((index + 2) * 2);
    expect(state.workers).toHaveLength(index + 2);
  }
  const count = events.length;
  system.failure('late', true);
  oldWorker.emit('error', Error('late'));
  oldWorker.emit('message', { ack: 12345 });
  expect(events).toHaveLength(count);
  state.captures.at(-1).failure('synthetic endpoint invalidated', true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(state.captures).toHaveLength(8);
  expect(await service.call({ op: 'status' })).toMatchObject({
    state: 'error', error: expect.stringContaining('重试上限'),
  });
});

it('uses the shared QPC across delayed helper startup and drains capture packets before Worker flush', async () => {
  const { service } = controller();
  await service.call({ op: 'start', options: { sources: ['system', 'microphone'] } });
  const worker = state.workers[0];
  expect(worker.messages.find((m: any) => m.op === 'init').preprocessorFile).toMatch(
    /[\\/]windows[\\/]electron[\\/]speech[\\/]echoCancellation\.js$/,
  );
  expect(worker.messages.find((m: any) => m.op === 'prepare').sources).toEqual([
    'system',
    'microphone',
  ]);
  const [system, mic] = state.captures;
  system.packet({ ...packet(), timestamp: 123456.25 });
  mic.packet({ ...packet(), timestamp: 123481.25 });
  mic.stop = async () => mic.packet({ ...packet(), timestamp: 123491.25 });
  await service.call({ op: 'pause' });
  const audio = worker.messages.filter((m: any) => m.op === 'audio');
  expect(audio.map((m: any) => m.captureClock)).toEqual([123456.25, 123481.25, 123491.25]);
  expect(worker.messages.at(-1).op).toBe('flush');
  const count = audio.length;
  mic.packet(packet());
  expect(worker.messages.filter((m: any) => m.op === 'audio')).toHaveLength(count);
});

it('does not anchor transcript time to an invalid first WASAPI timestamp', async () => {
  const { service } = controller();
  await service.call({ op: 'start', options: { sources: ['microphone'] } });
  const before = Date.now();
  state.captures[0].packet({ ...packet(4), timestamp: 0 });
  state.captures[0].packet({ ...packet(), timestamp: 987654321 });
  state.captures[0].packet({ ...packet(), timestamp: 987654331 });
  const audio = state.workers[0].messages.filter((m: any) => m.op === 'audio');
  expect(audio.map((m: any) => m.captureClock)).toEqual([undefined, 987654321, 987654331]);
  expect(audio.every((m: any) => m.timestamp >= before && m.timestamp <= Date.now() + 10)).toBe(
    true,
  );
});
