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
            isDetected: () => frames < 25,
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
  engine.feed('system', new Float32Array(12800), 16000, 2800);
  const final = events.find((event) => event.type === 'segment' && event.segment.final);
  expect(final).toMatchObject({
    type: 'segment',
    segment: {
      endMs: 2800,
      silenceStartMs: 2000,
      reason: 'silence',
      text: '合成问题',
    },
  });
  expect(stream.inputFinished).toHaveBeenCalledOnce();
  expect(engine.processedThrough('system')).toBe(2800);
});
it('Qwen原生800ms端点与Paraformer共用静音起点，不使用结果到达时间', () => {
  const events: SpeechEvent[] = [];
  const engine = Object.create(QwenEngine.prototype) as QwenEngine;
  Object.assign(engine, {
    inferenceMs: 0,
    emit: (event: SpeechEvent) => events.push(event),
    sources: new Map([
      ['system', { id: 'first', origin: 1000, start: 0, rate: 16000, samples: 28800 }],
    ]),
  });
  (engine as any).receive({
    type: 'tail_final',
    session: 'system',
    reason: 'pause',
    text: '合成问题',
    audio_ms: 1792,
    window_start_ms: 0,
  });
  expect(events[0]).toMatchObject({
    type: 'segment',
    segment: {
      endMs: 2792,
      silenceStartMs: 1992,
      reason: 'silence',
      speechModel: 'qwen',
    },
  });
  expect(engine.processedThrough('system')).toBe(2792);
});
it('Qwen只确认已完成的512采样帧，未完成的推理和PCM尾部不增加静音进度', async () => {
  let done!: () => void;
  const engine = Object.create(QwenEngine.prototype) as QwenEngine;
  Object.assign(engine, {
    audioMs: 0,
    emit: () => {},
    sources: new Map([
      ['system', { id: 'first', origin: 1000, start: 0, rate: 16000, samples: 0 }],
    ]),
    accept: () =>
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
it('Qwen四句固定和安全上限终稿不构成切换停顿，只有VAD静音终稿可交接', () => {
  const engine = Object.create(QwenEngine.prototype) as QwenEngine;
  Object.assign(engine, {
    inferenceMs: 0,
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
  expect(engine.canSwitch('system')).toBe(true);
});
