import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
      postMessage(message: any, transfer?: ArrayBuffer[]) {
        runtime.messages.push(transfer ? structuredClone(message, { transfer }) : message);
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
import { SpeechController, type CaptureAdapter } from '../../electron/backend/speech/controller';
import { RecordingChannel } from '../../electron/backend/speech/recordingChannel';
import { RecordingVoiceFilter } from '../../electron/backend/speech/recordingVoiceFilter';
import * as preprocessing from '../../electron/backend/speech/preprocessor';

type Capture = {
  audio(packet: AudioPacket): void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};
let controller: SpeechController;
let adapter: CaptureAdapter;
let events: SpeechEvent[];
const captures = new Map<AudioSource, Capture>();
const remote: InterviewInputState = { inputMode: 'remote', microphoneMuted: false };
const transcription: InterviewInputState = { inputMode: 'transcription', microphoneMuted: false };
const packet = () => ({ samples: new Float32Array(1600), rate: 16000, timestamp: 0, flags: 0 });
const turn = () => Promise.resolve().then(() => Promise.resolve());

it('双路积压时只发布提问音源的合并进度，首包与最后一次 ACK 立即通知', async () => {
  await start();
  const worker = runtime.workers[0];
  for (let i = 0; i < 50; i++)
    for (const source of ['microphone', 'system'] as const)
      captures.get(source)!.audio({ ...packet(), samples: new Float32Array(160) });
  const progress = () => events.filter(event => event.type === 'audio-progress');
  expect(progress()).toMatchObject([{ source: 'system', pending: true }]);
  const audio = runtime.messages.filter(message => message.op === 'audio');
  for (const [i, message] of audio.entries()) {
    worker.emit('message', {
      ack: message.sequence, progress: { [message.source]: (Math.floor(i / 2) + 1) * 10 },
    });
    if (i < audio.length - 1) expect(progress().at(-1)).toMatchObject({ pending: true });
  }
  expect(progress().at(-1)).toMatchObject({ source: 'system', pending: false, processedThroughMs: 500 });
  expect(progress().length).toBeLessThan(10);
  expect(progress().every(event => event.source === 'system')).toBe(true);
});

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
  adapter = {
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
  };
  controller = new SpeechController('synthetic-model', 'synthetic-helper', (event) => events.push(event), adapter);
});
afterEach(async () => {
  runtime.acknowledge = true;
  await controller.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([false, true])('麦克风转写等待回声判定并保留本人原声，结束录音只截取 WAV 尾段（系统静音 %s）', async systemAudioMuted => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-recording-tail-'));
  Object.assign(adapter, { preprocessorFile: 'synthetic' });
  let release!: () => void;
  let reference!: Float32Array;
  const configure = vi.fn();
  vi.spyOn(preprocessing, 'loadAudioPreprocessor').mockImplementation(async (_file, consume) => ({
    start: configure, close() {}, flush() {}, discontinuity: source => [source],
    feed(source, samples, rate, timestamp) {
      if (source === 'system') {
        reference = samples;
      } else {
        release = () => consume(source, samples.map((value, i) => value - (reference[i] ?? 0)), rate, timestamp, samples);
      }
    },
  }));
  try {
    await start({ ...remote, systemAudioMuted });
    await controller.call({ op: 'recording', directory });
    // A loud reference triggers recording headroom protection even in the first packet.
    const playback = Float32Array.from({ length: 160 }, (_, i) => 0.75 * Math.sin(i / 5));
    const savedSystem = new RecordingChannel('system', 16000).process(playback);
    expect(savedSystem).not.toEqual(playback);
    const microphone = Float32Array.from({ length: 320 }, (_, i) => 0.1 * Math.sin(i / 3) + (playback[i] ?? 0));
    captures.get('system')!.audio({ ...packet(), samples: playback.slice() });
    captures.get('microphone')!.audio({ ...packet(), samples: microphone.slice() });
    expect(reference).toEqual(playback);
    const audio = () => runtime.messages.filter(m => m.op === 'audio').map(m => [m.source, m.samples]);
    const expectedAudio = systemAudioMuted ? [['microphone', microphone]] :
      [['system', playback], ['microphone', microphone]];
    expect(audio()).toEqual(systemAudioMuted ? [] : [['system', playback]]);
    vi.advanceTimersByTime(10);
    const stop = controller.call({ op: 'recording' });
    await turn();
    release();
    await stop;
    expect(audio()).toEqual(expectedAudio);
    const [file] = await fs.readdir(directory);
    const wav = await fs.readFile(path.join(directory, file));
    expect(wav.length).toBe(44 + 160 * 2);
    const near = microphone.subarray(0, 160).map((value, i) => value - playback[i]);
    const filtered = new RecordingVoiceFilter(16000).process(near);
    const expectedPcm = Array.from(filtered, (value, i) =>
      Math.round(32767 * Math.fround(value + (systemAudioMuted ? 0 : savedSystem[i]))));
    expect(Array.from(filtered, (_, i) => wav.readInt16LE(44 + 2 * i))).toEqual(expectedPcm);
    expect(configure).toHaveBeenCalledTimes(1);
  } finally {
    await controller.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

it('现场面试无法打开可选的播放参考时提示原因，继续使用麦克风', async () => {
  Object.assign(adapter, { preprocessorFile: 'synthetic' });
  const configure = vi.fn();
  vi.spyOn(preprocessing, 'loadAudioPreprocessor').mockImplementation(async (_file, consume) => ({
    start: configure, feed(source, samples, rate, timestamp) { consume(source, samples, rate, timestamp); },
    close() {}, flush() {}, discontinuity: source => [source],
  }));
  const create = adapter.create;
  adapter.create = (...args) => {
    const capture = create(...args);
    if (args[1] === 'system') capture.start = async () => { throw Error('reference unavailable'); };
    return capture;
  };
  expect((await start(transcription, ['microphone'])).state).toBe('running');
  expect(configure).toHaveBeenLastCalledWith(['microphone']);
  expect(events).toContainEqual({ type: 'gap', source: 'microphone', message: '系统播放参考不可用，麦克风无法消除扬声器回声。' });
  captures.get('microphone')!.audio(packet());
  expect(runtime.messages.filter(m => m.op === 'audio').map(m => m.source)).toEqual(['microphone']);
});

it('录音只接收本场已启用的音源，暂停封口且新采集不继承旧文件', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-recording-input-'));
  try {
    await start();
    expect(await fs.readdir(directory)).toEqual([]);
    expect(await controller.call({ op: 'recording', directory })).toMatchObject({ recording: true });
    await controller.call({ op: 'set-input-state', state: { ...remote, microphoneMuted: true } });
    captures.get('microphone')!.audio({ ...packet(), samples: new Float32Array(1600).fill(0.75) });
    captures.get('system')!.audio({ ...packet(), samples: new Float32Array(1600).fill(0.25) });
    await controller.call({ op: 'pause' });
    const [file] = await fs.readdir(directory);
    const wav = await fs.readFile(path.join(directory, file));
    expect(wav.readInt16LE(44)).toBe(8192);
    expect(events.filter(e => e.type === 'recording').map(e => e.active)).toEqual([true, false]);
    await expect(controller.call({ op: 'recording', directory })).rejects.toThrow();
    await start();
    await controller.call({ op: 'stop' });
    expect(await fs.readdir(directory)).toEqual([file]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

it('磁盘写入等待期间转写继续收包，结束录音等到已接收的样本全部写完', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-recording-backpressure-'));
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  try {
    await start();
    await controller.call({ op: 'recording', directory });
    const [name] = await fs.readdir(directory);
    const file = path.join(directory, name);
    const probe = await fs.open(file, 'r');
    const handle = Object.getPrototypeOf(probe);
    await probe.close();
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const truncate = handle.truncate;
    vi.spyOn(handle, 'truncate').mockImplementationOnce(async function(this: fs.FileHandle, ...args) {
      entered();
      await gate;
      return truncate.apply(this, args);
    });
    const send = (timestamp: number, frames: number) => captures.get('system')!.audio({
      ...packet(), timestamp, samples: new Float32Array(frames).fill(0.25),
    });
    send(0, 32000);
    await waiting;
    const first = runtime.messages.find(m => m.op === 'audio');
    runtime.workers[0].emit('message', { ack: first.sequence });
    vi.advanceTimersByTime(2000);
    send(2000, 160);
    expect(runtime.messages.filter(m => m.op === 'audio').map(m => m.samples.length)).toEqual([32000, 160]);
    const stop = controller.call({ op: 'recording' });
    await turn();
    expect(events.filter(e => e.type === 'recording').map(e => e.active)).toEqual([true]);
    resume();
    await stop;
    const [finished] = await fs.readdir(directory);
    expect(name).toBe(finished + '.pending');
    expect((await fs.stat(path.join(directory, finished))).size).toBe(44 + (32000 + 160) * 2);
  } finally {
    resume();
    await controller.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

it.each(['microphone', 'system'] as const)('保存 WAV 时平衡较弱的 %s，并保留同时说话的两路声音', async quietSource => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-recording-balance-'));
  const rate = 16000;
  const tones = { microphone: 500, system: 900 };
  try {
    await start();
    await controller.call({ op: 'recording', directory });
    // Two seconds per voice, two seconds of overlap, then background noise and silence.
    for (let ms = 0; ms < 7000; ms += 20) {
      for (const source of ['microphone', 'system'] as const) {
        const talking = source === 'microphone' ? ms < 2000 || ms >= 4000 : ms >= 2000;
        const voiceLevel = source === quietSource ? 0.03 : 0.48;
        let level = talking ? voiceLevel : 0;
        if (ms >= 6000) level = ms < 6500 ? 0.0004 : 0;
        // A loud transient follows the settled overlap, before the noise-floor check.
        if (ms === 5500) level = 0.98;
        const samples = Float32Array.from({ length: rate / 50 }, (_, i) =>
          level * Math.sin(2 * Math.PI * tones[source] * i / rate));
        const original = ms === 5500 ? samples.slice() : undefined;
        captures.get(source)!.audio({ rate, timestamp: 10000 + ms, flags: 0, samples });
        const frame = runtime.messages.at(-1);
        if (original) expect(frame.samples).toEqual(original);
        runtime.workers[0].emit('message', { ack: frame.sequence });
      }
      vi.advanceTimersByTime(20);
    }
    await controller.call({ op: 'recording' });
    const [file] = await fs.readdir(directory);
    const wav = await fs.readFile(path.join(directory, file));
    expect(wav.readUInt32LE(40)).toBe(7 * rate * 2);
    // Measure each tone independently, including when both share the same PCM samples.
    const amplitude = (source: AudioSource, from: number, seconds = 0.5) => {
      let sine = 0, cosine = 0;
      const first = Math.round(from * rate), length = Math.round(seconds * rate);
      for (let i = first; i < first + length; i++) {
        const sample = wav.readInt16LE(44 + i * 2) / 32767;
        const phase = 2 * Math.PI * tones[source] * i / rate;
        sine += sample * Math.sin(phase);
        cosine += sample * Math.cos(phase);
      }
      return 2 * Math.hypot(sine, cosine) / length;
    };
    for (const together of [false, true]) {
      const mic = amplitude('microphone', together ? 5 : 1.5);
      const system = amplitude('system', together ? 5 : 3.5);
      // The original 16:1 imbalance drops below 4:1 in either direction.
      expect(Math.max(mic, system) / Math.min(mic, system)).toBeLessThan(4);
      expect(Math.min(mic, system)).toBeGreaterThan(0.03);
    }
    const burst = Array.from({ length: rate / 50 }, (_, i) => wav.readInt16LE(44 + (5.5 * rate + i) * 2));
    expect(burst.some((v, i) => Math.abs(v) === 32767 && v === burst[i - 1])).toBe(false);
    expect(amplitude('microphone', 6)).toBeLessThan(0.002);
    const systemVoiceLevel = quietSource === 'system' ? 0.03 : 0.48;
    const systemGain = amplitude('system', 5.85, 0.15) / systemVoiceLevel;
    const quietDetail = amplitude('system', 6) / (systemGain * 0.0004);
    expect(quietDetail).toBeGreaterThan(0.9);
    expect(quietDetail).toBeLessThan(1.1);
    expect(wav.subarray(44 + Math.round(6.9 * rate) * 2).every(byte => byte === 0)).toBe(true);
  } finally {
    await controller.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

it.each(['native', 'anchored'])('双路录音跟随各自开关，重新开启时丢弃静音期间积压的采样 (%s)', async (clock) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-recording-mute-'));
  try {
    const captureTime = () => 123456 + Number(process.hrtime.bigint()) / 1e6;
    if (clock === 'native') adapter.captureClockNow = captureTime;
    await start();
    await controller.call({ op: 'recording', directory });
    const origin = captureTime();
    const send = (source: AudioSource, at: number, duration = 10, flags = 0) => {
      captures.get(source)!.audio({
        rate: 16000, timestamp: origin + at, flags,
        samples: new Float32Array(duration * 16).fill(source === 'microphone' ? 0.25 : 0.5),
      });
    };
    const mute = (microphoneMuted: boolean, systemAudioMuted: boolean) =>
      controller.call({ op: 'set-input-state', state: { ...remote, microphoneMuted, systemAudioMuted } });
    send('microphone', 0);
    send('system', 0);
    vi.advanceTimersByTime(10);
    await mute(false, true);
    send('microphone', 10);
    send('system', 10);
    vi.advanceTimersByTime(10);
    await mute(true, true);
    send('microphone', 20);
    send('system', 20);
    vi.advanceTimersByTime(10);
    await mute(true, false);
    send('system', 20, 3, 4); // The device could not timestamp this buffered packet.
    send('system', 23, 2);
    send('system', 25); // Straddles the system unmute at 30 ms.
    send('system', 35, 5);
    vi.advanceTimersByTime(10);
    await mute(false, false);
    send('microphone', 30, 5);
    send('microphone', 35); // Straddles the microphone unmute at 40 ms.
    send('microphone', 45, 5);
    send('system', 40);
    vi.advanceTimersByTime(10);
    await controller.call({ op: 'recording' });

    const [file] = await fs.readdir(directory);
    const wav = await fs.readFile(path.join(directory, file));
    const mic = new Float32Array(800);
    const filteredMic = (length: number) =>
      new RecordingVoiceFilter(16000).process(new Float32Array(length).fill(0.25));
    mic.set(filteredMic(320), 0);
    mic.set(filteredMic(160), 640);
    expect(wav.readUInt32LE(40)).toBe(mic.length * 2);
    const actual = Array.from(mic, (_, i) => wav.readInt16LE(44 + i * 2));
    const expected = Array.from(mic, (sample, i) =>
      Math.round(Math.fround(sample + (i < 160 || i >= 480 ? 0.5 : 0)) * 32767));
    expect(actual).toEqual(expected);
  } finally {
    await controller.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
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
