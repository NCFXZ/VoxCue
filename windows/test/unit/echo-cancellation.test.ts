import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createAudioPreprocessor } from '../../electron/speech/echoCancellation';
import type { AudioPreprocessor } from '../../../shared/electron/backend/speech/preprocessor';
import type { AudioSource } from '../../../shared/electron/contracts/speech';

const processors: AudioPreprocessor[] = [];
async function processor() {
  const packets: { source: AudioSource; samples: Float32Array; rate: number; time: number }[] = [];
  const failure = vi.fn();
  const dsp = await createAudioPreprocessor((source, samples, rate, time) => {
    packets.push({ source, samples: samples.slice(), rate, time });
  }, failure);
  processors.push(dsp);
  const audio = (source: AudioSource) => {
    const chunks = packets.filter((p) => p.source === source).map((p) => p.samples);
    const result = new Float32Array(chunks.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  };
  return { dsp, packets, failure, audio };
}
afterEach(() => {
  for (const dsp of processors.splice(0)) dsp.close();
  vi.useRealTimers();
});
beforeAll(async () => {
  // Load the actual local WASM, including under the suite's offline network guard.
  const { dsp } = await processor();
  dsp.close();
});
function waveform(length: number) {
  const signal = new Float32Array(length);
  let seed = 7,
    low = 0;
  for (let i = 0; i < length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    low = 0.85 * low + 0.15 * (seed / 2147483648 - 1);
    signal[i] = low * 0.5 * (0.65 + 0.35 * Math.sin((2 * Math.PI * 3 * i) / 48000));
  }
  return signal;
}

it('suppresses delayed whole-system playback while retaining an independent simultaneous voice', async () => {
  const { dsp, audio } = await processor();
  const rate = 48000,
    length = rate * 15;
  const system = waveform(length),
    near = new Float32Array(length),
    mic = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const fundamental = 145 + 18 * Math.sin(t * 3);
    phase += (2 * Math.PI * fundamental) / rate;
    if (t >= 8 && t < 12) {
      let voice = 0;
      for (let harmonic = 1; harmonic <= 20; harmonic++)
        voice +=
          (Math.sin(phase * harmonic) * Math.exp(-(((harmonic * fundamental - 750) / 600) ** 2))) /
          Math.sqrt(harmonic);
      near[i] = 0.12 * voice * Math.max(0, Math.sin(Math.PI * 4 * t));
    }
    // Two speaker/reflection paths with 50ms and 56.25ms acoustic delay.
    mic[i] = near[i] + 0.6 * (system[i - 2400] ?? 0) + 0.2 * (system[i - 2700] ?? 0);
  }
  dsp.start(['system', 'microphone']);
  for (let i = 0; i < length; i += 480) {
    dsp.feed('system', system.subarray(i, i + 480), rate, 1000 + i / 48, i / 48);
    dsp.feed('microphone', mic.subarray(i, i + 480), rate, 1000 + i / 48, i / 48);
  }
  dsp.flush();
  const output = audio('microphone');
  expect(audio('system')).toEqual(system);
  expect(output.length).toBe(length);
  let echo = 0,
    residual = 0,
    voice = 0,
    result = 0,
    cross = 0;
  for (let i = rate * 5; i < rate * 7; i++) {
    echo += mic[i] ** 2;
    residual += output[i] ** 2;
  }
  for (let i = rate * 9; i < rate * 11; i++) {
    voice += near[i] ** 2;
    result += output[i] ** 2;
    cross += near[i] * output[i];
  }
  const erle = 10 * Math.log10(echo / residual);
  const gain = cross / voice,
    correlation = cross / Math.sqrt(voice * result);
  console.log('Synthetic AEC metrics', { erle, gain, correlation });
  expect(erle).toBeGreaterThan(12);
  expect(gain).toBeGreaterThan(0.55);
  expect(correlation).toBeGreaterThan(0.8);
});

it.each([1, 50, 100, 479, 480, 481, 941, 960, 967])(
  'preserves all %i near-only samples and their final tail',
  async (length) => {
    const { dsp, audio, packets } = await processor();
    const mic = waveform(length);
    dsp.start(['system', 'microphone']);
    for (let i = 0; i < length; i += 480) {
      dsp.feed('system', new Float32Array(Math.min(480, length - i)), 48000, 1000 + i / 48, i / 48);
      dsp.feed('microphone', mic.subarray(i, i + 480), 48000, 1000 + i / 48, i / 48);
    }
    dsp.flush();
    expect(audio('microphone')).toEqual(mic);
    const first = packets.find((p) => p.source === 'microphone');
    expect(first?.time).toBeCloseTo(1000, 5);
  },
);

