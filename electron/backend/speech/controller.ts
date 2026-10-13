import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { AudioSource, SpeechCall, SpeechEvent, SpeechStatus } from '../../contracts/speech';
import { WasapiCapture, devices } from './capture';
export const speechModelName = 'Paraformer 中英 INT8 · Silero VAD · 本地';
export class SpeechController {
  private worker?: Worker;
  private ready?: Promise<void>;
  private captures = new Map<AudioSource, WasapiCapture>();
  private queued = 0;
  private maxQueue = 0;
  private sequence = 0;
  private discontinuities = 0;
  private droppedSamples = 0;
  private lastAudio = new Map<AudioSource, number>();
  private timer?: NodeJS.Timeout;
  private rates = new Map<AudioSource, number>();
  private flushers = new Map<number, () => void>();
  private anchors = new Map<AudioSource, { native: number; wall: number }>();
  private status: SpeechStatus = { state: 'idle', model: speechModelName };
  private serial = Promise.resolve();
  private epoch = 0;
  constructor(
    private model: string,
    private helper: string,
    private emit: (e: SpeechEvent) => void,
  ) {}
  call(call: SpeechCall): Promise<SpeechStatus> {
    const result = this.serial.then(() => this.execute(call));
    this.serial = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private state(state: SpeechStatus['state'], error?: string) {
    this.status = { state, model: speechModelName, ...(error ? { error } : {}) };
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
        if (m.flushed) {
          this.flushers.get(m.flushed)?.();
          this.flushers.delete(m.flushed);
        }
        if (m.error) {
          clearTimeout(timer);
          reject(Error(m.error));
          this.fail(m.error);
        }
      });
      worker.on('error', () => {
        clearTimeout(timer);
        reject(Error('语音识别进程异常，请检查模型后重新开始。'));
        this.fail('语音识别进程异常，请重新开始。');
      });
      worker.on('exit', () => {
        if (this.worker !== worker) return;
        this.worker = undefined;
        this.ready = undefined;
        if (this.captures.size) this.fail('语音识别进程已退出，采集已停止。');
      });
      worker.postMessage({ op: 'init', directory: this.model });
    });
    return this.ready;
  }
  private audio(
    source: AudioSource,
    samples: Float32Array,
    rate: number,
    flags = 0,
    timestamp = Date.now(),
  ) {
    if (flags & 1) {
      this.discontinuities++;
      this.fail('WASAPI 报告音频不连续；为避免缺字误用，请重新开始采集。');
      return;
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
        sequence: ++this.sequence,
        ms,
      },
      [samples.buffer as ArrayBuffer],
    );
  }
  private fail(message: string) {
    if (this.status.state === 'error') return;
    this.state('error', message);
    void this.call({ op: 'stop' })
      .then(() => this.state('error', message))
      .catch(() => {
        this.state('error', message);
        const worker = this.worker;
        this.worker = undefined;
        this.ready = undefined;
        void worker?.terminate();
      });
  }
  private async execute(call: SpeechCall): Promise<SpeechStatus> {
    if (call.op === 'status') return this.status;
    if (call.op === 'devices') return { ...this.status, devices: await devices(this.helper) };
    if (call.op === 'pause' || call.op === 'stop') {
      ++this.epoch;
      clearInterval(this.timer);
      this.timer = undefined;
      await Promise.all([...this.captures.values()].map((c) => c.stop()));
      this.captures.clear();
      this.lastAudio.clear();
      this.rates.clear();
      this.anchors.clear();
      if (this.worker && this.ready) {
        const id = ++this.sequence;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.flushers.delete(id);
            reject(Error('语音尾段处理超时。'));
          }, 5000);
          this.flushers.set(id, () => {
            clearTimeout(timer);
            resolve();
          });
          this.worker!.postMessage({ op: 'flush', id, reason: call.op });
        });
      }
      this.queued = 0;
      return this.state(call.op === 'pause' ? 'paused' : 'idle');
    }
    if (call.op !== 'start') throw Error('Invalid speech operation');
    if (this.captures.size) return this.status;
    const available = await devices(this.helper);
    for (const source of call.options.sources) {
      const selected = call.options[source];
      if (selected && !available.some((d) => d.source === source && d.id === selected))
        throw Error('所选音频设备已不可用，请刷新设备列表。');
      if (!available.some((d) => d.source === source))
        throw Error('未发现' + (source === 'system' ? '播放' : '麦克风') + '设备。');
    }
    this.state('loading');
    try {
      await this.load();
      const epoch = ++this.epoch;
      for (const source of call.options.sources) {
        this.lastAudio.set(source, Date.now());
        const capture = new WasapiCapture(
          this.helper,
          source,
          call.options[source],
          (p) => {
            if (epoch !== this.epoch) return;
            this.lastAudio.set(source, Date.now());
            this.rates.set(source, p.rate);
            let anchor = this.anchors.get(source);
            if (!anchor) {
              anchor = { native: p.timestamp, wall: Date.now() };
              this.anchors.set(source, anchor);
            }
            this.audio(
              source,
              p.samples,
              p.rate,
              p.flags,
              p.flags & 4 ? Date.now() : anchor.wall + p.timestamp - anchor.native,
            );
          },
          (m) => this.fail(m),
        );
        this.captures.set(source, capture);
        await capture.start();
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
      await Promise.all([...this.captures.values()].map((c) => c.stop()));
      this.captures.clear();
      this.ready = undefined;
      const old = this.worker;
      this.worker = undefined;
      await old?.terminate();
      return this.state('error', (error as Error).message);
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
