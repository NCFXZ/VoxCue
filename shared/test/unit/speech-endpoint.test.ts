import { expect, it, vi } from 'vitest';
import { SpeechEngine } from '../../electron/backend/speech/engine';
import { QwenEngine } from '../../electron/backend/speech/qwen';
import { SampleBuffer } from '../../electron/backend/speech/buffer';
import { QwenLegacyEndpoint } from '../../electron/backend/speech/qwenLegacyEndpoint';
import type { AudioSource, SpeechEvent } from '../../electron/contracts/speech';

it('Paraformer以实际VAD结束帧回传静音起点，收尾补零不计入音频进度', () => {
  const events: SpeechEvent[] = [];
  let frames = 0;
  const stream = { acceptWaveform: vi.fn(), inputFinished: vi.fn() };
  const engine = Object.create(SpeechEngine.prototype) as SpeechEngine;
  Object.assign(engine, {
    audioMs: 0,
    inferenceMs: 0,
    emit: (event: SpeechEvent) => events.push(event),
    recognizer: {
      isReady: () => false,
      getResult: () => ({ text: '合成问题' }),
      createStream: () => stream,
    },
    sources: new Map([
      [
        'system',
        {
          rate: 16000,
          resampler: { resample: (samples: Float32Array) => samples },
          buffer: new SampleBuffer(32000),
          vad: {
            acceptWaveform: () => frames++,
            isDetected: () => frames < 32,
            isEmpty: () => true,
          },
          stream,
          id: 'first',
          samples: 16000,
          origin: 1000,
          start: 1000,
          active: true,
          text: '合成问题',
          lastEmit: 0,
        },
      ],
    ]),
  });
  engine.feed('system', new Float32Array(16384), 16000, 3024);
  const final = events.find((event) => event.type === 'segment' && event.segment.final);
  expect(final).toMatchObject({
    type: 'segment',
    segment: {
      endMs: 3024,
      silenceStartMs: 2524,
      reason: 'silence',
      text: '合成问题',
    },
  });
  expect(stream.inputFinished).toHaveBeenCalledOnce();
  expect(engine.processedThrough('system')).toBe(3024);
});
it('软静音直接丢弃Paraformer单路缓存，不decode旧尾句也不影响系统通道', () => {
  const engine = Object.create(SpeechEngine.prototype) as SpeechEngine;
  const emit = vi.fn(), finalize = vi.fn();
  const system = { origin: 1000, samples: 16000 }, microphone = { origin: 2000, samples: 32000 };
  Object.assign(engine, { emit, finalize, sources: new Map([['system', system], ['microphone', microphone]]) });
  engine.discard('microphone');
  expect(engine.processedThrough('microphone')).toBeUndefined();
  expect(engine.processedThrough('system')).toBe(2000);
  expect(finalize).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});