it('retains a near voice with unrelated playback, reordered delivery and independent wall clocks', async () => {
  const { dsp, audio, packets } = await processor();
  const length = 48000 * 7;
  const system = waveform(length);
  const near = Float32Array.from(
    { length },
    (_, i) =>
      (0.1 * Math.sin(i * 0.019) + 0.06 * Math.sin(i * 0.039)) *
      Math.max(0, Math.sin((4 * Math.PI * i) / 48000)),
  );
  dsp.start(['system', 'microphone']);
  for (let i = 0; i < length; i += 480) {
    const feedSystem = () =>
      dsp.feed('system', system.subarray(i, i + 480), 48000, 2000 + i / 48, 7000 + i / 48);
    const feedMic = () =>
      dsp.feed('microphone', near.subarray(i, i + 480), 48000, 1000 + i / 48, 7000 + i / 48);
    if (i % 960) {
      feedMic();
      feedSystem();
    } else {
      feedSystem();
      feedMic();
    }
  }
  dsp.flush();
  const output = audio('microphone');
  expect(output).toHaveLength(length);
  expect(packets.find((p) => p.source === 'microphone')?.time).toBeCloseTo(1000, 5);
  let original = 0,
    processed = 0,
    cross = 0;
  for (let i = 96000; i < length; i++) {
    original += near[i] ** 2;
    processed += output[i] ** 2;
    cross += near[i] * output[i];
  }
  expect(cross / original).toBeGreaterThan(0.75);
  expect(cross / Math.sqrt(original * processed)).toBeGreaterThan(0.9);
});

it('passes single-source dictation/system audio through with the original rate and time', async () => {
  const { dsp, audio, packets } = await processor();
  for (const source of ['microphone', 'system'] as const) {
    dsp.start([source]);
    const input = waveform(123);
    dsp.feed(source, input, 16000, 321);
    dsp.flush();
    expect(audio(source)).toEqual(input);
    expect(packets.find((p) => p.source === source)).toMatchObject({ rate: 16000, time: 321 });
  }
});

it('waits briefly for reordered references, then bypasses absent references without losing voice', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const { dsp, audio, failure } = await processor();
  dsp.start(['system', 'microphone']);
  const mic = waveform(960);
  dsp.feed('microphone', mic.subarray(0, 480), 48000, 1000, 0);
  expect(audio('microphone')).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(40);
  dsp.feed('system', new Float32Array(480), 48000, 1000, 0);
  expect(audio('microphone').length).toBeGreaterThan(0);
  dsp.feed('microphone', mic.subarray(480), 48000, 1010, 10);
  await vi.advanceTimersByTimeAsync(81);
  dsp.flush();
  expect(audio('microphone')).toEqual(mic);
  const count = audio('microphone').length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(audio('microphone')).toHaveLength(count);
  expect(failure).not.toHaveBeenCalled();
});

it.each([16000, 44100, 48000, 96000])(
  'resamples %i Hz microphone independently of 48k system and drains across gaps',
  async (inputRate) => {
    const { dsp, audio, packets } = await processor();
    const inputLength = inputRate / 5 + 7;
    const mic = waveform(inputLength);
    dsp.start(['system', 'microphone']);
    dsp.feed('system', new Float32Array(9600), 48000, 7000, 900);
    dsp.feed('microphone', mic, inputRate, 7000, 900);
    expect(dsp.discontinuity('system')).toEqual(['system', 'microphone']);
    const expected = Math.ceil((inputLength * 48000) / inputRate);
    expect(Math.abs(audio('microphone').length - expected)).toBeLessThanOrEqual(1);
    expect(audio('microphone').every(Number.isFinite)).toBe(true);
    expect(packets.filter((p) => p.source === 'microphone').every((p) => p.rate === 48000)).toBe(
      true,
    );
    const before = audio('microphone').length;
    dsp.feed('microphone', new Float32Array(481).fill(0.1), 48000, 9000, 4000);
    dsp.flush();
    expect(audio('microphone').slice(before)).toEqual(new Float32Array(481).fill(0.1));
  },
);

