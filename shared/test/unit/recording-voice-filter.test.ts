import { expect, it } from 'vitest';
import { RecordingVoiceFilter } from '../../electron/backend/speech/recordingVoiceFilter';

it.each([16000, 44100, 48000])('reduces mains hum under quiet speech and hiss between phrases at %i Hz', rate => {
  const tones = [50, 60, 100, 120];
  const sine = (hz: number, i: number) => Math.sin(2 * Math.PI * hz * i / rate);
  const input = Float32Array.from({ length: 2 * rate }, (_, i) =>
    0.018 * sine(650, i) + tones.reduce((sum, hz) => sum + 0.014 * sine(hz, i), 0));
  let seed = 1;
  for (let i = rate; i < input.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    input[i] = 0.003 * (seed / 2147483648 - 1);
  }
  const original = input.slice();
  const filter = new RecordingVoiceFilter(rate);
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 441)
    output.set(filter.process(input.subarray(i, i + 441)), i);
  expect(input.every((v, i) => v === original[i])).toBe(true);
  const onePacket = new RecordingVoiceFilter(rate).process(input);
  expect(output.every((v, i) => v === onePacket[i])).toBe(true);

  const amplitude = (hz: number) => {
    let sin = 0, cos = 0;
    for (let i = rate / 2; i < rate; i++) {
      sin += output[i] * sine(hz, i);
      cos += output[i] * Math.cos(2 * Math.PI * hz * i / rate);
    }
    return 4 * Math.hypot(sin, cos) / rate;
  };
  for (const hz of tones) expect(amplitude(hz)).toBeLessThan(0.014 * 0.1);
  expect(amplitude(650)).toBeGreaterThan(0.018 * 0.85);
  const power = (samples: Float32Array) => samples.subarray(1.8 * rate).reduce((sum, x) => sum + x * x, 0);
  const attenuationDb = 10 * Math.log10(power(input) / power(output));
  expect(attenuationDb).toBeGreaterThan(1);
  // Broadband attenuation is intentionally mild even when a signal is very quiet.
  expect(attenuationDb).toBeLessThan(4.5);
});

it('preserves soft consonants both after silence and in a fading syllable', () => {
  const rate = 16000;
  const input = Float32Array.from({ length: rate }, (_, i) => {
    const t = i / rate;
    if (t < 0.2 || t >= 0.85) return 0;
    if (t >= 0.3 && t < 0.6) return 0.04 * Math.sin(2 * Math.PI * 470 * t);
    return 0.0025 * Math.sin(2 * Math.PI * 2800 * t);
  });
  const output = new RecordingVoiceFilter(rate).process(input);
  for (const start of [0.21, 0.66, 0.80]) {
    const energy = (samples: Float32Array) =>
      samples.subarray(start * rate, (start + 0.03) * rate).reduce((sum, x) => sum + x * x, 0);
    expect(10 * Math.log10(energy(output) / energy(input))).toBeGreaterThan(-4);
  }
});
