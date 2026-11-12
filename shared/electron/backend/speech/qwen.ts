import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BoundedLineDecoder } from './buffer';
import type {
  AudioSource,
  SpeechEvent,
  SpeechSegment,
  SpeechInferenceDevice,
} from '../../contracts/speech';
import { speechSegmentationSilenceMs } from '../../contracts/speechSettings';
const sherpa = require('sherpa-onnx-node');
// The authenticated, pinned runtime still finalizes its native VAD at 800ms.
// Shared logical endpoints may wait longer; never move this native onset back.
const nativeSilenceMs = 800;
// Native onset needs 100ms of speech. Three frames of grace plus the shared
// deadline's frame rounding stay within 128ms of extra processed PCM.
const endpointGraceMs = 96;
const logicalTurnMs = 120000;
const logicalTextLimit = 6000;

interface Source {
  id: string;
  origin: number;
  start: number;
  rate: number;
  samples: number;
  active: boolean;
  resampler?: {
    resample(samples: Float32Array): Float32Array;
    flush(samples: Float32Array): Float32Array;
  };
  reason?: SpeechSegment['reason'];
  pendingSilence?: SpeechSegment;
  prefix?: Pick<SpeechSegment, 'text' | 'startMs' | 'endMs'>;
  soundFrames?: Array<{ start: number; end: number }>;
  frameSamples?: number;
  framePower?: number;
  awaitingSpeech?: number;
  deferred?: any[];
  quietBoundary?: { silenceStartMs: number };
}

