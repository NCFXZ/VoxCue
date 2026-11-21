import { expect, it, vi } from 'vitest';
import { SpeechEngine } from '../../electron/backend/speech/engine';
import { SampleBuffer } from '../../electron/backend/speech/buffer';
import type { AudioSource, SpeechEvent } from '../../electron/contracts/speech';

// Fake model bindings expose the exact samples admitted to each ASR stream.
// No native recognizer, resampler, VAD or model is constructed by this fixture.
function fixture() {
  const events: SpeechEvent[] = [];
  const streams: Array<{
    chunks: Float32Array[];
    markers: Set<number>;
    acceptWaveform: ReturnType<typeof vi.fn>;
    inputFinished: ReturnType<typeof vi.fn>;
  }> = [];
  const createStream = vi.fn(() => {
    const chunks: Float32Array[] = [],
      markers = new Set<number>();
    const stream = {
      chunks,
      markers,
      acceptWaveform: vi.fn(({ samples }: { samples: Float32Array }) => {
        chunks.push(samples.slice());
        for (const sample of samples) if (sample) markers.add(sample);
      }),
      inputFinished: vi.fn(),
    };
    streams.push(stream);
    return stream;
  });
  const recognizer = {
    createStream,
    isReady: vi.fn(() => false),
    decode: vi.fn(),
    getResult: vi.fn((stream: (typeof streams)[number]) => ({
      text: [...stream.markers]
        .map((marker) => (marker === 1 ? 'um' : marker === 2 ? 'question' : String(marker)))
        .join(' '),
    })),
  };
  const state = (origin: number) => {
    const current = {
      rate: 16000,
      resampler: {
        resample: (samples: Float32Array) => samples,
        flush: vi.fn(() => new Float32Array()),
      },
      buffer: new SampleBuffer(32000),
      preRoll: new SampleBuffer(8000),
      vad: {
        acceptWaveform: vi.fn(() => {}),
        isDetected: () => current.detected,
        isEmpty: () => true,
      },
      stream: undefined,
      id: 'initial-' + origin,
      samples: 0,
      origin,
      start: origin,
      active: false,
      text: '',
      lastEmit: 0,
      detected: false,
    };
    return current;
  };
  const sources = new Map<AudioSource, ReturnType<typeof state>>([
    ['system', state(1000)],
    ['microphone', state(9000)],
  ]);
  const engine = Object.create(SpeechEngine.prototype) as SpeechEngine;
  Object.assign(engine, {
    audioMs: 0,
    inferenceMs: 0,
    sources,
    recognizer,
    emit: (event: SpeechEvent) => events.push(event),
  });
  const raw = (source: AudioSource, samples: Float32Array) => {
    const s = sources.get(source)!;
    engine.feed(source, samples, s.rate, s.origin + s.samples / 16);
  };
  const feed = (source: AudioSource, value: number, detected: boolean, frames = 1) => {
    sources.get(source)!.detected = detected;
    for (let frame = 0; frame < frames; frame++) raw(source, new Float32Array(512).fill(value));
  };
  const pcm = (stream: (typeof streams)[number]) => stream.chunks.flatMap((chunk) => [...chunk]);
  const finals = () => events.filter((event) => event.type === 'segment' && event.segment.final);
  return { engine, events, streams, sources, recognizer, raw, feed, pcm, finals, state };
}

it('keeps unconfirmed input bounded without creating or decoding a silent ASR stream', () => {
  const f = fixture();
  f.feed('system', 1, false, 400);
  expect(f.recognizer.createStream).not.toHaveBeenCalled();
  expect(f.recognizer.getResult).not.toHaveBeenCalled();
  expect(f.sources.get('system')!.preRoll.length).toBe(8000);
  expect(f.sources.get('system')!.buffer.length).toBe(0);
  expect(f.sources.get('system')!.stream).toBeUndefined();
  expect(f.engine.processedThrough('system')).toBe(13800);
  expect(f.engine.audioMs).toBe(12800);
  expect(f.engine.canSwitch('system')).toBe(true);
  expect(f.events.some((event) => event.type === 'activity')).toBe(true);
  expect(f.events.some((event) => event.type === 'segment' || event.type === 'speech-start')).toBe(
    false,
  );
});

it('admits exactly 500ms history plus the onset frame once, with matching audio timestamps', () => {
  const f = fixture();
  const history: number[] = [];
  for (let value = 1; value <= 20; value++) {
    f.feed('system', value, false);
    history.push(...new Float32Array(512).fill(value));
  }
  f.feed('system', 21, true);
  expect(f.streams).toHaveLength(1);
  expect(f.pcm(f.streams[0])).toEqual([...history.slice(-8000), ...new Float32Array(512).fill(21)]);
  expect(f.sources.get('system')!.preRoll.length).toBe(0);
  expect(f.events.filter((event) => event.type === 'speech-start')).toEqual([
    { type: 'speech-start', source: 'system' },
  ]);
  expect(f.events.find((event) => event.type === 'segment')).toMatchObject({
    segment: { startMs: 1140, endMs: 1672, final: false },
  });
  f.feed('system', 22, true);
  f.feed('system', 23, false);
  expect(f.pcm(f.streams[0])).toEqual([
    ...history.slice(-8000),
    ...new Float32Array(512).fill(21),
    ...new Float32Array(512).fill(22),
    ...new Float32Array(512).fill(23),
    ...new Float32Array(6400),
  ]);
  expect(f.streams[0].inputFinished).toHaveBeenCalledOnce();
  expect(f.finals()).toMatchObject([
    { segment: { startMs: 1140, endMs: 1736, silenceStartMs: 1236, reason: 'silence' } },
  ]);
  expect(f.engine.processedThrough('system')).toBe(1736);
});

