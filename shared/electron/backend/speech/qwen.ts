import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { availableParallelism, constants, setPriority } from 'node:os';
import path from 'node:path';
import { BoundedLineDecoder } from './buffer';
import { QwenLegacyEndpoint, loadEndpointModel } from './qwenLegacyEndpoint';
import type {
  AudioSource,
  SpeechEvent,
  SpeechSegment,
  SpeechInferenceDevice,
} from '../../contracts/speech';
import { speechSegmentationSilenceMs, unsupportedSpeechCpu } from '../../contracts/speechSettings';
const sherpa = require('sherpa-onnx-node');
const legacySilenceMs = 800;

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
  nativeOffset?: number;
  endpoint?: QwenLegacyEndpoint;
  silenceCut?: number;
  awaitingAudio?: boolean;
  pendingEvents?: any[];
  lastLevelAt?: number;
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
  private nativeSilenceMs = legacySilenceMs;
  private legacyEndpoints?: Map<AudioSource, QwenLegacyEndpoint>;
  private closed = false;
  private exited: Promise<void>;
  private constructor(
    directory: string,
    device: SpeechInferenceDevice,
    private emit: (event: SpeechEvent) => void,
    runtimeFile?: string,
  ) {
    if (process.platform !== 'win32' && (process.platform !== 'darwin' || !runtimeFile))
      throw Error('当前平台不支持多语言语音识别。');
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
          RAYON_NUM_THREADS: String(Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)))),
        },
      },
    );
    if (this.child.pid !== undefined) {
      try {
        setPriority(this.child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // The process may have exited or the OS may only allow its inherited priority.
      }
    }
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
    legacyModels?: string[],
  ) {
    const engine = new QwenEngine(directory, device, emit, runtimeFile);
    try {
      const metadata = await new Promise<{ chunkMs: number; alignmentDevice: string }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error('多语言语音识别加载超时，请检查内存和推理设备。')),
            180000,
          );
          const failed = () => {
            clearTimeout(timer);
            reject(Error('多语言语音识别启动失败，请检查本地组件、内存和所选推理设备。'));
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
              if (line.length > 200000) throw Error('Oversized recognition result');
              const value = JSON.parse(line);
              if (value.type === 'error' && value.code === 'unsupported-cpu') {
                reject(Error(unsupportedSpeechCpu));
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
                  throw Error('Invalid recognition device');
                const silence = value.vad_silence_ms === undefined ? legacySilenceMs : value.vad_silence_ms;
                if (![speechSegmentationSilenceMs, 700, legacySilenceMs].includes(silence))
                  throw Error('Invalid native VAD threshold');
                engine.nativeSilenceMs = silence;
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
      if (engine.nativeSilenceMs > speechSegmentationSilenceMs) {
        const file = await Promise.race([
          loadEndpointModel(legacyModels),
          engine.exited.then(() => { throw Error('多语言语音识别已退出。'); }),
        ]);
        engine.legacyEndpoints = new Map(
          (['system', 'microphone'] as const).map(source => [source, QwenLegacyEndpoint.create(file)]),
        );
      }
      return { engine, ...metadata };
    } catch (error) {
      await engine.close();
      throw error;
    }
  }
  private reject() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error('多语言语音识别进程已退出，请重新开始。'));
    }
    this.pending.clear();
  }
  private receive(value: any) {
    if (value.type === 'ack' || value.type === 'error') {
      const pending = this.pending.get(value.seq);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(value.seq);
      value.type === 'ack'
        ? pending.resolve()
        : pending.reject(Error('多语言语音识别推理失败，请检查推理设备或降低负载。'));
      return;
    }
    const source = value.session as AudioSource;
    const state = this.sources.get(source);
    if (!state) return;
    if (state.awaitingAudio && (state.pendingEvents || (value.type === 'tail_final' && value.reason === 'pause'))) {
      const pending = state.pendingEvents ??= [];
      if (pending.length >= 128) throw Error('Oversized recognition result');
      pending.push(value);
      return;
    }
    if (value.type === 'speech_start') {
      state.active = true;
      this.emit({ type: 'speech-start', source });
      return;
    }
    if (!['partial', 'committed', 'tail_final'].includes(value.type)) return;
    this.inferenceMs += Number(value.inference_ms ?? value.alignment_ms ?? 0);
    const final = value.type !== 'partial';
    const origin = state.origin + (state.nativeOffset ?? 0) / 16;
    const end = origin + Number(value.type === 'committed' ? value.cut_ms : value.audio_ms);
    // Only an actual native pause or a finish issued at a confirmed VAD cut is silence.
    const silenceStart = value.type !== 'tail_final' || state.reason ? undefined
      : value.reason === 'pause' ? end - this.nativeSilenceMs
      : value.reason === 'requested_stop' ? state.silenceCut : undefined;
    const reason = value.type === 'committed' ? 'sentence' : state.reason ??
      (silenceStart !== undefined ? 'silence' : 'limit');
    const segment: SpeechSegment = {
      id: state.id,
      source,
      text: String(value.text ?? ''),
      final,
      startMs: origin + Number(value.window_start_ms ?? state.start),
      endMs: end,
      speechModel: 'qwen',
      ...(final ? { reason } : {}),
      ...(silenceStart !== undefined ? { silenceStartMs: silenceStart } : {}),
    };
    this.emit({ type: 'segment', segment });
    if (final) {
      if (reason !== 'sentence' && reason !== 'limit') state.active = false;
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
            endMs: origin + Number(value.audio_ms),
            speechModel: 'qwen',
          },
        });
    }
  }
  private send(command: object) {
    return new Promise<void>((resolve, reject) => {
      if (this.closed || this.child.exitCode !== null || this.child.killed) {
        reject(Error('多语言语音识别已关闭。'));
        return;
      }
      const seq = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(Error('多语言语音识别推理超时，请降低负载或切换推理设备后重试。'));
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
    const state = this.sources.get(source)!;
    for (let offset = 0; offset < samples.length;) {
      let slice = samples.subarray(offset, offset + 3200);
      const cut = !state.reason ? state.endpoint?.cut(slice) : undefined;
      if (cut) slice = slice.subarray(0, cut.offset);
      const pcm = Buffer.allocUnsafe(slice.length * 2);
      for (let i = 0; i < slice.length; i++)
        pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(slice[i] * 32768))), i * 2);
      state.awaitingAudio = true;
      try {
        await this.send({ op: 'audio', source, audio: pcm.toString('base64') });
      } catch (error) {
        state.pendingEvents = undefined;
        throw error;
      } finally {
        state.awaitingAudio = false;
      }
      state.samples += slice.length;
      offset += slice.length;
      if (state.pendingEvents) {
        const events = state.pendingEvents;
        state.pendingEvents = undefined;
        for (const event of events) this.receive(event);
      }
      if (cut && state.active) {
        // The old process has no endpoint command. Finish just this source at the
        // confirmed frame and restart its empty lane before forwarding the suffix.
        state.silenceCut = state.origin + (state.samples - cut.quietSamples) / 16;
        await this.send({ op: 'finish', source });
        state.silenceCut = undefined;
        state.nativeOffset = state.samples;
        state.start = 0;
        state.active = false;
        await this.send({ op: 'start', source });
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
      state.endpoint = this.legacyEndpoints?.get(source);
      state.endpoint?.reset();
    }
    if (state.rate !== rate) throw Error('音频采样率发生变化，请重新连接设备。');
    this.audioMs += (samples.length / rate) * 1000;
    const now = performance.now();
    if (state.lastLevelAt === undefined || now - state.lastLevelAt >= 80) {
      state.lastLevelAt = now;
      let energy = 0;
      for (const value of samples) energy += value * value;
      const level = Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)) * 4);
      this.emit({ type: 'activity', source, speaking: level > 0.015, level });
    }
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
