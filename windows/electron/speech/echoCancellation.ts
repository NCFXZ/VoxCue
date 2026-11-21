import loadWebRtcAec3 from '@ennuicastr/webrtcaec3.js';
import type { AudioSource } from '../../../shared/electron/contracts/speech';
import type {
  AudioPreprocessor,
  ConsumeAudio,
} from '../../../shared/electron/backend/speech/preprocessor';
import { SampleBuffer } from '../../../shared/electron/backend/speech/buffer';

// Official sherpa resampler already used by ASR; no microphone/device access here.
const sherpa = require('sherpa-onnx-node');
type Module = Awaited<ReturnType<typeof loadWebRtcAec3>>;
const rate = 48000,
  frameSize = 480,
  waitMs = 80;
interface Frame {
  samples: Float32Array;
  clock: number;
  wall: number;
  queued: number;
  length: number;
  tail?: boolean;
}
interface Lane {
  rate: number;
  resampler?: any;
  buffer: SampleBuffer;
  clock: number;
  wall: number;
  input: number;
  output: number;
  drift: number;
  wallDrift: number;
  trusted: boolean;
  packetTrusted: boolean;
}

export class EchoCancellation implements AudioPreprocessor {
  private aec?: InstanceType<Module['AEC3']>;
  private lanes = new Map<AudioSource, Lane>();
  private render: Frame[] = [];
  private capture: Frame[] = [];
  private lastRender = -Infinity;
  private lastSignal = -Infinity;
  private timer?: NodeJS.Timeout;
  private raw?: SampleBuffer;
  private skip = 0;
  private emitted = 0;
  private lastMic?: Frame;
  private lastActive = false;
  private echoOnly = false;
  private echoEstablished = false;
  private nearHoldSamples = 0;
  private readonly latency: number;
  constructor(
    private module: Module,
    private consume: ConsumeAudio,
    private failure: () => void,
  ) {
    // Measure the pinned DSP's fixed filter delay with a local synthetic impulse.
    // Align bypass and processed audio, and drain that delay on stop so the last
    // syllable is retained. This never touches an audio device.
    const probe = new module.AEC3(rate, 1, 1);
    let peak = 0,
      latency = 0;
    try {
      for (let frame = 0; frame < 3; frame++) {
        const input = new Float32Array(frameSize);
        if (!frame) input[0] = 0.5;
        const output = [new Float32Array(frameSize)];
        probe.analyze([new Float32Array(frameSize)]);
        probe.process(output, [input]);
        for (let i = 0; i < frameSize; i++)
          if (Math.abs(output[0][i]) > peak) {
            peak = Math.abs(output[0][i]);
            latency = frame * frameSize + i;
          }
      }
    } finally {
      probe.free();
    }
    if (peak < 0.1 || latency >= frameSize * 2) throw Error('Invalid AEC filter latency');
    this.latency = latency;
  }

  start(sources: AudioSource[]) {
    this.close();
    // Dictation/microphone-only and system-only sessions retain their original path.
    if (sources.includes('microphone') && sources.includes('system')) {
      this.aec = new this.module.AEC3(rate, 1, 1);
      this.raw = new SampleBuffer(frameSize + this.latency);
      this.raw.push(new Float32Array(this.latency));
      this.skip = this.latency;
    }
  }

