import { beforeEach, expect, it, vi } from 'vitest';
import type {
  AudioSource,
  InterviewInputState,
  SpeechEvent,
} from '../../electron/contracts/speech';

const runtime = vi.hoisted(() => ({
  listeners: new Map<string, Array<(value?: any) => void>>(),
  messages: [] as any[],
  emit: (_event: SpeechEvent) => {},
  feed: vi.fn(
    async (_source: AudioSource, _samples: Float32Array, _rate: number, _timestamp: number) => {},
  ),
  inputSources: vi.fn(async (_sources: AudioSource[], _changed: AudioSource[]) => {}),
  close: vi.fn(async () => {}),
}));
vi.mock('node:worker_threads', () => ({
  parentPort: {
    on: (name: string, callback: (value?: any) => void) => {
      runtime.listeners.set(name, [...(runtime.listeners.get(name) ?? []), callback]);
    },
    postMessage: (message: any) => runtime.messages.push(message),
  },
}));
vi.mock('../../electron/backend/speech/recognizer', () => ({ Recognizer: { load: vi.fn() } }));
vi.mock('../../electron/backend/speech/recognition', () => ({
  RecognitionRouter: class {
    metadata = {};
    audioMs = 0;
    inferenceMs = 0;
    constructor(_factory: unknown, emit: typeof runtime.emit) {
      runtime.emit = emit;
    }
    initialize = async () => {};
    prepare = () => {};
    feed = runtime.feed;
    inputSources = runtime.inputSources;
    close = runtime.close;
    processedThrough = () => undefined;
  },
}));

const remote: InterviewInputState = { inputMode: 'remote', microphoneMuted: false };
const send = (message: object) => runtime.listeners.get('message')![0](message);
const drain = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const audio = (source: AudioSource, sequence: number, value = sequence) =>
  send({
    op: 'audio',
    source,
    sequence,
    rate: 16000,
    timestamp: sequence * 100,
    samples: new Float32Array(1600).fill(value),
    ms: 100,
  });
const input = (id: number, state: InterviewInputState, changed: AudioSource[] = ['microphone']) =>
  send({ op: 'set-input-state', id, state, changed });
beforeEach(async () => {
  vi.resetModules();
  runtime.listeners.clear();
  runtime.messages = [];
  runtime.feed.mockReset().mockResolvedValue();
  runtime.inputSources.mockReset().mockResolvedValue();
  runtime.close.mockReset().mockResolvedValue();
  await import('../../electron/backend/speech/worker');
  send({ op: 'init', sources: ['microphone', 'system'] });
  send({ op: 'prepare', id: 1, sources: ['microphone', 'system'], inputState: remote });
  await drain();
});

it('failed Worker rejects a later flush immediately instead of ignoring the request', async () => {
  runtime.feed.mockRejectedValueOnce(Error('synthetic inference failure'));
  audio('system', 2);
  await drain();
  expect(runtime.close).toHaveBeenCalled();
  runtime.messages = [];
  send({ op: 'flush', id: 3, reason: 'stop' });
  await drain();
  expect(runtime.messages).toEqual([
    { error: '语音服务已失败，尾段无法处理；请重新开始。' },
  ]);
});