it('keeps the opening audio when VAD confirms two frames later after a short sound', () => {
  const f = fixture();
  f.feed('system', 0, false, 30);
  f.feed('system', 6, false);
  f.feed('system', 2, false, 8);
  f.feed('system', 2, true);
  expect(f.streams).toHaveLength(1);
  expect(f.pcm(f.streams[0]).filter((value) => value === 6)).toHaveLength(512);
  expect(f.pcm(f.streams[0]).filter((value) => value === 2)).toHaveLength(9 * 512);
  expect(f.events.find((event) => event.type === 'segment')).toMatchObject({
    segment: { text: '6 question', startMs: 1748, endMs: 2280 },
  });
});

it.each([20, 100])(
  'cannot carry an unconfirmed short filler across %i silent frames into a later confirmed question',
  (quietFrames) => {
    const f = fixture();
    f.feed('system', 1, false, 2);
    f.feed('system', 0, false, quietFrames);
    f.feed('system', 2, false, 7);
    expect(f.streams).toEqual([]);
    f.feed('system', 2, true);
    f.feed('system', 2, true, 2);
    f.feed('system', 0, false);
    expect(f.streams).toHaveLength(1);
    expect(f.streams[0].markers).toEqual(new Set([2]));
    expect(f.pcm(f.streams[0]).filter((value) => value === 2)).toHaveLength(10 * 512);
    expect(f.finals()).toMatchObject([{ segment: { text: 'question', reason: 'silence' } }]);
    expect(f.sources.get('system')!.stream).toBeUndefined();
    expect(f.sources.get('system')!.preRoll.length).toBe(0);
  },
);

it.each(['pause', 'stop'] as const)(
  'flush %s discards only unconfirmed audio without starting recognition',
  (reason) => {
    const f = fixture();
    f.feed('system', 1, false);
    f.raw('system', new Float32Array(100).fill(1));
    f.sources.get('system')!.resampler.flush.mockReturnValue(new Float32Array(64).fill(1));
    f.engine.flush(reason);
    expect(f.streams).toEqual([]);
    expect(f.finals()).toEqual([]);
    expect(f.engine.processedThrough('system')).toBeUndefined();
  },
);

it.each(['pause', 'stop'] as const)(
  'flush %s preserves the active partial frame and resampler tail before padding',
  (reason) => {
    const f = fixture();
    f.feed('system', 2, true);
    f.raw('system', new Float32Array(100).fill(3));
    f.sources.get('system')!.resampler.flush.mockReturnValue(new Float32Array(64).fill(4));
    f.engine.flush(reason);
    expect(f.streams[0].chunks.map((chunk) => chunk.length)).toEqual([512, 164, 6400]);
    expect([...f.streams[0].chunks[1]]).toEqual([
      ...new Float32Array(100).fill(3),
      ...new Float32Array(64).fill(4),
    ]);
    expect(f.streams[0].inputFinished).toHaveBeenCalledOnce();
    expect(f.finals()).toMatchObject([{ segment: { text: 'question 3 4', reason, endMs: 1032 } }]);
    expect(f.engine.processedThrough('system')).toBeUndefined();
  },
);

it('retires one active source at a gap without moving its pre-roll or stream into the other source', () => {
  const f = fixture();
  f.feed('system', 2, true);
  f.feed('microphone', 4, true);
  const microphone = f.sources.get('microphone');
  f.engine.discontinuity('system');
  expect(f.sources.has('system')).toBe(false);
  expect(f.sources.get('microphone')).toBe(microphone);
  expect(f.streams[1].inputFinished).not.toHaveBeenCalled();
  expect(f.finals()).toMatchObject([
    { segment: { source: 'system', reason: 'discontinuity', text: 'question' } },
  ]);
  f.sources.set('system', f.state(15000));
  f.feed('system', 5, true);
  expect(f.streams[2].markers).toEqual(new Set([5]));
  f.engine.discard('microphone');
  expect(f.streams[1].inputFinished).not.toHaveBeenCalled();
  f.engine.flush('stop');
  expect(f.finals()).toMatchObject([
    { segment: { source: 'system', reason: 'discontinuity', text: 'question' } },
    { segment: { source: 'system', reason: 'stop', text: '5', startMs: 15000 } },
  ]);
});

it('a gap or soft mute drops unconfirmed pre-roll without decoding or finalizing it', () => {
  const f = fixture();
  f.feed('system', 1, false);
  f.feed('microphone', 4, false);
  f.engine.discontinuity('system');
  f.engine.discard('microphone');
  expect(f.sources.size).toBe(0);
  expect(f.streams).toEqual([]);
  expect(f.events.some((event) => event.type === 'segment')).toBe(false);
});

it('preserves the 20-second active limit and starts a clean continuation stream', () => {
  const f = fixture();
  f.feed('system', 2, true, 625);
  expect(f.finals()).toMatchObject([{ segment: { reason: 'limit', startMs: 1000, endMs: 21000 } }]);
  expect(f.sources.get('system')!.active).toBe(false);
  f.feed('system', 3, true);
  expect(f.streams).toHaveLength(2);
  expect(f.streams[1].markers).toEqual(new Set([3]));
  f.engine.flush('stop');
  expect(f.finals()).toMatchObject([
    { segment: { reason: 'limit', text: 'question' } },
    { segment: { reason: 'stop', text: '3', startMs: 21000, endMs: 21032 } },
  ]);
});
