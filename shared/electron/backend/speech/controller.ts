import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type {
  AudioSource,
  SpeechCall,
  SpeechEvent,
  SpeechStatus,
  AudioDevice,
} from '../../contracts/speech';
import type { AudioPacket } from './buffer';
export interface NativeCapture {
  start(): Promise<void>;
  stop(): Promise<void>;
}
export interface CaptureAdapter {
  readonly drainBeforeRetire?: boolean;
  readonly preprocessorFile?: string;
  devices(helper: string): Promise<AudioDevice[]>;
  create(
    helper: string,
    source: AudioSource,
    device: string | undefined,
    audio: (packet: AudioPacket) => void,
    failure: (message: string) => void,
  ): NativeCapture;
}
export const speechModelName = 'Paraformer 中英 INT8 · Silero VAD · 本地';
export class SpeechController {
  private worker?: Worker;
  private ready?: Promise<void>;
  private captures = new Map<AudioSource, NativeCapture>();
  private queued = 0;
  private maxQueue = 0;
  private sequence = 0;
  private discontinuities = 0;
  private recentGaps = new Map<AudioSource, number[]>();
  private droppedSamples = 0;
  private lastAudio = new Map<AudioSource, number>();
  private timer?: NodeJS.Timeout;
  private rates = new Map<AudioSource, number>();
  private flushers = new Map<number, { resolve(): void; reject(error: Error): void }>();
  private anchors = new Map<AudioSource, { native: number; wall: number }>();
  private status: SpeechStatus = { state: 'idle', model: speechModelName };
  private serial = Promise.resolve();
  private epoch = 0;
  constructor(
    private model: string,
    private helper: string,
    private emit: (e: SpeechEvent) => void,
    private adapter: CaptureAdapter,
  ) {}
  call(call: SpeechCall): Promise<SpeechStatus> {
    const result = this.serial.then(() => this.execute(call));
    this.serial = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private state(
    state: SpeechStatus['state'],
    error?: string,
    failureSource?: SpeechStatus['failureSource'],
  ) {
    this.status = {
      state,
      model: speechModelName,
      ...(error ? { error } : {}),
      ...(failureSource ? { failureSource } : {}),
    };
    this.emit({ type: 'status', status: this.status });
    return this.status;
  }
  private load() {
    if (this.ready) return this.ready;
    const worker = new Worker(path.join(__dirname, 'worker.js'));
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Error('语音模型加载超时。'));
        void worker.terminate();
      }, 60000);
      worker.on('message', (m) => {
        if (this.worker !== worker) return;
        if (m.ready) {
          clearTimeout(timer);
          resolve();
        }
        if (m.event) this.emit(m.event);
        if (m.ack) {
          this.queued = Math.max(0, this.queued - m.ms);
          if (m.ack % 100 === 0)
            this.emit({
              type: 'metrics',
              queueMs: this.queued,
              maxQueueMs: this.maxQueue,
              droppedSamples: this.droppedSamples,
              discontinuities: this.discontinuities,
              rss: process.memoryUsage().rss,
              audioMs: m.audioMs,
              inferenceMs: m.inferenceMs,
            });
        }
        const completed = m.flushed ?? m.prepared;
        if (completed) {
          this.flushers.get(completed)?.resolve();
          this.flushers.delete(completed);
        }
        if (m.error) {
          clearTimeout(timer);
          reject(Error(m.error));
          for (const pending of this.flushers.values()) pending.reject(Error(m.error));
          this.flushers.clear();
          this.fail(m.error);
        }
      });
      worker.on('error', () => {
        if (this.worker !== worker) return;
        clearTimeout(timer);
        reject(Error('语音识别进程异常，请检查模型后重新开始。'));
        this.fail('语音识别进程异常，请重新开始。', 'model');
      });
      worker.on('exit', () => {
        if (this.worker !== worker) return;
        clearTimeout(timer);
        reject(Error('语音识别进程在初始化完成前已退出，请重新开始。'));
        this.worker = undefined;
        this.ready = undefined;
        const flushing = this.flushers.size > 0;
        for (const pending of this.flushers.values())
          pending.reject(Error('语音识别进程在尾段处理完成前退出，请重新开始。'));
        this.flushers.clear();
        if (this.captures.size) this.fail('语音识别进程已退出，采集已停止。', 'model');
        else if (flushing)
          this.state('error', '语音识别进程在尾段处理完成前退出，请重新开始。', 'model');
      });
      worker.postMessage({
        op: 'init',
        directory: this.model,
        ...(this.adapter.preprocessorFile
          ? { preprocessorFile: this.adapter.preprocessorFile }
          : {}),
      });
    });
    return this.ready;
  }
  private audio(
    source: AudioSource,
    samples: Float32Array,
    rate: number,
    flags = 0,
    timestamp = Date.now(),
    captureClock?: number,
  ) {
    if (flags & 1) {
      this.discontinuities++;
      const now = Date.now();
      const gaps = [...(this.recentGaps.get(source) ?? []).filter((at) => now - at < 10000), now];
      this.recentGaps.set(source, gaps);
      this.worker?.postMessage({ op: 'gap', source });
      this.emit({
        type: 'gap',
        source,
        message: `${source === 'system' ? '系统音频' : '麦克风'}发生短暂间断，转写已继续；不完整片段不会自动用于回答。`,
      });
      if (gaps.length >= 5) {
        this.fail('音频在十秒内连续中断五次，采集已停止；请检查设备或降低负载后重新开始。', source);
        return;
      }
    }
    const ms = (samples.length / rate) * 1000;
    if (this.queued + ms > 2000) {
      this.droppedSamples += samples.length;
      this.emit({
        type: 'metrics',
        queueMs: this.queued,
        maxQueueMs: this.maxQueue,
        droppedSamples: this.droppedSamples,
        discontinuities: this.discontinuities,
        rss: process.memoryUsage().rss,
        audioMs: 0,
        inferenceMs: 0,
      });
      this.fail('识别积压超过两秒，采集已停止；未静默丢弃音频，请降低并发负载后重试。');
      return;
    }
    this.queued += ms;
    this.maxQueue = Math.max(this.maxQueue, this.queued);
    this.worker?.postMessage(
      {
        op: 'audio',
        source,
        samples,
        rate,
        timestamp,
        ...(captureClock !== undefined ? { captureClock } : {}),
        sequence: ++this.sequence,
        ms,
      },
      [samples.buffer as ArrayBuffer],
    );
  }
  private fail(message: string, failureSource: SpeechStatus['failureSource'] = 'service') {
    if (this.status.state === 'error') return;
    this.state('error', message, failureSource);
    void this.call({ op: 'stop' })
      .then(() => this.state('error', message, failureSource))
      .catch(() => {
        this.state('error', message, failureSource);
        const worker = this.worker;
        this.worker = undefined;
        this.ready = undefined;
        void worker?.terminate();
      });
  }
  private checkStartup() {
    if (!this.worker || this.status.state === 'error')
      throw Error(this.status.error || '语音识别进程已退出，请重新开始。');
  }
  private async execute(call: SpeechCall): Promise<SpeechStatus> {
    if (call.op === 'status') return this.status;
    if (call.op === 'devices')
      return { ...this.status, devices: await this.adapter.devices(this.helper) };
    if (call.op === 'pause' || call.op === 'stop') {
      if (!this.adapter.drainBeforeRetire) ++this.epoch;
      clearInterval(this.timer);
      this.timer = undefined;
      const stopped = await Promise.allSettled(
        [...this.captures.values()].map(async (capture) => capture.stop()),
      );
      if (this.adapter.drainBeforeRetire) ++this.epoch;
      this.captures.clear();
      this.lastAudio.clear();
      this.rates.clear();
      this.anchors.clear();
      this.recentGaps.clear();
      if (stopped.some((result) => result.status === 'rejected')) {
        const worker = this.worker;
        this.worker = undefined;
        this.ready = undefined;
        this.queued = 0;
        await worker?.terminate();
        const message = '音频采集未能正常停止，请重新开始。';
        this.state('error', message, 'service');
        throw Error(message);
      }
      if (this.worker && this.ready) {
        const id = ++this.sequence;
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              this.flushers.delete(id);
              reject(Error('语音尾段处理超时。'));
            }, 5000);
            this.flushers.set(id, {
              resolve: () => {
                clearTimeout(timer);
                resolve();
              },
              reject: (error) => {
                clearTimeout(timer);
                reject(error);
              },
            });
            this.worker!.postMessage({ op: 'flush', id, reason: call.op });
          });
        } catch (error) {
          const worker = this.worker;
          this.worker = undefined;
          this.ready = undefined;
          this.queued = 0;
          await worker?.terminate();
          this.state('error', (error as Error).message);
          throw error;
        }
      }
      this.queued = 0;
      return this.state(call.op === 'pause' ? 'paused' : 'idle');
    }
    if (call.op !== 'start') throw Error('Invalid speech operation');
    if (this.captures.size) return this.status;
    const available = await this.adapter.devices(this.helper);
    for (const source of call.options.sources) {
      const selected = call.options[source];
      if (selected && !available.some((d) => d.source === source && d.id === selected))
        throw Error('所选音频设备已不可用，请刷新设备列表。');
      if (!available.some((d) => d.source === source))
        throw Error('未发现' + (source === 'system' ? '播放' : '麦克风') + '设备。');
    }
    this.state('loading');
    let startupFailure: SpeechStatus['failureSource'] = 'model';
    try {
      await this.load();
      this.checkStartup();
      if (this.adapter.preprocessorFile) {
        startupFailure = 'service';
        const id = ++this.sequence;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.flushers.delete(id);
            reject(Error('本地回声消除初始化超时，请重新开始。'));
          }, 10000);
          this.flushers.set(id, {
            resolve: () => {
              clearTimeout(timer);
              resolve();
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          this.worker!.postMessage({ op: 'prepare', id, sources: call.options.sources });
        });
        this.checkStartup();
      }
      const epoch = ++this.epoch;
      for (const source of call.options.sources) {
        startupFailure = source;
        this.lastAudio.set(source, Date.now());
        const capture = this.adapter.create(
          this.helper,
          source,
          call.options[source],
          (p) => {
            if (epoch !== this.epoch) return;
            this.lastAudio.set(source, Date.now());
            this.rates.set(source, p.rate);
            const validClock = !(p.flags & 4) && Number.isFinite(p.timestamp);
            let anchor = this.anchors.get(source);
            if (!anchor && validClock) {
              anchor = { native: p.timestamp, wall: Date.now() };
              this.anchors.set(source, anchor);
            }
            this.audio(
              source,
              p.samples,
              p.rate,
              p.flags,
              validClock ? anchor!.wall + p.timestamp - anchor!.native : Date.now(),
              validClock ? p.timestamp : undefined,
            );
          },
          (m) => {
            if (epoch === this.epoch) this.fail(m, source);
          },
        );
        this.captures.set(source, capture);
        await capture.start();
        this.checkStartup();
      }
      // Render loopback emits no packets when Windows has no playback. Supply
      // explicit timed silence so VAD can finalize without inventing speech.
      this.timer = setInterval(() => {
        for (const source of this.captures.keys()) {
          const last = this.lastAudio.get(source)!;
          const rate = this.rates.get(source);
          if (rate && Date.now() - last >= 200) {
            this.lastAudio.set(source, Date.now());
            this.audio(source, new Float32Array(Math.round(rate / 5)), rate);
          }
        }
      }, 100);
      return this.state('running');
    } catch (error) {
      // Retire callbacks first. A second cleanup failure must not hide the
      // original startup error or leave this controller stuck with captures.
      ++this.epoch;
      clearInterval(this.timer);
      this.timer = undefined;
      const captures = [...this.captures.values()];
      this.captures.clear();
      this.queued = 0;
      this.lastAudio.clear();
      this.rates.clear();
      this.anchors.clear();
      this.recentGaps.clear();
      this.ready = undefined;
      const old = this.worker;
      this.worker = undefined;
      await Promise.allSettled(captures.map(async (capture) => capture.stop()));
      await old?.terminate();
      return this.state(
        'error',
        (error as Error).message,
        this.status.failureSource ?? startupFailure,
      );
    }
  }
  async close() {
    try {
      await this.call({ op: 'stop' });
    } finally {
      clearInterval(this.timer);
      const worker = this.worker;
      this.worker = undefined;
      this.ready = undefined;
      await worker?.terminate();
    }
  }
}
