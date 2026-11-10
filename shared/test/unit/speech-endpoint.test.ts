import { expect, it, vi } from 'vitest';
import { SpeechEngine } from '../../electron/backend/speech/engine';
import { QwenEngine } from '../../electron/backend/speech/qwen';
import { SampleBuffer } from '../../electron/backend/speech/buffer';
import type { SpeechEvent } from '../../electron/contracts/speech';

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
          silentReset: 1000,
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
      silenceStartMs: 2024,
      reason: 'silence',
      text: '合成问题',
    },
  });
  expect(stream.inputFinished).toHaveBeenCalledOnce();
  expect(engine.processedThrough('system')).toBe(3024);
});
function qwen() {
  const events: SpeechEvent[] = [];
  const engine = Object.create(QwenEngine.prototype) as QwenEngine;
  const state = { id: 'first', origin: 1000, start: 0, rate: 16000, samples: 28672, active: true };
  const send = vi.fn(async (_command: object) => {});
  Object.assign(engine, {
    inferenceMs: 0,
    audioMs: 0,
    send,
    emit: (event: SpeechEvent) => events.push(event),
    sources: new Map([['system', state]]),
  });
  const receive = (value: object) =>
    (engine as any).receive({
      session: 'system',
      audio_ms: 1792,
      window_start_ms: 0,
      text: '合成问题',
      ...value,
    });
  const feed = (ms: number, amplitude = 0) =>
    engine.feed(
      'system',
      new Float32Array(ms * 16).fill(amplitude),
      16000,
      1000 + state.samples / 16,
    );
  const finals = () =>
    events
      .filter(
        (event): event is SpeechEvent & { type: 'segment' } =>
          event.type === 'segment' && event.segment.final,
      )
      .map((event) => event.segment);
  return { engine, events, state, send, receive, feed, finals };
}
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
it('软静音丢弃Qwen待决终稿并屏蔽native finish尾句，恢复只建新lane不重载模型', async () => {
  const f = qwen();
  f.receive({ type: 'tail_final', reason: 'pause' });
  expect(f.finals()).toEqual([]);
  expect(f.events).toHaveLength(1);
  f.events.length = 0;
  f.send.mockImplementation(async (command) => {
    if ((command as { op: string }).op === 'finish') f.receive({ type: 'tail_final', reason: 'stop' });
  });
  await f.engine.discard('system');
  expect(f.engine.processedThrough('system')).toBeUndefined();
  expect(f.events).toEqual([]);
  await f.engine.feed('system', new Float32Array(512), 16000, 8000);
  expect(f.send.mock.calls.filter(([command]) => (command as { op: string }).op === 'finish')).toHaveLength(1);
  expect(f.send.mock.calls.filter(([command]) => (command as { op: string }).op === 'start')).toHaveLength(1);
  expect(f.engine.processedThrough('system')).toBe(8032);
  expect(f.finals()).toEqual([]);
  f.receive({ type: 'partial', audio_ms: 32, text: '恢复后新问题' });
  expect(f.events.filter((event) => event.type === 'segment')).toMatchObject([
    { segment: { text: '恢复后新问题', startMs: 8000, endMs: 8032, final: false } },
  ]);
  const fresh = f.events.find((event) => event.type === 'segment');
  expect(fresh?.type === 'segment' && fresh.segment.id).not.toBe('first');
});
it('Qwen保留固定800ms原生静音起点，等真实1s帧ACK才发布同ID终稿', async () => {
  const f = qwen();
  f.receive({ type: 'tail_final', reason: 'pause' });
  expect(f.finals()).toEqual([]);
  expect(f.engine.canSwitch('system')).toBe(false);
  expect(f.events[0]).toMatchObject({
    type: 'segment',
    segment: { id: 'first', final: false, text: '合成问题' },
  });
  await f.feed(192);
  expect(f.engine.processedThrough('system')).toBe(2984);
  expect(f.finals()).toEqual([]);
  await f.feed(32);
  expect(f.finals()).toEqual([]);
  await f.feed(96);
  expect(f.finals()).toEqual([
    expect.objectContaining({
      id: 'first',
      endMs: 2792,
      silenceStartMs: 1992,
      reason: 'silence',
      speechModel: 'qwen',
    }),
  ]);
  expect(f.engine.canSwitch('system')).toBe(true);
});
it('Qwen不靠墙钟等待虚构静音音频进度', async () => {
  vi.useFakeTimers();
  try {
    const f = qwen();
    f.receive({ type: 'tail_final', reason: 'pause' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.finals()).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
it('800至1000ms复音保留同一逻辑ID，后续临时稿和终稿不重复前缀', async () => {
  const f = qwen();
  f.receive({ type: 'tail_final', reason: 'pause', text: '第一段' });
  await f.feed(128);
  f.receive({ type: 'speech_start', audio_ms: 1920 });
  f.receive({
    type: 'partial',
    text: '第二段',
    window_start_ms: 1792,
    audio_ms: 2400,
    inference_ms: 9,
  });
  expect(f.events.at(-1)).toMatchObject({
    type: 'segment',
    segment: { id: 'first', text: '第一段 第二段', final: false, startMs: 1000 },
  });
  expect(f.engine.inferenceMs).toBe(9);
  await f.feed(1664);
  f.receive({
    type: 'tail_final',
    reason: 'pause',
    text: '第二段',
    window_start_ms: 1792,
    audio_ms: 3584,
  });
  await f.feed(320);
  expect(f.finals()).toEqual([
    expect.objectContaining({ id: 'first', text: '第一段 第二段', silenceStartMs: 3784 }),
  ]);
});
it('950ms真实PCM复音即使原生speech_start到1056ms才到也不能提前终稿', async () => {
  const f = qwen();
  f.receive({ type: 'tail_final', reason: 'pause', text: '第一段' });
  await f.feed(128);
  const onset = new Float32Array(512);
  onset.fill(0.02, 352);
  await f.engine.feed('system', onset, 16000, 2920);
  await f.feed(64, 0.02);
  expect(f.engine.processedThrough('system')).toBe(3016);
  expect(f.finals()).toEqual([]);
  await f.feed(32, 0.02);
  f.receive({ type: 'speech_start', audio_ms: 2048 });
  f.receive({ type: 'partial', text: '恢复发言', audio_ms: 2208, window_start_ms: 1842 });
  expect(f.finals()).toEqual([]);
  expect(f.events.at(-1)).toMatchObject({
    type: 'segment',
    segment: { id: 'first', text: '第一段 恢复发言' },
  });
});
it('超过1s复音与ACK同包时按已处理PCM起点分开ID，不被原生100ms预留误并', async () => {
  const f = qwen();
  f.receive({ type: 'tail_final', reason: 'pause', text: '第一段' });
  await f.feed(200);
  const onset = new Float32Array(1024);
  onset.fill(0.02, 800);
  await f.engine.feed('system', onset, 16000, 2992);
  f.send.mockImplementationOnce(async () => {
    f.receive({ type: 'speech_start', audio_ms: 2144 });
    f.receive({
      type: 'partial',
      text: '新一段',
      audio_ms: 2144,
      window_start_ms: 1942,
      inference_ms: 7,
    });
  });
  await f.feed(88, 0.02);
  expect(f.finals()).toEqual([
    expect.objectContaining({ id: 'first', text: '第一段', silenceStartMs: 1992 }),
  ]);
  expect(f.events.at(-1)).toMatchObject({
    type: 'segment',
    segment: { text: '新一段', final: false },
  });
  expect((f.events.at(-1) as SpeechEvent & { type: 'segment' }).segment.id).not.toBe('first');
  expect(f.engine.inferenceMs).toBe(7);
  expect(f.engine.canSwitch('system')).toBe(false);
});
it.each([1800, 2016])(
  '低RMS但原生已确认开口时等待真实window_start=%s，再决定并句或新ID',
  async (windowStart) => {
    const f = qwen();
    f.receive({ type: 'tail_final', reason: 'pause', text: '第一段' });
    await f.feed(256);
    f.receive({ type: 'speech_start', audio_ms: 2048 });
    await f.feed(192);
    expect(f.finals()).toEqual([]);
    f.receive({ type: 'partial', text: '轻声发言', audio_ms: 2240, window_start_ms: windowStart });
    if (windowStart < 1992) {
      expect(f.finals()).toEqual([]);
      expect(f.events.at(-1)).toMatchObject({
        type: 'segment',
        segment: { id: 'first', text: '第一段 轻声发言' },
      });
    } else {
      expect(f.finals()).toEqual([
        expect.objectContaining({ id: 'first', text: '第一段', reason: 'silence' }),
      ]);
      expect((f.events.at(-1) as SpeechEvent & { type: 'segment' }).segment.id).not.toBe('first');
    }
    expect(f.engine.canSwitch('system')).toBe(false);
  },
);
it('Qwen只确认已完成的512采样帧，未完成的推理和PCM尾部不增加静音进度', async () => {
  let done!: () => void;
  const engine = Object.create(QwenEngine.prototype) as QwenEngine;
  Object.assign(engine, {
    audioMs: 0,
    emit: () => {},
    sources: new Map([
      ['system', { id: 'first', origin: 1000, start: 0, rate: 16000, samples: 0 }],
    ]),
    send: () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  });
  const feeding = engine.feed('system', new Float32Array(513), 16000, 1032);
  expect(engine.processedThrough('system')).toBe(1000);
  done();
  await feeding;
  expect(engine.processedThrough('system')).toBe(1032);
});
it('Qwen四句固定和安全上限终稿不构成切换停顿，只有真实逻辑静音终稿可交接', async () => {
  const engine = Object.create(QwenEngine.prototype) as QwenEngine;
  Object.assign(engine, {
    inferenceMs: 0,
    audioMs: 0,
    send: async () => {},
    emit: () => {},
    sources: new Map([
      [
        'system',
        { id: 'first', origin: 1000, start: 0, rate: 16000, samples: 32000, active: false },
      ],
    ]),
  });
  const receive = (event: object) =>
    (engine as any).receive({
      session: 'system',
      audio_ms: 2000,
      window_start_ms: 0,
      text: '合成',
      ...event,
    });
  receive({ type: 'speech_start' });
  expect(engine.canSwitch('system')).toBe(false);
  receive({ type: 'committed', cut_ms: 1000 });
  expect(engine.canSwitch('system')).toBe(false);
  receive({ type: 'tail_final', reason: 'safety_limit' });
  expect(engine.canSwitch('system')).toBe(false);
  receive({ type: 'tail_final', reason: 'pause' });
  expect(engine.canSwitch('system')).toBe(false);
  await engine.feed('system', new Float32Array(5120), 16000, 3000);
  expect(engine.canSwitch('system')).toBe(true);
});
it.each(['pause', 'stop', 'discontinuity'] as const)(
  '%s明确边界保留已延迟文字一次且不伪造silence',
  async (reason) => {
    const f = qwen();
    f.receive({ type: 'tail_final', reason: 'pause' });
    if (reason === 'pause' || reason === 'stop') await f.engine.flush(reason);
    else await f.engine.discontinuity('system');
    expect(f.finals()).toEqual([
      expect.objectContaining({ id: 'first', text: '合成问题', reason }),
    ]);
    expect(f.finals()[0]).not.toHaveProperty('silenceStartMs');
  },
);
it('暂停收尾保留短停顿前缀和新原生尾段，不跨下个采集会话', async () => {
  const f = qwen();
  f.receive({ type: 'tail_final', reason: 'pause', text: '第一段' });
  await f.feed(128);
  f.receive({ type: 'speech_start', audio_ms: 1920 });
  f.receive({ type: 'partial', text: '继续', window_start_ms: 1792, audio_ms: 2208 });
  f.send.mockImplementationOnce(async () => {
    f.receive({
      type: 'tail_final',
      reason: 'requested_stop',
      text: '继续',
      window_start_ms: 1792,
      audio_ms: 2208,
    });
  });
  await f.engine.flush('pause');
  expect(f.finals()).toEqual([
    expect.objectContaining({ id: 'first', text: '第一段 继续', reason: 'pause' }),
  ]);
});
it('句子提交保持continuation关系，已合并前缀不会重复进入后续文字', async () => {
  const f = qwen();
  f.receive({ type: 'tail_final', reason: 'pause', text: '第一段' });
  await f.feed(128);
  f.receive({ type: 'speech_start', audio_ms: 1920 });
  f.receive({
    type: 'committed',
    text: '第二段',
    cut_ms: 2400,
    audio_ms: 2600,
    window_start_ms: 1792,
    tail: '后续',
  });
  expect(f.finals()).toEqual([
    expect.objectContaining({ id: 'first', text: '第一段 第二段', reason: 'sentence' }),
  ]);
  expect(f.events.at(-1)).toMatchObject({
    type: 'segment',
    segment: { text: '后续', continuationOf: 'first', final: false },
  });
});
it('连续短停顿合并仍受6000字符和120秒逻辑turn限制，limit不当作可交接静音', async () => {
  for (const [text, audio_ms] of [
    ['b'.repeat(2500), 2400],
    ['继续', 121024],
  ] as const) {
    const f = qwen();
    f.receive({ type: 'tail_final', reason: 'pause', text: 'a'.repeat(4000) });
    await f.feed(128);
    f.receive({ type: 'speech_start', audio_ms: 1920 });
    f.receive({ type: 'partial', text, audio_ms, window_start_ms: 1792 });
    expect(f.finals()).toEqual([
      expect.objectContaining({ text: 'a'.repeat(4000), reason: 'limit' }),
    ]);
    expect(f.finals()[0]).not.toHaveProperty('silenceStartMs');
    expect(f.engine.canSwitch('system')).toBe(false);
  }
});
it('持续RMS背景声没有原生speech_start确认时不滚动延后静音，1.128秒内终稿', async () => {
  const f = qwen();
  f.receive({ type: 'tail_final', reason: 'pause' });
  await f.feed(200, 0.02);
  expect(f.finals()).toEqual([]);
  expect(f.engine.canSwitch('system')).toBe(false);
  await f.feed(120, 0.02);
  expect(f.engine.processedThrough('system')! - 1992).toBeLessThanOrEqual(1128);
  expect(f.finals()).toEqual([
    expect.objectContaining({ id: 'first', reason: 'silence', silenceStartMs: 1992 }),
  ]);
  expect(f.engine.canSwitch('system')).toBe(true);
  await f.feed(1024, 0.02);
  expect(f.finals()).toHaveLength(1);
});
