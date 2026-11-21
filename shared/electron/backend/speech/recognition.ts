import type { AudioSource, SpeechEvent } from '../../contracts/speech';
import { speechSwitchCancelled } from '../../contracts/speechSettings';
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
  expedited?: boolean;
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
          if (change.expedited || !this.sources.size) this.expedite();
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
  cancel(message: string | Error = speechSwitchCancelled) {
    const change = this.switching;
    if (!change) return;
    this.switching = undefined;
    clearTimeout(change.timer);
    change.slot.abort.abort();
    if (change.slot.port) this.retire(change.slot.port);
    change.reject(typeof message === 'string' ? Error(message) : message);
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
    const owner = this.current;
    this.sources.add(source);
    this.remember(source, samples, rate, timestamp);
    try {
      await owner.port!.feed(source, samples, rate, timestamp);
    } catch (error) {
      if (this.current === owner) throw error;
    }
    // An expedited cutover reports a gap for the interrupted packet. Its
    // eventual ACK or error cannot advance the replacement's silence clock.
    if (this.current !== owner) return;
    this.audioMs += (samples.length / rate) * 1000;
    const through = this.current.port!.processedThrough(source);
    if (through !== undefined) this.progress.set(source, through);
    await this.handoff();
  }
  expedite(manual = false) {
    const change = this.switching;
    if (!change) return;
    change.expedited = true;
    if (!change.slot.port || change.slot.priming) return;
    if (!change.slot.port.healthy) {
      this.cancel('新识别器已退出，仍使用原配置。');
      return;
    }
    this.history.clear();
    this.progress.clear();
    for (const source of this.sources)
      this.emit({ type: 'gap', source, message: manual
        ? '已立即切换语音模型。未完成片段不会自动用于回答。'
        : '转写积压，已切换到所选语音配置。未完成片段不会自动用于回答。' });
    this.commit(change);
  }
  private commit(change: Switch) {
    const old = this.current.port!;
    this.retiredInference += old.inferenceMs;
    this.current = change.slot;
    change.slot.priming = false;
    this.switching = undefined;
    clearTimeout(change.timer);
    for (const event of change.slot.events) this.emit(event);
    change.slot.events = [];
    change.resolve(change.slot.port!.metadata);
    this.retire(old);
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
      this.commit(change);
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
  async inputSources(sources: AudioSource[], changed: AudioSource[]) {
    this.cancel();
    for (const source of changed) {
      this.history.delete(source);
      this.progress.delete(source);
      await this.current.port!.discard(source);
    }
    this.sources = new Set(sources);
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
