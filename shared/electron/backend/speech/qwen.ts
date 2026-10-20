import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type {
  AudioSource,
  SpeechEvent,
  SpeechSegment,
  SpeechInferenceDevice,
} from '../../contracts/speech';
const sherpa = require('sherpa-onnx-node');

interface Source {
  id: string;
  origin: number;
  start: number;
  rate: number;
  resampler?: {
    resample(samples: Float32Array): Float32Array;
    flush(samples: Float32Array): Float32Array;
  };
  reason?: SpeechSegment['reason'];
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
  ) {
    const runtime = path.join(directory, 'runtime');
    this.child = spawn(
      path.join(runtime, device === 'cpu' ? 'voxcue-qwen-cpu.exe' : 'voxcue-qwen.exe'),
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
  ) {
    const engine = new QwenEngine(directory, device, emit);
    try {
      const metadata = await new Promise<{ chunkMs: number; alignmentDevice: string }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error('Qwen 模型加载超时，请检查内存和推理设备。')),
            180000,
          );
          const failed = () => {
            clearTimeout(timer);
            reject(Error('Qwen 启动失败；CUDA 需要可用的 NVIDIA 驱动，也可在模型设置中选择 CPU。'));
          };
          engine.child.once('error', failed);
          engine.child.once('exit', failed);
          const lines = createInterface({ input: engine.child.stdout });
          lines.on('line', (line) => {
            try {
              if (line.length > 200000) throw Error('Oversized Qwen result');
              const value = JSON.parse(line);
              if (value.type === 'ready') {
                if (![500, 1000].includes(value.chunk_ms) || value.device !== device)
                  throw Error('Invalid Qwen device');
                clearTimeout(timer);
                engine.child.removeListener('error', failed);
                engine.child.removeListener('exit', failed);
                resolve({ chunkMs: value.chunk_ms, alignmentDevice: value.alignment_device });
              } else engine.receive(value);
            } catch {
              engine.reject();
              failed();
              engine.child.kill();
            }
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
      this.emit({ type: 'speech-start', source });
      return;
    }
    this.inferenceMs += Number(value.inference_ms ?? value.alignment_ms ?? 0);
    if (!['partial', 'committed', 'tail_final'].includes(value.type)) return;
    const final = value.type !== 'partial';
    const reason =
      value.type === 'committed'
        ? 'sentence'
        : (state.reason ?? (value.reason === 'pause' ? 'silence' : 'limit'));
    const end = state.origin + Number(value.type === 'committed' ? value.cut_ms : value.audio_ms);
    const start = state.origin + Number(value.window_start_ms ?? state.start);
    this.emit({
      type: 'segment',
      segment: {
        id: state.id,
        source,
        text: String(value.text ?? ''),
        final,
        startMs: start,
        endMs: end,
        speechModel: 'qwen',
        ...(final ? { reason } : {}),
      },
    });
    if (final) {
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
        reject(Error('Qwen 推理超时，请降低负载或使用 CUDA。'));
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
    }
  }
  async feed(source: AudioSource, samples: Float32Array, rate: number, timestamp: number) {
    let state = this.sources.get(source);
    if (!state) {
      state = {
        id: randomUUID(),
        origin: timestamp - (samples.length / rate) * 1000,
        start: 0,
        rate,
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
    await this.accept(source, state.resampler ? state.resampler.resample(samples) : samples);
  }
  async discontinuity(source: AudioSource) {
    const state = this.sources.get(source);
    if (!state) return;
    state.reason = 'discontinuity';
    await this.send({ op: 'finish', source });
    this.sources.delete(source);
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