it('rejects invalid active input, resets cleanly and closes pending timers idempotently', async () => {
  vi.useFakeTimers();
  const { dsp, audio, failure } = await processor();
  dsp.start(['system', 'microphone']);
  expect(() => dsp.feed('microphone', new Float32Array([NaN]), 48000, 0)).toThrow();
  expect(() => dsp.feed('microphone', new Float32Array(1), 7000, 0)).toThrow();
  expect(() => dsp.feed('microphone', new Float32Array(1), NaN, 0)).toThrow();
  dsp.feed('microphone', waveform(480), 48000, 0, 0);
  dsp.close();
  dsp.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(audio('microphone')).toHaveLength(0);
  expect(failure).not.toHaveBeenCalled();
});

it('bypasses invalid QPC packets without confusing independent wall clocks or losing queued tails', async () => {
  const { dsp, audio } = await processor();
  const a = waveform(481),
    b = waveform(237),
    c = waveform(967);
  dsp.start(['system', 'microphone']);
  dsp.feed('microphone', a, 48000, 1000, 987654);
  dsp.feed('microphone', b, 48000, 5000);
  dsp.feed('system', new Float32Array(480), 48000, 7000);
  dsp.feed('microphone', c, 48000, 8000, 988654);
  dsp.flush();
  expect(audio('microphone')).toEqual(Float32Array.from([...a, ...b, ...c]));
});

it('keeps reference alignment under 100ppm independent device drift and repeated reconnects', async () => {
  const { dsp, audio, failure } = await processor();
  let total = 0;
  for (let session = 0; session < 20; session++) {
    dsp.start(['system', 'microphone']);
    for (let packet = 0; packet < 20; packet++) {
      const clock = 123456 + session * 1000 + packet * 10;
      dsp.feed('system', new Float32Array(480), 48000, 7000 + packet * 10, clock);
      dsp.feed('microphone', waveform(480), 48000, 9000 + packet * 10, clock + packet * 0.001);
      total += 480;
    }
    dsp.flush();
  }
  expect(audio('microphone').length).toBe(total);
  expect(audio('microphone').every(Number.isFinite)).toBe(true);
  expect(failure).not.toHaveBeenCalled();
});

it('keeps the ASR input rate stable when 44.1kHz capture loses and recovers its QPC', async () => {
  const { dsp, audio, packets } = await processor();
  dsp.start(['system', 'microphone']);
  dsp.feed('microphone', waveform(441), 44100, 1000, 100);
  dsp.feed('microphone', waveform(441), 44100, 1010);
  dsp.feed('microphone', waveform(441), 44100, 1020, 120);
  dsp.flush();
  expect(audio('microphone')).toHaveLength(1440);
  expect(packets.filter((p) => p.source === 'microphone').every((p) => p.rate === 48000)).toBe(
    true,
  );
});

it.each([0, 120])(
  'cancels %ims acoustic delay across a 35ms startup offset and sustained device-clock drift',
  async (delayMs) => {
    const { dsp, audio } = await processor();
    const seconds = 20,
      count = 48000 * seconds,
      drift = 200 / 1e6;
    const reference = waveform(count + 48000);
    let renderOffset = 0,
      echoPower = 0;
    dsp.start(['system', 'microphone']);
    for (let offset = 0; offset < count; offset += 480) {
      const clock = 35 + (offset / 48) * (1 + drift);
      while (renderOffset / 48 <= clock + 10) {
        dsp.feed(
          'system',
          reference.subarray(renderOffset, renderOffset + 480),
          48000,
          1000 + renderOffset / 48,
          987654 + renderOffset / 48,
        );
        renderOffset += 480;
      }
      const input = Float32Array.from(
        { length: 480 },
        (_, i) => 0.6 * (reference[Math.round((clock - delayMs) * 48 + i * (1 + drift))] ?? 0),
      );
      if (offset >= 48000 * 15) for (const sample of input) echoPower += sample * sample;
      dsp.feed('microphone', input, 48000, 5000 + offset / 48, 987654 + clock);
    }
    dsp.flush();
    const output = audio('microphone');
    expect(output).toHaveLength(count);
    const remaining = output.subarray(48000 * 15).reduce((sum, n) => sum + n * n, 0);
    expect(10 * Math.log10(echoPower / remaining)).toBeGreaterThan(12);
  },
);