const frameSize = 512;
const rate = 16000;
function endpoint() {
  let through = 0, active = false;
  let region: { start: number; samples: Float32Array } | undefined;
  return new QwenLegacyEndpoint({
    acceptWaveform(frame) {
      const speaking = frame[0] > 0;
      if (active && !speaking) region = { start: through, samples: new Float32Array(0) };
      through += frame.length;
      active = speaking;
    },
    isEmpty: () => !region,
    isDetected: () => active,
    front: () => region!,
    pop: () => { region = undefined; },
    reset: () => { through = 0; active = false; region = undefined; },
  });
}
function qwen(nativeSilenceMs = 800) {
  const events: SpeechEvent[] = [];
  const engine = Object.create(QwenEngine.prototype) as QwenEngine;
  const native = new Map<AudioSource, { samples: number; heard: boolean; text: string }>();
  const chunks: { source: AudioSource; samples: number[] }[] = [];
  const requests: { op: string; source: AudioSource }[] = [];
  const receive = (source: AudioSource, value: object) =>
    (engine as any).receive({ session: source, ...value });
  const send = vi.fn(async (m: { op: string; source: AudioSource; audio?: string }) => {
    requests.push({ op: m.op, source: m.source });
    if (m.op === 'start') native.set(m.source, { samples: 0, heard: false, text: '' });
    const lane = native.get(m.source)!;
    if (m.op === 'audio') {
      const pcm = Buffer.from(m.audio!, 'base64');
      const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
      chunks.push({ source: m.source, samples });
      const next = samples.find(n => n > 0);
      lane.samples += samples.length;
      if (next !== undefined) {
        if (!lane.heard) receive(m.source, { type: 'speech_start', audio_ms: lane.samples / 16 });
        lane.heard = true;
        lane.text = String(next);
        receive(m.source, { type: 'partial', text: lane.text, window_start_ms: 0, audio_ms: lane.samples / 16 });
      }
    }
    if (m.op === 'finish' && lane.heard)
      receive(m.source, { type: 'tail_final', reason: 'requested_stop', text: lane.text,
        window_start_ms: 0, audio_ms: lane.samples / 16 });
  });
  Object.assign(engine, { audioMs: 0, inferenceMs: 0, emit: (e: SpeechEvent) => events.push(e),
    sources: new Map(), send, nativeSilenceMs,
    legacyEndpoints: nativeSilenceMs > 500 ? new Map([['system', endpoint()], ['microphone', endpoint()]]) : undefined });
  const feed = (frames: number, level = 0, source: AudioSource = 'system', at = 1000) =>
    engine.feed(source, new Float32Array(frames * frameSize).fill(level), rate, at);
  const finals = () => events.flatMap(e => e.type === 'segment' && e.segment.final ? [e.segment] : []);
  return { engine, events, receive, feed, chunks, requests, send, finals };
}
it.each([700, 800])('旧Qwen（%i ms）在静音满500ms的第一完整帧截句，同包复音逐样本送入新lane并保留时钟', async nativeSilenceMs => {
  const f = qwen(nativeSilenceMs);
  await f.feed(1, 0.25);                   // Through 1032, then silence begins.
  await f.feed(15);                         // 480ms of confirmed quiet.
  expect(f.finals()).toEqual([]);
  const mixed = new Float32Array(frameSize * 2);
  mixed.fill(0.5, frameSize);
  await f.engine.feed('system', mixed, rate, 1512);
  expect(f.finals()).toEqual([expect.objectContaining({ final: true, text: '8192',
    startMs: 1000, endMs: 1544, silenceStartMs: 1032, reason: 'silence' })]);
  expect(f.events.at(-1)).toMatchObject({ type: 'segment', segment: {
    final: false, text: '16384', startMs: 1544, endMs: 1576 } });
  const latest = f.events.at(-1);
  expect(latest?.type === 'segment' && latest.segment.id).not.toBe(f.finals()[0].id);
  const delivered = f.chunks.flatMap(chunk => chunk.samples);
  expect(delivered).toEqual([...Array(512).fill(8192), ...Array(16 * 512).fill(0), ...Array(512).fill(16384)]);
  expect(f.engine.processedThrough('system')).toBe(1576);
});
it('截止前复音保持同一段，真实时间和未满帧的PCM都不能推动断句', async () => {
  vi.useFakeTimers();
  try {
    const f = qwen();
    await f.feed(1, 0.25);
    await f.feed(15);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.finals()).toEqual([]);
    await f.feed(1, 0.5);
    await f.feed(15);
    await f.engine.feed('system', new Float32Array(511), rate, 2024);
    expect(f.engine.processedThrough('system')).toBe(2024);
    expect(f.finals()).toEqual([]);
    await f.engine.feed('system', new Float32Array(1), rate, 2055);
    expect(f.finals()).toEqual([expect.objectContaining({ text: '16384', startMs: 1000, silenceStartMs: 1544, endMs: 2056 })]);
  } finally { vi.useRealTimers(); }
});
it('在一个输入包内确认的连续旧版断句保持独立音源和单调的累计时间', async () => {
  const f = qwen();
  await f.feed(1, 0.25);
  await f.feed(1, 0.5, 'microphone', 6000);
  await f.feed(16);
  await f.feed(1, 0.75);
  await f.feed(16);
  expect(f.finals().map(x => [x.source, x.startMs, x.endMs])).toEqual([
    ['system', 1000, 1544], ['system', 1544, 2088],
  ]);
  expect(f.engine.processedThrough('microphone')).toBe(6032);
  await f.feed(16, 0, 'microphone', 6032);
  expect(f.finals().at(-1)).toMatchObject({ source: 'microphone', startMs: 6000, silenceStartMs: 6032 });
  expect(new Set(f.finals().map(x => x.id)).size).toBe(3);
});
it.each(['pause', 'stop', 'discontinuity', 'discard'] as const)('%s不会把手动收尾误判为静音，软静音丢弃尾句', async reason => {
  const f = qwen();
  await f.feed(2, 0.25);
  await f.feed(15);
  if (reason === 'discard') await f.engine.discard('system');
  else if (reason === 'discontinuity') await f.engine.discontinuity('system');
  else await f.engine.flush(reason);
  expect(f.finals()).toHaveLength(reason === 'discard' ? 0 : 1);
  if (reason !== 'discard') {
    expect(f.finals()[0]).toMatchObject({ reason, text: '8192' });
    expect(f.finals()[0]).not.toHaveProperty('silenceStartMs');
  }
  expect(f.engine.processedThrough('system')).toBeUndefined();
  await f.feed(1, 0.5, 'system', 8000);
  expect(f.engine.processedThrough('system')).toBe(8032);
});
it.each([500, 700, 800])('真实原生静音以握手声明的 %i ms 阈值计算', async nativeSilenceMs => {
  const f = qwen(nativeSilenceMs);
  await f.feed(1, 0.25);
  await f.feed(28, 0.25);
  const previous = f.send.getMockImplementation()!;
  let release!: () => void;
  const disk = new Promise<void>(resolve => { release = resolve; });
  f.send.mockImplementationOnce(async m => {
    f.receive('system', { type: 'tail_final', reason: 'pause', text: '已结束', window_start_ms: 0, audio_ms: 960 });
    await disk;
    await previous(m);
  });
  const pending = f.feed(1);
  expect(f.finals()).toEqual([]);
  expect(f.engine.processedThrough('system')).toBe(1928);
  release();
  await pending;
  expect(f.finals()).toEqual([expect.objectContaining({ reason: 'silence', endMs: 1960,
    silenceStartMs: 1960 - nativeSilenceMs })]);
  expect(f.engine.canSwitch('system')).toBe(true);
});
it('四句提交保留continuation，安全上限不制造静音或模型交接窗口', async () => {
  const f = qwen();
  await f.feed(1, .25);
  f.receive('system', { type: 'committed', text: '第一句', tail: '下一句', cut_ms: 20, audio_ms: 32, window_start_ms: 0 });
  expect(f.finals()[0]).toMatchObject({ reason: 'sentence', endMs: 1020 });
  expect(f.events.at(-1)).toMatchObject({ type: 'segment', segment: { final: false, continuationOf: f.finals()[0].id } });
  f.receive('system', { type: 'tail_final', reason: 'safety_limit', text: '下一句', window_start_ms: 20, audio_ms: 32 });
  expect(f.finals()[1]).toMatchObject({ reason: 'limit' });
  expect(f.finals()[1]).not.toHaveProperty('silenceStartMs');
  expect(f.engine.canSwitch('system')).toBe(false);
});