  feed(
    source: AudioSource,
    samples: Float32Array,
    inputRate: number,
    timestamp: number,
    captureClock?: number,
  ) {
    if (!this.aec) {
      this.consume(source, samples, inputRate, timestamp);
      return;
    }
    if (
      !Number.isFinite(timestamp) ||
      (captureClock !== undefined && !Number.isFinite(captureClock)) ||
      !Number.isInteger(inputRate) ||
      inputRate < 8000 ||
      inputRate > 192000 ||
      samples.length > inputRate * 1.1 ||
      !samples.every(Number.isFinite)
    )
      throw Error('Invalid echo cancellation input');
    // The interviewer lane is never filtered, delayed or changed by AEC.
    if (source === 'system') this.consume(source, samples, inputRate, timestamp);
    let lane = this.lanes.get(source);
    if (!lane) {
      lane = {
        rate: inputRate,
        resampler: inputRate === rate ? undefined : new sherpa.LinearResampler(inputRate, rate),
        buffer: new SampleBuffer(rate * 2),
        clock: captureClock ?? timestamp,
        wall: timestamp,
        input: 0,
        output: 0,
        drift: 0,
        wallDrift: 0,
        trusted: captureClock !== undefined,
        packetTrusted: captureClock !== undefined,
      };
      this.lanes.set(source, lane);
    }
    if (lane.rate !== inputRate) throw Error('Echo cancellation input rate changed');
    // TIMESTAMP_ERROR packets and host silence cannot align separate devices.
    // Keep the resampler and output rate continuous, but bypass untrusted frames.
    // A partial frame touching either untrusted packet remains untrusted.
    lane.packetTrusted = captureClock !== undefined;
    lane.trusted = lane.buffer.length ? lane.trusted && lane.packetTrusted : lane.packetTrusted;
    // Both WASAPI sources report the first sample's QPC in milliseconds. Keep that shared clock for
    // reference alignment; the separate wall clock remains the transcript time.
    const elapsed = (lane.input / lane.rate) * 1000;
    lane.drift = captureClock === undefined ? lane.drift : captureClock - lane.clock - elapsed;
    lane.wallDrift = timestamp - lane.wall - elapsed;
    lane.input += samples.length;
    lane.buffer.push(lane.resampler ? lane.resampler.resample(samples) : samples);
    this.frames(source, lane);
    this.drain();
  }

  private frames(source: AudioSource, lane: Lane, partial = false) {
    while (lane.buffer.length >= frameSize || (partial && lane.buffer.length)) {
      const length = Math.min(frameSize, lane.buffer.length);
      const samples = lane.buffer.take(length, frameSize);
      const elapsed = (lane.output / rate) * 1000;
      const frame = {
        samples,
        length,
        clock: lane.trusted ? lane.clock + elapsed + lane.drift : NaN,
        wall: lane.wall + elapsed + lane.wallDrift,
        queued: performance.now(),
      };
      lane.output += length;
      lane.trusted = lane.packetTrusted;
      if (source === 'system') {
        if (Number.isFinite(frame.clock)) this.render.push(frame);
        else {
          this.render = [];
          this.lastRender = this.lastSignal = -Infinity;
        }
        // Reference history only; original system audio has already reached ASR.
        while (this.render.length > 100) this.render.shift();
      } else this.capture.push(frame);
    }
  }

