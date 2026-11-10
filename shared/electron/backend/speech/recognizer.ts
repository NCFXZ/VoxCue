import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { AudioSource, SpeechEvent } from '../../contracts/speech';
export interface RecognizerMetadata {
  chunkMs?: number;
  alignmentDevice?: string;
}
export interface RecognizerPort {
  readonly metadata: RecognizerMetadata;
  readonly healthy: boolean;
  readonly audioMs: number;
  readonly inferenceMs: number;
  feed(source: AudioSource, samples: Float32Array, rate: number, timestamp: number): Promise<void>;
  flush(reason: 'pause' | 'stop'): Promise<void>;
  discontinuity(source: AudioSource): Promise<void>;
  discard(source: AudioSource): Promise<void>;
  processedThrough(source: AudioSource): number | undefined;
  canSwitch(source: AudioSource): boolean;
  close(): Promise<void>;
}
export class Recognizer implements RecognizerPort {
  metadata: RecognizerMetadata = {};
  healthy = true;
  audioMs = 0;
  inferenceMs = 0;
  private worker: Worker;
  private sequence = 0;
  private loaded = false;
  private closing?: Promise<void>;
  private pending = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >();
  private progress: Partial<Record<AudioSource, number>> = {};
  private idle: Partial<Record<AudioSource, boolean>> = {};
  private constructor(emit: (event: SpeechEvent) => void) {
    this.worker = new Worker(path.join(__dirname, 'recognizer-worker.js'));
    this.worker.on('message', (message) => {
      if (message.event && !this.closing) emit(message.event);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(Error(message.error));
      else {
        if (message.value?.progress) {
          this.progress = message.value.progress;
          this.idle = message.value.idle;
          this.audioMs = message.value.audioMs;
          this.inferenceMs = message.value.inferenceMs;
        }
        pending.resolve(message.value);
      }
    });
    const failed = () => {
      this.healthy = false;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(Error('语音识别器已退出。'));
      }
      this.pending.clear();
    };
    this.worker.on('error', failed);
    this.worker.on('exit', failed);
  }
  static async load(options: object, emit: (event: SpeechEvent) => void, signal: AbortSignal) {
    const recognizer = new Recognizer(emit);
    const abort = () => {
      void recognizer.close().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) throw Error('语音切换已取消。');
      recognizer.metadata = await recognizer.send({ op: 'init', ...options }, 180000);
      recognizer.loaded = true;
      if (signal.aborted) throw Error('语音切换已取消。');
      return recognizer;
    } catch (error) {
      await recognizer.close();
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  private send(message: object, timeout = 120000) {
    if (!this.healthy) return Promise.reject(Error('语音识别器不可用。'));
    return new Promise<any>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('语音识别器超时。'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ ...message, id });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async feed(source: AudioSource, samples: Float32Array, rate: number, timestamp: number) {
    await this.send({ op: 'audio', source, samples, rate, timestamp });
  }
  async flush(reason: 'pause' | 'stop') {
    await this.send({ op: 'flush', reason });
  }
  async discontinuity(source: AudioSource) {
    await this.send({ op: 'gap', source });
  }
  async discard(source: AudioSource) {
    await this.send({ op: 'discard', source });
  }
  processedThrough(source: AudioSource) {
    return this.progress[source];
  }
  canSwitch(source: AudioSource) {
    return this.idle[source] === true || this.progress[source] === undefined;
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      try {
        if (this.loaded && this.healthy) await this.send({ op: 'close' }, 4000);
      } finally {
        await this.worker.terminate();
        this.healthy = false;
      }
    })());
  }
}
