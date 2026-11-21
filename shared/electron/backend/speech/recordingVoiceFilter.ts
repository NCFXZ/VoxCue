// Keep microphone filter history across packets on a recording-only copy.
class Biquad {
  private z1 = 0;
  private z2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(rate: number, frequency: number, q: number, highpass = false) {
    const omega = (2 * Math.PI * frequency) / rate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = (highpass ? (1 + cosine) / 2 : 1) / a0;
    this.a1 = (-2 * cosine) / a0;
    this.b1 = highpass ? -2 * this.b0 : this.a1;
    this.a2 = (1 - alpha) / a0;
  }

  apply(samples: Float32Array) {
    let z1 = this.z1, z2 = this.z2;
    for (let i = 0; i < samples.length; i++) {
      const input = samples[i];
      const output = this.b0 * input + z1;
      z1 = this.b1 * input - this.a1 * output + z2;
      z2 = this.b0 * input - this.a2 * output;
      samples[i] = output;
    }
    this.z1 = z1;
    this.z2 = z2;
  }
}

export class RecordingVoiceFilter {
  private readonly sections: Biquad[];
  private readonly attack: number;
  private readonly release: number;
  private envelope = 0;

  constructor(readonly rate: number) {
    // Remove rumble and narrow 50/60 Hz mains tones and their first harmonics.
    this.sections = [new Biquad(rate, 70, Math.SQRT1_2, true),
      ...[50, 60, 100, 120].map(hz => new Biquad(rate, hz, 16))];
    this.attack = 1 - Math.exp(-1 / (0.001 * rate));
    this.release = 1 - Math.exp(-1 / (0.18 * rate));
  }

  process(input: Float32Array) {
    const output = input.slice();
    for (const section of this.sections) section.apply(output);
    // Gently attenuate the noise floor between phrases, with fast attack for
    // consonants and a long release through short pauses. Never hard-gate.
    let envelope = this.envelope;
    for (let i = 0; i < output.length; i++) {
      const amplitude = Math.abs(output[i]);
      envelope += (amplitude > envelope ? this.attack : this.release) * (amplitude - envelope);
      const openness = Math.max(0, Math.min(1, (envelope - 0.0015) / 0.0055));
      output[i] *= 0.65 + 0.35 * openness;
    }
    this.envelope = envelope;
    return output;
  }
}
