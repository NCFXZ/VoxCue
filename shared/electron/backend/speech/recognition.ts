import type { AudioSource, SpeechEvent } from '../../contracts/speech';
import type { RecognizerMetadata, RecognizerPort } from './recognizer';
export type RecognizerFactory = (
  options: object,
  emit: (event: SpeechEvent) => void,
  signal: AbortSignal,
) => Promise<RecognizerPort>;
type Audio = { samples: Float32Array; rate: number; timestamp: number };
type Slot = {
  abort: AbortController;
  port?: RecognizerPort;
  priming: boolean;
  events: SpeechEvent[];
};
type Switch = {
  slot: Slot;
  resolve(value: RecognizerMetadata): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

// Capture and AEC live outside these disposable recognizers. Only one recognizer
// owns transcript events; candidates receive bounded silent pre-roll at handoff.
export class RecognitionRouter {
  private current!: Slot;
  private switching?: Switch;
  private sources = new Set<AudioSource>();
  private history = new Map<AudioSource, Audio[]>();
  private progress = new Map<AudioSource, number>();
  private retiring = new Set<Promise<void>>();
  private loading = new Set<Promise<unknown>>();
  private cleanupErrors: Error[] = [];
  private closed = false;
  private retiredInference = 0;
  audioMs = 0;
  get inferenceMs() {
    return this.retiredInference + this.current.port!.inferenceMs;
  }
  get metadata() {
    return this.current.port!.metadata;
  }
  constructor(
    private factory: RecognizerFactory,
    private emit: (event: SpeechEvent) => void,
  ) {}
  private slot() {
    const slot: Slot = { abort: new AbortController(), priming: false, events: [] };
    const emit = (event: SpeechEvent) => {
      if (this.closed) return;
      if (this.current === slot) this.emit(event);
      else if (slot.priming && slot.events.length < 256) slot.events.push(event);
    };
    return { slot, emit };
  }
  async initialize(options: object, sources: AudioSource[]) {
    const { slot, emit } = this.slot();
    this.current = slot;
    slot.port = await this.factory(options, emit, slot.abort.signal);
    this.sources = new Set(sources);
  }
  prepare(sources: AudioSource[]) {
    this.cancel('音频已重新连接，语音切换已取消。');
    this.sources = new Set(sources);
    this.history.clear();
    this.progress.clear();
  }
  stage(options: object, phase: (value: 'loading' | 'waiting') => void) {
    if (this.closed || this.switching)
      return Promise.reject(Error('语音切换正在进行或服务已关闭。'));
    if (this.retiring.size || this.loading.size || this.cleanupErrors.length)
      return Promise.reject(Error('上一识别器尚未确认释放，请稍后重试或重新连接音频。'));
    const { slot, emit } = this.slot();
    return new Promise<RecognizerMetadata>((resolve, reject) => {
      const change: Switch = {
        slot,
        resolve,
        reject,
        timer: setTimeout(() => this.cancel('新识别器加载超时，仍使用原配置。'), 180000),
      };
      this.switching = change;
      phase('loading');
      const loading = this.factory(options, emit, slot.abort.signal)
        .then((port) => {
          slot.port = port;
          if (this.switching !== change || this.closed) {
            this.retire(port);
            return;
          }
          clearTimeout(change.timer);
          change.timer = setTimeout(
            () => this.cancel('未等到两路语音的安全停顿，仍使用原配置。'),
            120000,
          );
          phase('waiting');
        })
        .catch((error) => {
          if (this.switching === change)
            this.cancel(
              error instanceof Error ? error.message : '新识别器加载失败，仍使用原配置。',
            );
        });
      this.loading.add(loading);
      void loading.finally(() => this.loading.delete(loading));
    });
  }
  private retire(port: RecognizerPort) {
    const closing = port.close().catch((error) => {
      this.cleanupErrors.push(error instanceof Error ? error : Error('识别器释放失败。'));
    });
    this.retiring.add(closing);
    void closing.finally(() => this.retiring.delete(closing));
  }
  cancel(message = '语音切换已取消，仍使用原配置。') {
    const change = this.switching;
    if (!change) return;
    this.switching = undefined;
    clearTimeout(change.timer);
    change.slot.abort.abort();
    if (change.slot.port) this.retire(change.slot.port);
    change.reject(Error(message));
  }
  private remember(source: AudioSource, samples: Float32Array, rate: number, timestamp: number) {
    const recent = this.history.get(source) ?? [];
    if (recent.some((audio) => audio.rate !== rate)) recent.length = 0;
    const keep = Math.round(rate * 0.3);
    const trim = Math.max(0, samples.length - keep);
    recent.push({
      samples: samples.slice(trim),
      rate,
      timestamp: timestamp + (trim / rate) * 1000,
    });
    let excess = recent.reduce((sum, audio) => sum + audio.samples.length, 0) - keep;
    while (excess > 0 && recent.length) {
      const first = recent[0];
      if (first.samples.length <= excess) {
        excess -= first.samples.length;
        recent.shift();
      } else {
        first.samples = first.samples.slice(excess);
        first.timestamp += (excess / rate) * 1000;
        break;
      }
    }
    this.history.set(source, recent);
  }
  async feed(source: AudioSource, samples: Float32Array, rate: number, timestamp: number) {
    this.sources.add(source);
    this.remember(source, samples, rate, timestamp);
    await this.current.port!.feed(source, samples, rate, timestamp);
    this.audioMs += (samples.length / rate) * 1000;
    const through = this.current.port!.processedThrough(source);
    if (through !== undefined) this.progress.set(source, through);
    await this.handoff();
  }
  private async handoff() {
    const change = this.switching;
    const candidate = change?.slot.port;
    if (!change || !candidate) return;
    if (!candidate.healthy) {
      this.cancel('新识别器已退出，仍使用原配置。');
      return;
    }
    if (![...this.sources].every((source) => this.current.port!.canSwitch(source))) return;
    const old = this.current;
    let timer: NodeJS.Timeout | undefined;
    let aborted: (() => void) | undefined;
    try {
      change.slot.priming = true;
      const prime = async () => {
        for (const [source, audio] of this.history)
          for (const frame of audio)
            await candidate.feed(source, frame.samples, frame.rate, frame.timestamp);
      };
      // A stalled candidate must not monopolize the old recognizer's audio queue.
      await Promise.race([
        prime(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(Error('新识别器交接准备超时，仍使用原配置。')), 1000);
          aborted = () => reject(Error('语音切换已取消。'));
          change.slot.abort.signal.addEventListener('abort', aborted, { once: true });
        }),
      ]);
      if (this.switching !== change || this.closed) return;
      this.retiredInference += old.port!.inferenceMs;
      this.current = change.slot;
      change.slot.priming = false;
      this.switching = undefined;
      clearTimeout(change.timer);
      for (const event of change.slot.events) this.emit(event);
      change.slot.events = [];
      change.resolve(candidate.metadata);
      this.retire(old.port!);
    } catch (error) {
      change.slot.priming = false;
      if (this.switching === change)
        this.cancel(error instanceof Error ? error.message : '新识别器准备失败，仍使用原配置。');
    } finally {
      clearTimeout(timer);
      if (aborted) change.slot.abort.signal.removeEventListener('abort', aborted);
    }
  }
  processedThrough(source: AudioSource) {
    return this.current.port!.processedThrough(source) ?? this.progress.get(source);
  }
  async discontinuity(source: AudioSource) {
    this.cancel();
    this.history.delete(source);
    this.progress.delete(source);
    await this.current.port!.discontinuity(source);
  }
  async flush(reason: 'pause' | 'stop') {
    this.cancel();
    await this.current.port!.flush(reason);
    this.history.clear();
    this.progress.clear();
  }
  async close() {
    this.closed = true;
    this.cancel();
    this.current?.abort.abort();
    try {
      await this.current?.port?.close();
    } finally {
      // A current-port failure must not skip other model/process releases.
      await Promise.all(this.loading);
      await Promise.all(this.retiring);
    }
    if (this.cleanupErrors.length) throw this.cleanupErrors[0];
  }
}