it('检测器强制切出长片段时，短暂的非活动状态和持续讲话不会造成500ms静音', () => {
  let frames = 0;
  let queued = false;
  const cut = new QwenLegacyEndpoint({
    acceptWaveform() { queued = ++frames === 10; },
    isEmpty: () => !queued,
    isDetected: () => frames < 10 || frames > 12,
    front: () => ({ start: 0, samples: new Float32Array(9 * frameSize) }),
    pop: () => { queued = false; },
    reset() {},
  });
  expect(cut.cut(new Float32Array(60 * frameSize))).toBeUndefined();
});

it('原生开口与临时稿不等整包ACK，失败请求中的静音终稿不能发送', async () => {
  const f = qwen(500);
  await f.feed(1);
  let reject!: (error: Error) => void;
  f.send.mockImplementationOnce(async () => {
    f.receive('system', { type: 'speech_start', audio_ms: 64 });
    f.receive('system', { type: 'partial', text: '继续', window_start_ms: 32, audio_ms: 64 });
    f.receive('system', { type: 'tail_final', reason: 'pause', text: '未确认', audio_ms: 64 });
    await new Promise<void>((_, fail) => { reject = fail; });
  });
  const pending = f.feed(1);
  expect(f.events).toContainEqual({ type: 'speech-start', source: 'system' });
  expect(f.events.at(-1)).toMatchObject({ segment: { final: false, text: '继续' } });
  reject(Error('synthetic failed audio'));
  await expect(pending).rejects.toThrow('synthetic failed audio');
  expect(f.finals()).toEqual([]);
  expect(f.engine.processedThrough('system')).toBe(1032);
});
