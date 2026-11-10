import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AudioPacket } from '../../electron/backend/speech/buffer';
import type {
  AudioSource,
  InterviewInputState,
  SpeechEvent,
} from '../../electron/contracts/speech';

const runtime = vi.hoisted(() => ({
  workers: [] as any[],
  messages: [] as any[],
  acknowledge: true,
}));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      constructor() {
        super();
        runtime.workers.push(this);
      }
      postMessage(message: any) {
        runtime.messages.push(message);
        queueMicrotask(() => {
          if (message.op === 'init') this.emit('message', { ready: true });
          if (message.op === 'prepare') this.emit('message', { prepared: message.id });
          if (message.op === 'flush') this.emit('message', { flushed: message.id });
          if (message.op === 'close') this.emit('message', { closed: message.id });
          if (message.op === 'set-input-state' && runtime.acknowledge)
            this.emit('message', { inputSet: message.id });
        });
      }
      async terminate() {
        this.emit('exit');
        return 0;
      }
    },
  };
});
import { SpeechController } from '../../electron/backend/speech/controller';

type Capture = {
  audio(packet: AudioPacket): void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};
let controller: SpeechController;
let events: SpeechEvent[];
const captures = new Map<AudioSource, Capture>();
const remote: InterviewInputState = { inputMode: 'remote', microphoneMuted: false };
const transcription: InterviewInputState = { inputMode: 'transcription', microphoneMuted: false };
const packet = () => ({ samples: new Float32Array(1600), rate: 16000, timestamp: 0, flags: 0 });
const turn = () => Promise.resolve().then(() => Promise.resolve());
async function start(state = remote, sources: AudioSource[] = ['microphone', 'system']) {
  return controller.call({
    op: 'start',
    inputState: state,
    options: { sources, microphone: 'microphone', system: 'system' },
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  runtime.workers = [];
  runtime.messages = [];
  runtime.acknowledge = true;
  captures.clear();
  events = [];
  controller = new SpeechController(
    'synthetic-model',
    'synthetic-helper',
    (event) => events.push(event),
    {
      devices: async () =>
        ['microphone', 'system'].map((source) => ({
          id: source,
          name: source,
          source: source as AudioSource,
          default: true,
        })),
      create: (_helper, source, _device, audio) => {
        const capture = { audio, start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
        captures.set(source, capture);
        return capture;
      },
    },
  );
});
afterEach(async () => {
  runtime.acknowledge = true;
  await controller.close();
  vi.useRealTimers();
});

it('软静音保留采集与模型，立即挡住迟到麦克风文本，系统音频与进度不受影响', async () => {
  await start();
  const microphone = captures.get('microphone')!,
    system = captures.get('system')!;
  const worker = runtime.workers[0];
  runtime.acknowledge = false;
  const pending = controller.call({
    op: 'set-input-state',
    state: { ...remote, microphoneMuted: true },
  });
  const change = runtime.messages.find((m) => m.op === 'set-input-state');
  worker.emit('message', {
    event: {
      type: 'segment',
      segment: {
        id: 'late',
        source: 'microphone',
        final: true,
        text: 'private tail',
        startMs: 0,
        endMs: 100,
      },
    },
  });
  worker.emit('message', { event: { type: 'speech-start', source: 'system' } });
  microphone.audio(packet());
  system.audio(packet());
  expect(events.some((event) => event.type === 'segment')).toBe(false);
  expect(events).toContainEqual({ type: 'speech-start', source: 'system' });
  expect(runtime.messages.filter((m) => m.op === 'audio').map((m) => m.source)).toEqual(['system']);
  worker.emit('message', { inputSet: change.id });
  await expect(pending).resolves.toMatchObject({
    state: 'running',
    inputState: { ...remote, microphoneMuted: true },
  });
  const count = events.length;
  microphone.audio(packet());
  await vi.advanceTimersByTimeAsync(2000);
  expect(events).toHaveLength(count);
  for (let i = 1; i <= 40; i++) {
    microphone.audio(packet());
    system.audio(packet());
    const frame = runtime.messages.filter((m) => m.op === 'audio').at(-1);
    worker.emit('message', { ack: frame.sequence, progress: { system: i * 100 } });
  }
  expect(
    events.filter((event) => event.type === 'audio-progress' && event.source === 'system').at(-1),
  ).toMatchObject({ pending: true, processedThroughMs: 4000 });
  // The single packet deliberately left outstanding before the mute still
  // counts; all newer packets are acknowledged without growing the queue.
  expect((controller as any).pendingAudio.size).toBe(1);
  expect((controller as any).queued).toBe(100);
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  expect(microphone.stop).not.toHaveBeenCalled();
  expect(system.stop).not.toHaveBeenCalled();
  expect(microphone.start).toHaveBeenCalledOnce();
  runtime.acknowledge = true;
  await controller.call({ op: 'set-input-state', state: remote });
  microphone.audio(packet());
  expect(
    runtime.messages.filter((m) => m.op === 'audio' && m.source === 'microphone'),
  ).toHaveLength(1);
  expect(runtime.workers).toHaveLength(1);
  expect(runtime.messages.filter((m) => m.op === 'init')).toHaveLength(1);
  expect(runtime.messages.filter((m) => m.op === 'flush')).toHaveLength(0);
  expect(microphone.start).toHaveBeenCalledOnce();
});

it('仅转录切到远程只补开系统采集，返回仅转录屏蔽系统但保留两条连接', async () => {
  await start(transcription, ['microphone']);
  const microphone = captures.get('microphone')!;
  await controller.call({ op: 'set-input-state', state: remote });
  const system = captures.get('system')!;
  expect(microphone.start).toHaveBeenCalledOnce();
  expect(system.start).toHaveBeenCalledOnce();
  await controller.call({ op: 'set-input-state', state: transcription });
  runtime.messages = [];
  system.audio(packet());
  microphone.audio(packet());
  expect(runtime.messages.filter((m) => m.op === 'audio').map((m) => m.source)).toEqual([
    'microphone',
  ]);
  expect(system.stop).not.toHaveBeenCalled();
  expect(microphone.stop).not.toHaveBeenCalled();
  expect(runtime.workers).toHaveLength(1);
});

it('system gate blocks only its lane before ACK and resumes using the same captures and model', async () => {
  await start();
  const microphone = captures.get('microphone')!,
    system = captures.get('system')!;
  runtime.acknowledge = false;
  const muted = { ...remote, systemAudioMuted: true };
  const changing = controller.call({ op: 'set-input-state', state: muted });
  const change = runtime.messages.find((message) => message.op === 'set-input-state');
  expect(change.changed).toEqual(['system']);
  runtime.workers[0].emit('message', { event: { type: 'speech-start', source: 'system' } });
  runtime.workers[0].emit('message', { event: { type: 'speech-start', source: 'microphone' } });
  system.audio(packet());
  microphone.audio(packet());
  expect(events.some((event) => 'source' in event && event.source === 'system')).toBe(false);
  expect(events).toContainEqual({ type: 'speech-start', source: 'microphone' });
  expect(
    runtime.messages.filter((message) => message.op === 'audio').map((message) => message.source),
  ).toEqual(['microphone']);
  runtime.workers[0].emit('message', { inputSet: change.id });
  await expect(changing).resolves.toMatchObject({ inputState: muted, state: 'running' });
  system.audio(packet());
  expect(
    runtime.messages.filter((message) => message.op === 'audio' && message.source === 'system'),
  ).toHaveLength(0);
  runtime.acknowledge = true;
  await controller.call({ op: 'set-input-state', state: { ...remote, systemAudioMuted: false } });
  system.audio(packet());
  expect(
    runtime.messages.filter((message) => message.op === 'audio' && message.source === 'system'),
  ).toHaveLength(1);
  expect(runtime.workers).toHaveLength(1);
  expect(
    runtime.messages.filter((message) => ['flush', 'close'].includes(message.op)),
  ).toHaveLength(0);
  expect(system.start).toHaveBeenCalledOnce();
  expect(microphone.start).toHaveBeenCalledOnce();
  expect(system.stop).not.toHaveBeenCalled();
  expect(microphone.stop).not.toHaveBeenCalled();
});

it('暂停期间改输入状态只改逻辑，不自动恢复采集；恢复使用已确认状态', async () => {
  await start(transcription, ['microphone']);
  const microphone = captures.get('microphone')!;
  await controller.call({ op: 'pause' });
  await expect(controller.call({ op: 'set-input-state', state: remote })).resolves.toMatchObject({
    state: 'paused',
    inputState: remote,
  });
  expect(captures.has('system')).toBe(false);
  expect(microphone.start).toHaveBeenCalledOnce();
  expect(microphone.stop).toHaveBeenCalledOnce();
  await start(remote);
  expect(captures.get('system')!.start).toHaveBeenCalledOnce();
});

it('暂停立即取消输入切换，回滚屏蔽边界；迟到确认不能改变已暂停状态', async () => {
  await start();
  runtime.acknowledge = false;
  const pending = controller.call({
    op: 'set-input-state',
    state: { ...remote, microphoneMuted: true },
  });
  const rejected = expect(pending).rejects.toThrow('取消');
  const original = runtime.messages.find((m) => m.op === 'set-input-state');
  const pause = controller.call({ op: 'pause' });
  const rollback = runtime.messages.filter((m) => m.op === 'set-input-state').at(-1);
  expect(rollback.state).toEqual(remote);
  runtime.workers[0].emit('message', { inputSet: rollback.id });
  await rejected;
  await pause;
  runtime.workers[0].emit('message', { inputSet: original.id });
  expect(await controller.call({ op: 'status' })).toMatchObject({
    state: 'paused',
    inputState: remote,
  });
});

it('新增源启动期间被取消会停止该新增连接，迟到启动不再发布或留下采集', async () => {
  await start(transcription, ['microphone']);
  const adapter = (controller as any).adapter;
  const create = adapter.create;
  let finish!: () => void;
  adapter.create = (...args: any[]) => {
    const capture = create(...args);
    if (args[1] === 'system')
      capture.start.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
    return capture;
  };
  const pending = controller.call({ op: 'set-input-state', state: remote });
  const rejected = expect(pending).rejects.toThrow('取消');
  await turn();
  const system = captures.get('system')!;
  await controller.call({ op: 'pause' });
  await rejected;
  expect(system.stop).toHaveBeenCalledOnce();
  finish();
  await turn();
  expect(await controller.call({ op: 'status' })).toMatchObject({
    state: 'paused',
    inputState: transcription,
  });
  expect((controller as any).captures.size).toBe(0);
});

it('拒绝非法状态及并发切换，不触碰采集或启动另一个模型', async () => {
  await start();
  const count = runtime.messages.length;
  for (const state of [
    null,
    {},
    { inputMode: 'speaker', microphoneMuted: false },
    { ...remote, microphoneMuted: 1 },
    { ...remote, path: 'arbitrary' },
  ])
    await expect(controller.call({ op: 'set-input-state', state } as any)).rejects.toThrow(
      'Invalid',
    );
  expect(runtime.messages).toHaveLength(count);
  runtime.acknowledge = false;
  const pending = controller.call({ op: 'set-input-state', state: transcription });
  await expect(controller.call({ op: 'set-input-state', state: remote })).rejects.toThrow(
    '正在切换',
  );
  await expect(
    controller.call({ op: 'switch-recognizer', options: { sources: ['microphone', 'system'] } }),
  ).rejects.toThrow();
  runtime.workers[0].emit('message', { inputSet: runtime.messages.at(-1).id });
  await pending;
});