it('麦克风mute边界挡住正在推理与已排队的旧文本，丢弃缓存后才ACK且系统仍可转写', async () => {
  let finish!: () => void;
  runtime.feed.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  audio('microphone', 2);
  await drain();
  expect(runtime.feed).toHaveBeenCalledOnce();
  audio('microphone', 3);
  input(4, { ...remote, microphoneMuted: true });
  runtime.emit({
    type: 'segment',
    segment: {
      id: 'old',
      source: 'microphone',
      text: 'private old result',
      final: true,
      startMs: 0,
      endMs: 100,
    },
  });
  runtime.emit({ type: 'speech-start', source: 'system' });
  expect(runtime.messages.some((message) => message.event?.type === 'segment')).toBe(false);
  expect(runtime.messages).toContainEqual({ event: { type: 'speech-start', source: 'system' } });
  expect(runtime.messages.some((message) => message.inputSet === 4)).toBe(false);
  finish();
  await drain();
  expect(runtime.inputSources).toHaveBeenCalledExactlyOnceWith(['system'], ['microphone']);
  expect(runtime.messages).toContainEqual({ inputSet: 4 });
  expect(runtime.feed).toHaveBeenCalledOnce();
  audio('microphone', 5);
  audio('system', 6);
  await drain();
  expect(runtime.feed.mock.calls.map(([source]) => source)).toEqual(['microphone', 'system']);
  input(7, remote);
  await drain();
  audio('microphone', 8, 0.5);
  await drain();
  expect(runtime.feed.mock.calls.at(-1)).toEqual([
    'microphone',
    new Float32Array(1600).fill(0.5),
    16000,
    800,
  ]);
  expect(runtime.inputSources.mock.calls.at(-1)).toEqual([
    ['microphone', 'system'],
    ['microphone'],
  ]);
});

it('方式切换丢弃两路旧识别缓存，系统音频在仅转录中既不推理也不发迟到文字', async () => {
  input(2, { inputMode: 'transcription', microphoneMuted: false }, ['microphone', 'system']);
  await drain();
  expect(runtime.inputSources).toHaveBeenCalledExactlyOnceWith(
    ['microphone'],
    ['microphone', 'system'],
  );
  audio('system', 3);
  audio('microphone', 4);
  runtime.emit({ type: 'speech-start', source: 'system' });
  await drain();
  expect(runtime.feed.mock.calls.map(([source]) => source)).toEqual(['microphone']);
  expect(runtime.messages.some((message) => message.event?.source === 'system')).toBe(false);
  expect(runtime.close).not.toHaveBeenCalled();
});

it('system mute retires only system recognition state and allows both sources to be gated without closing the model', async () => {
  input(2, { ...remote, systemAudioMuted: true }, ['system']);
  await drain();
  expect(runtime.inputSources).toHaveBeenCalledExactlyOnceWith(['microphone'], ['system']);
  audio('system', 3);
  audio('microphone', 4);
  runtime.emit({ type: 'speech-start', source: 'system' });
  await drain();
  expect(runtime.feed.mock.calls.map(([source]) => source)).toEqual(['microphone']);
  expect(runtime.messages.some((message) => message.event?.source === 'system')).toBe(false);
  input(5, { ...remote, systemAudioMuted: true, microphoneMuted: true }, ['microphone']);
  await drain();
  expect(runtime.inputSources.mock.calls.at(-1)).toEqual([[], ['microphone']]);
  audio('microphone', 6);
  audio('system', 7);
  await drain();
  expect(runtime.feed).toHaveBeenCalledOnce();
  input(8, remote, ['microphone', 'system']);
  await drain();
  audio('system', 9);
  await drain();
  expect(runtime.feed.mock.calls.at(-1)?.[0]).toBe('system');
  expect(runtime.close).not.toHaveBeenCalled();
});

it('取消发生在boundary前时跳过过期状态，只恢复旧状态且晚音频不跨越屏蔽', async () => {
  let finish!: () => void;
  runtime.feed.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  audio('microphone', 2);
  await drain();
  input(3, { ...remote, microphoneMuted: true });
  input(4, remote);
  audio('microphone', 5);
  finish();
  await drain();
  expect(runtime.inputSources).toHaveBeenCalledExactlyOnceWith(
    ['microphone', 'system'],
    ['microphone'],
  );
  expect(
    runtime.messages.filter((message) => message.inputSet).map((message) => message.inputSet),
  ).toEqual([3, 4]);
  expect(runtime.feed.mock.calls.map(([, samples]) => samples[0])).toEqual([2, 5]);
});