/** Trusted fixed component only. PCM/transcripts stay in pipes and memory. */
export class QwenEngine {
  audioMs = 0;
  inferenceMs = 0;
  private child: ChildProcessWithoutNullStreams;
  private sources = new Map<AudioSource, Source>();
  private pending = new Map<
    number,
    { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >();
  private sequence = 0;
  private closed = false;
  private exited: Promise<void>;
  private constructor(
    directory: string,
    device: SpeechInferenceDevice,
    private emit: (event: SpeechEvent) => void,
    runtimeFile?: string,
  ) {
    if (process.platform !== 'win32' && (process.platform !== 'darwin' || !runtimeFile))
      throw Error('当前平台尚未接入 Qwen 原生推理。');
    const runtime =
      process.platform === 'darwin' ? path.dirname(runtimeFile!) : path.join(directory, 'runtime');
    this.child = spawn(
      process.platform === 'darwin'
        ? runtimeFile!
        : path.join(runtime, device === 'cpu' ? 'voxcue-qwen-cpu.exe' : 'voxcue-qwen.exe'),
      [directory, device],
      {
        cwd: runtime,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: runtime + path.delimiter + (process.env.PATH ?? ''),
          RAYON_NUM_THREADS: '4',
        },
      },
    );
    // Never forward native logs, audio or transcriptions to disk/logging sinks.
    this.child.stderr.resume();
    this.child.stdin.on('error', () => {
      // A write callback does not consume the stream's separate error event.
      this.reject();
      this.child.kill();
    });
    this.exited = new Promise((resolve) => {
      this.child.once('exit', () => {
        this.reject();
        resolve();
      });
      this.child.once('error', () => {
        this.reject();
        resolve();
      });
    });
    this.child.on('error', () => this.reject());
  }
  static async load(
    directory: string,
    device: SpeechInferenceDevice,
    emit: (event: SpeechEvent) => void,
    runtimeFile?: string,
  ) {
    const engine = new QwenEngine(directory, device, emit, runtimeFile);
    try {
      const metadata = await new Promise<{ chunkMs: number; alignmentDevice: string }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error('Qwen 模型加载超时，请检查内存和推理设备。')),
            180000,
          );
          const failed = () => {
            clearTimeout(timer);
            reject(Error('Qwen 启动失败，请检查本地组件、内存和所选推理设备。'));
          };
          engine.child.once('error', failed);
          engine.child.once('exit', failed);
          const lines = new BoundedLineDecoder(800000);
          let invalidOutput = false;
          const outputFailed = () => {
            if (invalidOutput) return;
            invalidOutput = true;
            engine.reject();
            failed();
            engine.child.kill();
          };
          const receive = (line: string) => {
            try {
              if (line.length > 200000) throw Error('Oversized Qwen result');
              const value = JSON.parse(line);
              if (value.type === 'error' && value.code === 'unsupported-cpu') {
                reject(Error('Qwen 需要支持 AVX2 和 FMA 的处理器，请改用 Paraformer。'));
                outputFailed();
                return;
              }
              if (value.type === 'error' && value.code === 'invalid-command') {
                outputFailed();
                return;
              }
              if (value.type === 'ready') {
                if (
                  ![500, 1000].includes(value.chunk_ms) ||
                  value.device !== device ||
                  (value.alignment_device !== 'cpu' &&
                    !(device === 'cuda' && value.alignment_device === 'cuda'))
                )
                  throw Error('Invalid Qwen device');
                clearTimeout(timer);
                engine.child.removeListener('error', failed);
                engine.child.removeListener('exit', failed);
                resolve({ chunkMs: value.chunk_ms, alignmentDevice: value.alignment_device });
              } else engine.receive(value);
            } catch {
              outputFailed();
            }
          };
          engine.child.stdout.on('data', (chunk: Buffer) => {
            if (invalidOutput) return;
            try {
              for (const line of lines.push(chunk)) {
                if (invalidOutput) break;
                receive(line);
              }
            } catch {
              outputFailed();
            }
          });
          engine.child.stdout.on('end', () => {
            const tail = lines.finish();
            if (!invalidOutput && tail) receive(tail);
          });
        },
      );
      return { engine, ...metadata };
    } catch (error) {
      await engine.close();
      throw error;
    }
  }
  private reject() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error('Qwen 推理进程已退出，请重新开始。'));
    }
    this.pending.clear();
  }
  private resumePending(state: Source) {
    if (!state.pendingSilence) return;
    state.prefix = {
      text: state.pendingSilence.text,
      startMs: state.pendingSilence.startMs,
      endMs: state.pendingSilence.endMs,
    };
    state.pendingSilence = undefined;
    state.awaitingSpeech = undefined;
    state.quietBoundary = undefined;
  }
  private publishPending(state: Source, reason?: SpeechSegment['reason']) {
    const row = state.pendingSilence;
    if (!row) return;
    const nativeIdle = state.awaitingSpeech === undefined;
    state.pendingSilence = undefined;
    state.prefix = undefined;
    state.awaitingSpeech = undefined;
    state.quietBoundary =
      reason === 'limit' && nativeIdle ? { silenceStartMs: row.silenceStartMs! } : undefined;
    const { silenceStartMs, ...segment } = row;
    this.emit({
      type: 'segment',
      segment: reason ? { ...segment, reason } : { ...segment, silenceStartMs },
    });
    state.id = randomUUID();
    if (!reason || !['sentence', 'limit'].includes(reason)) state.active = false;
  }
  private finishPending(source: AudioSource, state: Source, reason?: SpeechSegment['reason']) {
    const row = state.pendingSilence;
    const through = this.processedThrough(source) ?? -Infinity;
    if (!row) {
      const boundary = state.quietBoundary;
      if (boundary && !reason) {
        if (through >= boundary.silenceStartMs + speechSegmentationSilenceMs + endpointGraceMs) {
          state.active = false;
          state.quietBoundary = undefined;
        }
      }
      return;
    }
    if (!reason && (through - row.startMs >= logicalTurnMs || row.text.length >= logicalTextLimit))
      reason = 'limit';
    // Energy alone is not speech and must never restart this bounded deadline.
    const deadline = row.silenceStartMs! + speechSegmentationSilenceMs + endpointGraceMs;
    if (!reason && (state.awaitingSpeech || through < deadline)) return;
    this.publishPending(state, reason);
  }
  private observeSound(state: Source, samples: Float32Array) {
    let count = state.frameSamples ?? 0,
      power = state.framePower ?? 0;
    const frames = (state.soundFrames ??= []);
    for (let at = 0; at < samples.length;) {
      const length = Math.min(512 - count, samples.length - at);
      for (let i = 0; i < length; i++) power += samples[at + i] ** 2;
      at += length;
      count += length;
      if (count === 512) {
        const end = state.origin + (state.samples + at) / 16;
        // This is the existing activity threshold, not a speech/identity claim.
        // Sound estimates onset timing only after native VAD confirms a turn.
        if (Math.sqrt(power / 512) * 4 > 0.015) frames.push({ start: end - 32, end });
        while (frames.length && frames[0].end < end - 2000) frames.shift();
        count = power = 0;
      }
    }
    state.frameSamples = count;
    state.framePower = power;
  }
  private drainDeferred(state: Source) {
    const events = state.deferred ?? [];
    state.deferred = [];
    for (const event of events) this.receive(event);
  }
  private resolveResume(source: AudioSource, state: Source) {
    const row = state.pendingSilence,
      confirmed = state.awaitingSpeech;
    if (!row || confirmed === undefined || (this.processedThrough(source) ?? -Infinity) < confirmed)
      return;
    const deadline = row.silenceStartMs! + speechSegmentationSilenceMs;
    const onset = state.soundFrames?.find(
      (frame) => frame.end > row.endMs && frame.end <= confirmed,
    );
    const next = state.deferred?.find((event) => Number.isFinite(event.window_start_ms));
    if (onset) {
      if (onset.start >= deadline) this.publishPending(state);
      else this.resumePending(state);
    } else if (confirmed < deadline) this.resumePending(state);
    else if (next) {
      // A quiet/ambiguous native onset may include pre-roll. Only a window
      // wholly beyond the deadline proves the old logical turn has ended.
      if (state.origin + Number(next.window_start_ms) >= deadline) this.publishPending(state);
      else this.resumePending(state);
    } else return;
    state.active = true;
    this.drainDeferred(state);
  }
  private receive(value: any) {
    if (value.type === 'ack' || value.type === 'error') {
      const pending = this.pending.get(value.seq);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(value.seq);
      value.type === 'ack'
        ? pending.resolve()
        : pending.reject(Error('Qwen 本地推理失败，请检查推理设备或降低负载。'));
      return;
    }
    const source = value.session as AudioSource;
    const state = this.sources.get(source);
    if (!state) return;
    if (value.type === 'speech_start') {
      state.quietBoundary = undefined;
      if (state.pendingSilence) state.awaitingSpeech = state.origin + Number(value.audio_ms);
      state.active = true;
      this.emit({ type: 'speech-start', source });
      this.resolveResume(source, state);
      return;
    }
    if (!['partial', 'committed', 'tail_final'].includes(value.type)) return;
    if (state.pendingSilence && state.awaitingSpeech !== undefined) {
      const deferred = (state.deferred ??= []);
      if (deferred.length >= 32) throw Error('Oversized Qwen result');
      deferred.push(value);
      this.resolveResume(source, state);
      return;
    }
    this.inferenceMs += Number(value.inference_ms ?? value.alignment_ms ?? 0);
    const final = value.type !== 'partial';
    const reason =
      value.type === 'committed'
        ? 'sentence'
        : (state.reason ?? (value.reason === 'pause' ? 'silence' : 'limit'));
    const end = state.origin + Number(value.type === 'committed' ? value.cut_ms : value.audio_ms);
    const nativeStart = state.origin + Number(value.window_start_ms ?? state.start);
    if (state.pendingSilence) {
      if (!final || (reason === 'silence' && value.reason === 'pause')) {
        this.resumePending(state);
      } else this.finishPending(source, state, reason);
    }
    if (
      state.prefix &&
      (end - state.prefix.startMs >= logicalTurnMs ||
        state.prefix.text.length + String(value.text ?? '').length + 1 > logicalTextLimit)
    ) {
      this.emit({
        type: 'segment',
        segment: {
          id: state.id,
          source,
          ...state.prefix,
          final: true,
          reason: 'limit',
          speechModel: 'qwen',
        },
      });
      state.prefix = undefined;
      state.id = randomUUID();
    }
    const segment: SpeechSegment = {
      id: state.id,
      source,
      text: [state.prefix?.text, String(value.text ?? '')].filter(Boolean).join(' '),
      final,
      startMs: state.prefix?.startMs ?? nativeStart,
      endMs: end,
      speechModel: 'qwen',
      ...(final ? { reason } : {}),
      ...(final && reason === 'silence' && value.reason === 'pause'
        ? { silenceStartMs: end - nativeSilenceMs }
        : {}),
    };
    if (final && reason === 'silence' && value.reason === 'pause') {
      state.pendingSilence = segment;
      state.prefix = undefined;
      state.start = Number(value.audio_ms);
      state.active = true;
      this.emit({
        type: 'segment',
        segment: { ...segment, final: false, reason: undefined, silenceStartMs: undefined },
      });
      this.finishPending(source, state);
      return;
    }
    this.emit({ type: 'segment', segment });
    if (final) {
      state.prefix = undefined;
      const previous = state.id;
      state.id = randomUUID();
      state.start = Number(value.type === 'committed' ? value.cut_ms : value.audio_ms);
      if (value.type === 'committed' && value.tail)
        this.emit({
          type: 'segment',
          segment: {
            id: state.id,
            continuationOf: previous,
            source,
            text: value.tail,
            final: false,
            startMs: end,
            endMs: state.origin + Number(value.audio_ms),
            speechModel: 'qwen',
          },
        });
    }
  }
  private send(command: object) {
    return new Promise<void>((resolve, reject) => {
      if (this.closed || this.child.exitCode !== null || this.child.killed) {
        reject(Error('Qwen 已关闭。'));
        return;
      }
      const seq = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(Error('Qwen 推理超时，请降低负载或切换推理设备后重试。'));
        this.child.kill();
      }, 120000);
      this.pending.set(seq, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...command, seq }) + '\n', (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(seq);
          reject(error);
        }
      });
    });
  }
  private async accept(source: AudioSource, samples: Float32Array) {
    for (let offset = 0; offset < samples.length; offset += 3200) {
      const slice = samples.subarray(offset, offset + 3200),
        pcm = Buffer.alloc(slice.length * 2);
      for (let i = 0; i < slice.length; i++)
        pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(slice[i] * 32768))), i * 2);
      await this.send({ op: 'audio', source, audio: pcm.toString('base64') });
      const state = this.sources.get(source);
      if (state) {
        this.observeSound(state, slice);
        state.samples += slice.length;
        this.resolveResume(source, state);
        this.finishPending(source, state);
      }
    }
  }
  async feed(source: AudioSource, samples: Float32Array, rate: number, timestamp: number) {
    let state = this.sources.get(source);
    if (!state) {
      state = {
        id: randomUUID(),
        origin: timestamp,
        start: 0,
        rate,
        samples: 0,
        active: false,
        ...(rate !== 16000 ? { resampler: new sherpa.LinearResampler(rate, 16000) } : {}),
      };
      this.sources.set(source, state);
      await this.send({ op: 'start', source });
    }
    if (state.rate !== rate) throw Error('音频采样率发生变化，请重新连接设备。');
    this.audioMs += (samples.length / rate) * 1000;
    let energy = 0;
    for (const value of samples) energy += value * value;
    const level = Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)) * 4);
    this.emit({ type: 'activity', source, speaking: level > 0.015, level });
    const converted = state.resampler ? state.resampler.resample(samples) : samples;
    await this.accept(source, converted);
  }
  processedThrough(source: AudioSource): number | undefined {
    const state = this.sources.get(source);
    // The pinned native VAD consumes complete 512-sample frames. Unprocessed
    // PCM/resampler tails cannot count as confirmed silence.
    return state ? state.origin + Math.floor(state.samples / 512) * 32 : undefined;
  }
  canSwitch(source: AudioSource) {
    return !this.sources.get(source)?.active;
  }
  async discontinuity(source: AudioSource) {
    const state = this.sources.get(source);
    if (!state) return;
    state.reason = 'discontinuity';
    this.finishPending(source, state, 'discontinuity');
    this.drainDeferred(state);
    await this.send({ op: 'finish', source });
    this.sources.delete(source);
  }
  async discard(source: AudioSource) {
    if (!this.sources.has(source)) return;
    // Ignore native finish results before asking it to retire this session.
    // The model process stays loaded and the next packet starts a fresh lane.
    this.sources.delete(source);
    await this.send({ op: 'finish', source });
  }
  async flush(reason: 'pause' | 'stop') {
    for (const [source, state] of this.sources) {
      state.reason = reason;
      this.finishPending(source, state, reason);
      this.drainDeferred(state);
      if (state.resampler) await this.accept(source, state.resampler.flush(new Float32Array()));
      await this.send({ op: 'finish', source });
    }
    this.sources.clear();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.reject();
    this.child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.child.kill();
          resolve();
        }, 3000);
      }),
    ]);
    clearTimeout(timer);
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
    await this.exited;
  }
}