  private drain(force = false) {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.aec) return;
    while (this.capture.length) {
      const mic = this.capture[0];
      const latest = this.render.at(-1)?.clock ?? this.lastRender;
      if (
        !force &&
        latest + 10 < mic.clock - 5 &&
        this.capture.length <= 8 &&
        performance.now() - mic.queued < waitMs
      )
        break;
      while (this.render.length && this.render[0].clock <= mic.clock + 5) {
        const reference = this.render.shift()!;
        this.aec.analyze([reference.samples]);
        this.lastRender = reference.clock;
        let power = 0;
        for (const n of reference.samples) power += n * n;
        if (power / frameSize > 1e-9) this.lastSignal = reference.clock + 10;
      }
      const aligned = Math.abs(this.lastRender - mic.clock) <= 15;
      // Missing reference never stalls or mutes the user's voice. Feed silence
      // to the adaptive engine and bypass its result until reference is usable.
      if (!aligned) this.aec.analyze([new Float32Array(frameSize)]);
      const output = [new Float32Array(frameSize)];
      if (this.aec.processSize([mic.samples]) !== frameSize) throw Error('Invalid AEC frame size');
      this.aec.process(output, [mic.samples]);
      if (!output[0].every(Number.isFinite)) throw Error('Invalid AEC output');
      const active = mic.tail ? this.lastActive : aligned && mic.clock <= this.lastSignal + 500;
      this.raw!.push(mic.samples);
      const original = this.raw!.take(frameSize);
      const valid = mic.tail
        ? mic.length
        : Math.min(frameSize, mic.length + (mic.length < frameSize ? this.latency : 0));
      const skip = Math.min(this.skip, valid);
      this.skip -= skip;
      const raw = original.subarray(skip, valid);
      const samples = active ? output[0].subarray(skip, valid) : raw;
      if (raw.length) {
        // Only a trusted playback reference can exclude a mic frame from ASR.
        // Use AEC's time-aligned residual to distinguish loudspeaker-only
        // frames from a local voice. Keep the raw voice and the original clock.
        if (!active) {
          this.echoEstablished = false;
          this.nearHoldSamples = 0;
        }
        this.echoOnly = active && this.isPlaybackEcho(raw, samples, mic.clock - this.lastSignal);
        const recognition = this.echoOnly ? new Float32Array(raw.length) : raw;
        const timestamp = mic.wall + ((skip - this.latency) / rate) * 1000;
        this.consume('microphone', samples, rate, timestamp, recognition);
      }
      this.emitted += samples.length;
      this.lastMic = mic;
      this.lastActive = active;
      this.capture.shift();
    }
    if (this.capture.length)
      this.timer = setTimeout(
        () => {
          try {
            this.drain();
          } catch {
            this.close();
            this.failure();
          }
        },
        Math.max(1, waitMs - (performance.now() - this.capture[0].queued)),
      );
  }

  private isPlaybackEcho(raw: Float32Array, residual: Float32Array, sincePlaybackMs: number) {
    let inputEnergy = 0;
    let residualEnergy = 0;
    let cross = 0;
    for (let i = 0; i < raw.length; i++) {
      inputEnergy += raw[i] * raw[i];
      residualEnergy += residual[i] * residual[i];
      cross += raw[i] * residual[i];
    }
    // Protect a quiet local syllable through brief peaks in the soundtrack.
    // Allow the room echo to decay before treating a gap as evidence of local speech.
    const minVoiceEnergy = raw.length * 0.003 ** 2;
    const nearDominant =
      residualEnergy > inputEnergy * 0.55 &&
      residualEnergy > minVoiceEnergy &&
      cross > 0 && cross * cross > 0.65 * inputEnergy * residualEnergy;
    if (this.echoEstablished && sincePlaybackMs >= 80 && nearDominant) {
      this.nearHoldSamples = rate * 0.2;
    } else {
      this.nearHoldSamples = Math.max(0, this.nearHoldSamples - raw.length);
    }
    // Enter only after strong cancellation. Hysteresis prevents a sequence of
    // slightly louder residual frames from reopening a speaker-only passage.
    const echo = residualEnergy < inputEnergy * (this.echoOnly ? 0.12 : 0.05);
    if (echo && inputEnergy > minVoiceEnergy) this.echoEstablished = true;
    return this.nearHoldSamples === 0 && echo;
  }

  flush() {
    if (this.aec) {
      // Flush resamplers and the final sub-10ms microphone tail before ASR closes.
      for (const source of ['system', 'microphone'] as const) {
        const lane = this.lanes.get(source);
        if (!lane) continue;
        if (lane.resampler) lane.buffer.push(lane.resampler.flush(new Float32Array()));
        this.frames(source, lane, true);
      }
      this.drain(true);
      const total = this.lanes.get('microphone')?.output ?? 0;
      while (this.lastMic && this.emitted < total) {
        const previous = this.lastMic;
        this.capture.push({
          samples: new Float32Array(frameSize),
          length: Math.min(frameSize, total - this.emitted + this.skip),
          clock: previous.clock + 10,
          wall: previous.wall + 10,
          queued: 0,
          tail: true,
        });
        this.drain(true);
      }
    }
    this.close();
  }

  discontinuity(source: AudioSource): AudioSource[] {
    const enabled = !!this.aec;
    this.flush();
    const sources: AudioSource[] = enabled ? ['system', 'microphone'] : [source];
    this.start(sources);
    return sources;
  }

  close() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.aec?.free();
    this.aec = undefined;
    this.lanes.clear();
    this.render = [];
    this.capture = [];
    this.lastRender = this.lastSignal = -Infinity;
    this.raw = undefined;
    this.skip = this.emitted = 0;
    this.lastMic = undefined;
    this.lastActive = false;
    this.echoOnly = false;
    this.echoEstablished = false;
    this.nearHoldSamples = 0;
  }
}

let modulePromise: Promise<Module> | undefined;
export async function createAudioPreprocessor(consume: ConsumeAudio, failure: () => void) {
  // All code/wasm is installed locally with a pinned integrity; no network loader.
  return new EchoCancellation(await (modulePromise ??= loadWebRtcAec3()), consume, failure);
}
