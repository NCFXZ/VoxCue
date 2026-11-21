import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { abortable } from '../cancellable';
import type {
  AudioSource,
  SpeechServiceCall,
  SpeechOptions,
  SpeechEvent,
  SpeechStatus,
  AudioDevice,
  InterviewInputState,
} from '../../contracts/speech';
import type { AudioPacket } from './buffer';
import { InterviewRecording, recordingBacklog } from './recording';
import { loadAudioPreprocessor, type AudioPreprocessor } from './preprocessor';
import { RecordingChannel } from './recordingChannel';
import {
  inputSources,
  inputSourceEnabled,
  questionSource,
  sameAudioCapture,
  speechModelLabels,
  speechSwitchCancelled,
  speechSelection,
} from '../../contracts/speechSettings';
export interface NativeCapture {
  start(): Promise<void>;
  stop(intent?: 'recover'): Promise<void>;
  readonly terminalError?: Error;
  readonly retiring?: boolean;
}
export interface CaptureAdapter {
  /** Current time in the native packet timestamp domain, in milliseconds. */
  captureClockNow?(): number;
  readonly drainBeforeRetire?: boolean;
  readonly automaticRestart?: boolean;
  readonly preprocessorFile?: string;
  readonly qwenRuntime?: string;
  devices(helper: string): Promise<AudioDevice[]>;
  create(
    helper: string,
    source: AudioSource,
    device: string | undefined,
    audio: (packet: AudioPacket) => void,
    failure: (message: string, recoverable?: boolean) => void,
  ): NativeCapture;
}
export const speechModelName = speechModelLabels.paraformer;
const echoFailure = '本地回声消除或语音推理失败，采集已停止；请重新开始。';
const recordingFailure = '录音写入失败，请检查可用空间。';
export class SpeechController {
  private recording?: InterviewRecording;
  private recordingDrain = Promise.resolve();
  private recordingError?: string;
  private interviewDsp?: AudioPreprocessor;
  private recordingChannels = new Map<AudioSource, RecordingChannel>();
  private recordingStop?: { at: number; drained(): void };
  private inputResumeClock = new Map<AudioSource, number>();
  private worker?: Worker;
  private failedWorker?: Worker;
  private unflushedTail = false;
  private ready?: Promise<void>;
  private loadingTimer?: ReturnType<typeof setTimeout>;
  private captures = new Map<AudioSource, NativeCapture>();
  private queued = 0;
  private pendingAudio = new Map<number, { source: AudioSource; ms: number }>();
  private pendingBySource = { system: 0, microphone: 0 };
  private drainingQwenQueue = false;
  private processedThrough = new Map<AudioSource, number>();
  private maxQueue = 0;
  private sequence = 0;
  private discontinuities = 0;
  private recentGaps = new Map<AudioSource, number[]>();
  private droppedSamples = 0;
  private flushers = new Map<number, { resolve(): void; reject(error: Error): void }>();
  private anchors = new Map<AudioSource, { native: number; wall: number }>();
  private status: SpeechStatus = { state: 'idle', model: speechModelName };
  private serial = Promise.resolve();
  private recoveryDrain?: Promise<PromiseSettledResult<void>[]>;
  private restartGeneration = 0;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private restartStartup?: AbortController;
  private restartAttempts = 0;
  private runningSince = 0;
  private lastProgress = 0;
  private wanted = false;
  private closed = false;
  private epoch = 0;
  private selection = speechSelection({ sources: [] });
  private chunkMs?: number;
  private alignmentDevice?: string;
  private options?: SpeechOptions;
  private reloadAfterStop = false;
  private inputState: InterviewInputState = { inputMode: 'remote', microphoneMuted: false };
  private managedInput = false;
  private blockedInput = new Set<AudioSource>();
  private inputCleanup = Promise.resolve();
  private changingInput?: {
    previous: InterviewInputState;
    epoch: number;
    worker?: Worker;
    added: Map<AudioSource, NativeCapture>;
    reject(error: Error): void;
  };
  private switching?: {
    id: number;
    selection: ReturnType<typeof speechSelection>;
    options: SpeechOptions;
    phase: 'loading' | 'waiting';
    expedited?: boolean;
    resolve(status: SpeechStatus): void;
    reject(error: Error): void;
  };
  constructor(
    private model: string,
    private helper: string,
    private emit: (e: SpeechEvent) => void,
    private adapter: CaptureAdapter,
    private qwenDirectory?: string,
  ) {}
  call(call: SpeechServiceCall): Promise<SpeechStatus> {
    if (call.op === 'status') {
      // A WASAPI helper can report a terminal fault in its final stderr bytes.
      // Let the bounded native drain settle before reporting which input needs attention.
      if (this.recoveryDrain && [...this.captures.values()].some(capture => capture.terminalError))
        return this.recoveryDrain.then(() => this.status);
      return Promise.resolve(this.status);
    }
    if (this.closed) return Promise.reject(Error('语音服务已关闭。'));
    if (call.op === 'start' || call.op === 'stop' || call.op === 'pause') {
      this.cancelRestart();
      if (call.op === 'start') {
        this.wanted = true;
        this.restartAttempts = 0;
      } else if (call.op === 'stop' || call.op === 'pause') this.wanted = false;
    }
    if (call.op === 'set-input-state') return this.setInputState(call.state);
    if (call.op === 'cancel-input-state') {
      if (this.changingInput) this.cancelRestart();
      return this.cancelInputState();
    }
    if (call.op === 'switch-recognizer') return this.switchRecognizer(call.options);
    if (call.op === 'control-switch') {
      const change = this.switching;
      if (change?.id === call.id && (call.action === 'cancel' || change.phase === 'waiting')) {
        this.worker?.postMessage(call.action === 'cancel'
          ? { op: 'cancel-switch', manual: true }
          : { op: 'expedite-switch', manual: true });
      }
      return Promise.resolve(this.status);
    }
    if (call.op === 'cancel-switch') {
      if (this.switching) this.cancelRestart();
      this.cancelSwitch();
      return Promise.resolve(this.status);
    }
    if (call.op === 'stop' || call.op === 'pause') {
      this.cancelSwitch(false);
      void this.cancelInputState().catch(() => {});
    }
    if (call.op === 'stop') return this.enqueue(async () => {
      try {
        const status = await this.execute(call);
        return {
          ...status,
          ...(this.unflushedTail ? { transcriptTailIncomplete: true as const } : {}),
          ...(this.recordingError ? { recordingError: this.recordingError } : {}),
        };
      } finally {
        this.unflushedTail = false;
        this.recordingError = undefined;
      }
    });
    return this.enqueue(() => this.execute(call));
  }
  private enqueue(action: () => Promise<SpeechStatus>) {
    const result = this.serial.then(action);
    this.serial = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private cancelRestart() {
    const starting = this.restartStartup;
    ++this.restartGeneration;
    this.restartStartup?.abort(Error('音频自动恢复已取消。'));
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    if (
      this.status.error === '音频已中断，正在自动重新连接…' ||
      (starting && this.status.state === 'loading')
    )
      this.state('error', '音频自动恢复已取消，请手动重新连接。', this.status.failureSource);
  }
  private state(
    state: SpeechStatus['state'],
    error?: string,
    failureSource?: SpeechStatus['failureSource'],
  ) {
    this.status = {
      state,
      model:
        this.selection.speechModel === 'qwen'
          ? `${speechModelLabels.qwen} · ${this.selection.inferenceDevice === 'metal' ? 'Metal' : this.selection.inferenceDevice.toUpperCase()}${this.alignmentDevice === 'cpu' && this.selection.inferenceDevice !== 'cpu' ? ' · 对齐 CPU' : ''} · 本地`
          : speechModelName,
      ...this.selection,
      ...(this.chunkMs ? { chunkMs: this.chunkMs } : {}),
      ...(error ? { error } : {}),
      ...(failureSource ? { failureSource } : {}),
      ...(this.switching ? { switching: this.switching.phase, switchId: this.switching.id } : {}),
      ...(this.managedInput ? { inputState: { ...this.inputState } } : {}),
    };
    this.emit({ type: 'status', status: this.status });
    return this.status;
  }
  private cancelSwitch(publish = true) {
    const change = this.switching;
    if (!change) return;
    this.switching = undefined;
    // A commit notification may already be in flight when pause cancels its
    // promise. Retire the recognizer after draining so resume cannot reuse a
    // different model under the old confirmed selection.
    if (!publish) this.reloadAfterStop = true;
    this.worker?.postMessage({ op: 'cancel-switch' });
    change.reject(Error(speechSwitchCancelled));
    if (publish) this.state(this.status.state);
    else this.status = { ...this.status, switching: undefined, switchId: undefined };
  }
  private switchRecognizer(options: SpeechOptions): Promise<SpeechStatus> {
    if (
      this.changingInput ||
      this.blockedInput.size ||
      this.switching ||
      this.status.state !== 'running' ||
      !this.worker ||
      !this.options ||
      !sameAudioCapture(this.options, options)
    )
      return Promise.reject(Error('语音切换需要保持当前采集设备且没有其他切换正在进行。'));
    this.cancelRestart();
    const selection = speechSelection(options);
    if (selection.speechModel === 'qwen' && !this.qwenDirectory)
      return Promise.reject(Error('当前平台不支持多语言语音识别。'));
    if (JSON.stringify(selection) === JSON.stringify(this.selection))
      return Promise.resolve(this.status);
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.switching = {
        id,
        selection,
        options: structuredClone(options),
        phase: 'loading',
        resolve,
        reject,
      };
      this.state('running');
      this.worker!.postMessage({
        op: 'stage-recognizer',
        id,
        options: {
          ...selection,
          directory: selection.speechModel === 'qwen' ? this.qwenDirectory : this.model,
          runtimeFile: this.adapter.qwenRuntime,
          legacyModels: [path.join(path.dirname(this.helper), 'silero_vad.onnx'), path.join(this.model, 'silero_vad.onnx')],
        },
      });
      this.expediteDowngrade();
    });
  }
  private expediteDowngrade() {
    const change = this.switching;
    // Four seconds of combined unacknowledged PCM is already two seconds
    // behind on a dual-input interview. Only expedite an explicit downgrade.
    if (
      this.queued < 4000 || !change || change.expedited ||
      this.selection.speechModel !== 'qwen' || change.selection.speechModel !== 'paraformer'
    ) return;
    change.expedited = true;
    this.worker!.postMessage({ op: 'expedite-switch' });
  }
  private inputEnabled(source: AudioSource) {
    return !this.blockedInput.has(source) && inputSourceEnabled(this.inputState, source);
  }
  private inputBoundary(worker: Worker, state: InterviewInputState, changed: AudioSource[]) {
    const id = ++this.sequence;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.flushers.delete(id);
          reject(Error('音频输入切换超时，请重新连接音频。'));
        },
        this.selection.speechModel === 'qwen' ? 120000 : 10000,
      );
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
      try {
        worker.postMessage({ op: 'set-input-state', id, state, changed });
      } catch (error) {
        clearTimeout(timer);
        this.flushers.delete(id);
        reject(error);
      }
    });
  }
  private setInputState(value: InterviewInputState): Promise<SpeechStatus> {
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).some(
        (key) => !['inputMode', 'microphoneMuted', 'systemAudioMuted'].includes(key),
      ) ||
      !['remote', 'transcription'].includes(value.inputMode) ||
      typeof value.microphoneMuted !== 'boolean' ||
      (value.systemAudioMuted !== undefined && typeof value.systemAudioMuted !== 'boolean')
    )
      return Promise.reject(Error('Invalid interview input state'));
    if (
      this.changingInput ||
      this.blockedInput.size ||
      this.switching ||
      !['running', 'paused'].includes(this.status.state) ||
      !this.options
    )
      return Promise.reject(Error('音频输入正在切换或尚未就绪，请稍后重试。'));
    this.cancelRestart();
    const state = { ...value },
      previous = { ...this.inputState };
    const changed: AudioSource[] =
      state.inputMode !== previous.inputMode
        ? ['microphone', 'system']
        : [
            ...(state.microphoneMuted !== previous.microphoneMuted ? ['microphone' as const] : []),
            ...(!!state.systemAudioMuted !== !!previous.systemAudioMuted
              ? ['system' as const]
              : []),
          ];
    if (!changed.length) {
      this.managedInput = true;
      return Promise.resolve(this.state(this.status.state));
    }
    this.blockedInput = new Set(changed);
    this.endRecordingSources(changed);
    return new Promise<SpeechStatus>((resolve, reject) => {
      const change = {
        previous,
        epoch: this.epoch,
        worker: this.worker,
        added: new Map<AudioSource, NativeCapture>(),
        reject,
      };
      this.changingInput = change;
      const active = () => this.changingInput === change && this.epoch === change.epoch;
      void (async () => {
        if (this.status.state === 'running') {
          const required = inputSources(state).filter((source) => !this.captures.has(source));
          const available = required.length ? await this.adapter.devices(this.helper) : [];
          if (!active()) return;
          for (const source of inputSources(state)) {
            if (this.captures.has(source)) continue;
            if (!active()) return;
            if (
              !available.some(
                (device) =>
                  device.source === source &&
                  (!this.options![source] || device.id === this.options![source]),
              )
            )
              throw Error('所选音频设备已不可用，请刷新设备列表。');
            const capture = this.capture(source, this.options!, change.epoch);
            this.captures.set(source, capture);
            change.added.set(source, capture);
            await capture.start();
            if (!active()) return;
          }
        }
        if (!active()) return;
        if (change.worker) {
          await this.inputBoundary(change.worker, state, changed);
        }
        if (!active()) return;
        if (changed.includes('microphone') || change.added.size) {
          this.interviewDsp?.start([...this.captures.keys()]);
          this.recordingChannels.delete('microphone');
        }
        this.inputState = state;
        this.managedInput = true;
        this.options = { ...this.options!, sources: inputSources(state) };
        for (const source of changed) {
          this.processedThrough.delete(source);
          if (!inputSourceEnabled(previous, source) && inputSourceEnabled(state, source))
            this.inputResumeClock.set(source, this.adapter.captureClockNow?.() ?? Date.now());
        }
        this.changingInput = undefined;
        this.blockedInput.clear();
        resolve(this.state(this.status.state));
      })().catch(async (error) => {
        if (!active()) return;
        // Keep the confirmed old state if a newly required device cannot open.
        const failure = error instanceof Error ? error : Error('音频输入切换失败。');
        await this.cancelInputState(failure).catch(() => {});
      });
    });
  }
  private cancelInputState(error = Error('音频输入切换已取消。')): Promise<SpeechStatus> {
    const change = this.changingInput;
    if (!change) return this.inputCleanup.then(() => this.status);
    this.changingInput = undefined;
    change.reject(error);
    const changed = [...this.blockedInput];
    this.inputCleanup = (async () => {
      for (const [source, capture] of change.added) {
        if (this.captures.get(source) === capture) this.captures.delete(source);
        this.anchors.delete(source);
        await capture.stop();
      }
      if (change.worker && change.worker === this.worker)
        await this.inputBoundary(change.worker!, change.previous, changed);
      this.blockedInput.clear();
    })().catch((failure) => {
      this.reloadAfterStop = true;
      this.fail(failure instanceof Error ? failure.message : '音频输入切换失败。');
      throw failure;
    });
    return this.inputCleanup.then(() => this.status);
  }
  private capture(source: AudioSource, options: SpeechOptions, epoch: number, levelsOnly = false): NativeCapture {
    let sumSquares = 0;
    let sampleCount = 0;
    const capture = this.adapter.create(
      this.helper,
      source,
      options[source],
      (p) => {
        if (epoch !== this.epoch || this.captures.get(source) !== capture) return;
        if (levelsOnly) {
          for (const value of p.samples) sumSquares += value * value;
          sampleCount += p.samples.length;
          if (sampleCount >= p.rate * 0.08) {
            const level = Math.min(1, Math.sqrt(sumSquares / sampleCount));
            this.emit({ type: 'activity', source, level, speaking: false });
            sumSquares = sampleCount = 0;
          }
          return;
        }
        const validClock = !(p.flags & 4) && Number.isFinite(p.timestamp);
        let anchor = this.anchors.get(source);
        if (!anchor && validClock) {
          anchor = { native: p.timestamp, wall: Date.now() };
          this.anchors.set(source, anchor);
        }
        try {
          this.audio(
            source, p.samples, p.rate, p.flags,
            validClock ? anchor!.wall + p.timestamp - anchor!.native : Date.now(),
            validClock ? p.timestamp : undefined,
          );
        } catch (error) {
          if (!this.interviewDsp) throw error;
          this.fail(echoFailure);
        }
      },
      (message, recoverable) => {
        if (epoch === this.epoch && this.captures.get(source) === capture)
          this.fail(message, source, !levelsOnly && recoverable);
      },
    );
    return capture;
  }
  private load() {
    if (this.ready) return this.ready;
    const worker = new Worker(path.join(__dirname, 'worker.js'));
    this.worker = worker;
    this.failedWorker = undefined;
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          reject(Error('语音模型加载超时。'));
          void worker.terminate();
        },
        this.selection.speechModel === 'qwen' ? 180000 : 60000,
      );
      this.loadingTimer = timer;
      worker.on('message', (m) => {
        if (this.worker !== worker) return;
        if (m.ready) {
          clearTimeout(timer);
          this.chunkMs = m.chunkMs;
          this.alignmentDevice = m.alignmentDevice;
          resolve();
        }
        if (m.event && this.failedWorker !== worker) {
          const source = m.event.type === 'segment' ? m.event.segment.source : m.event.source;
          if (!source || this.inputEnabled(source)) this.emit(m.event);
        }
        const change = this.switching;
        if (change && m.switchPhase === change.id) {
          change.phase = m.phase;
          this.state('running');
        }
        if (change && m.switched === change.id) {
          this.switching = undefined;
          // Qwen can have a valid backlog larger than Paraformer's 2s budget.
          // Keep its existing 30s cap while the new recognizer catches up;
          // Restore 2s only after all accepted packets are acknowledged. At
          // exactly 2s, the next live burst can arrive before the next ACK.
          this.drainingQwenQueue =
            this.selection.speechModel === 'qwen' &&
            change.selection.speechModel === 'paraformer' &&
            this.pendingAudio.size > 0;
          this.selection = change.selection;
          this.options = change.options;
          this.chunkMs = m.chunkMs;
          this.alignmentDevice = m.alignmentDevice;
          change.resolve(this.state('running'));
        }
        if (change && m.switchError === change.id) {
          this.switching = undefined;
          const status = this.state('running');
          if (m.userCancelled) change.resolve({ ...status, switchCancelled: true });
          else change.reject(Error(m.message));
        }
        if (m.ack) {
          const packet = this.pendingAudio.get(m.ack);
          if (!packet) return;
          this.lastProgress = performance.now();
          this.pendingAudio.delete(m.ack);
          this.pendingBySource[packet.source]--;
          this.queued = this.pendingAudio.size ? Math.max(0, this.queued - packet.ms) : 0;
          if (!this.pendingAudio.size) this.drainingQwenQueue = false;
          for (const source of ['microphone', 'system'] as const) {
            const through = m.progress?.[source];
            const previous = this.processedThrough.get(source) ?? -Infinity;
            const advanced = Number.isFinite(through) && through > previous;
            if (advanced) this.processedThrough.set(source, through);
            // While an interview source is backlogged it cannot authorize a question.
            // Keep the exact clock internally and publish the empty transition immediately.
            const update = advanced && (!this.managedInput || !this.pendingBySource[source] ||
              Math.floor(through / 100) > Math.floor(previous / 100));
            if (update || (source === packet.source && !this.pendingBySource[source]))
              this.progress(source);
          }
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
        const completed = m.flushed ?? m.prepared ?? m.closed ?? m.inputSet;
        if (completed) {
          this.flushers.get(completed)?.resolve();
          this.flushers.delete(completed);
        }
        if (m.error) {
          this.failedWorker = worker;
          clearTimeout(timer);
          reject(Error(m.error));
          for (const pending of this.flushers.values()) pending.reject(Error(m.error));
          this.flushers.clear();
          this.fail(m.error);
        }
      });
      worker.on('error', () => {
        if (this.worker !== worker) return;
        this.failedWorker = worker;
        clearTimeout(timer);
        reject(Error('语音识别进程异常，请检查模型后重新开始。'));
        for (const pending of this.flushers.values())
          pending.reject(Error('语音识别进程异常，尾段无法处理，请重新开始。'));
        this.flushers.clear();
        this.fail('语音识别进程异常，请重新开始。', 'model', true);
      });
      worker.on('exit', () => {
        clearTimeout(timer);
        if (this.worker !== worker) return;
        reject(Error('语音识别进程在初始化完成前已退出，请重新开始。'));
        this.worker = undefined;
        this.ready = undefined;
        const flushing = this.flushers.size > 0;
        for (const pending of this.flushers.values())
          pending.reject(Error('语音识别进程在尾段处理完成前退出，请重新开始。'));
        this.flushers.clear();
        if (this.captures.size) this.fail('语音识别进程已退出，采集已停止。', 'model', true);
        else if (flushing)
          this.state('error', '语音识别进程在尾段处理完成前退出，请重新开始。', 'model');
      });
      worker.postMessage({
        op: 'init',
        directory: this.selection.speechModel === 'qwen' ? this.qwenDirectory : this.model,
        ...this.selection,
        runtimeFile: this.adapter.qwenRuntime,
        legacyModels: [path.join(path.dirname(this.helper), 'silero_vad.onnx'), path.join(this.model, 'silero_vad.onnx')],
      });
    });
    return this.ready;
  }
  private progress(source: AudioSource) {
    if (!this.inputEnabled(source) ||
      (this.managedInput && source !== questionSource(this.inputState.inputMode))) return;
    this.emit({
      type: 'audio-progress',
      source,
      pending: this.pendingBySource[source] > 0,
      processedThroughMs: this.processedThrough.get(source),
    });
  }
  private clearAudioQueue() {
    this.queued = 0;
    this.pendingAudio.clear();
    this.pendingBySource = { system: 0, microphone: 0 };
    this.processedThrough.clear();
  }
  private audio(
    source: AudioSource,
    samples: Float32Array,
    rate: number,
    flags = 0,
    timestamp = Date.now(),
    captureClock?: number,
  ) {
    const enabled = this.inputEnabled(source);
    const reference = source === 'system' && this.inputEnabled('microphone') ? this.interviewDsp : undefined;
    if (!enabled && !reference) return;
    if (flags & 1) {
      this.discontinuities++;
      const now = Date.now();
      const gaps = [...(this.recentGaps.get(source) ?? []).filter((at) => now - at < 10000), now];
      this.recentGaps.set(source, gaps);
      const affected = this.interviewDsp?.discontinuity(source) ?? [source];
      this.endRecordingSources(affected);
      for (const lane of affected) {
        if (this.inputEnabled(lane)) this.worker?.postMessage({ op: 'gap', source: lane });
      }
      if (enabled) this.emit({
        type: 'gap',
        source,
        message: `${source === 'system' ? '系统音频' : '麦克风'}发生短暂间断，转写已继续；不完整片段不会自动用于回答。`,
      });
      if (gaps.length >= 5) {
        this.fail(
          '音频在十秒内连续中断五次，采集已停止；请检查设备或降低负载后重新开始。',
          source,
          true,
        );
        return;
      }
    }
    // AEC can retain raw input while aligning the endpoints. Give it its own
    // buffer when the same capture will be transferred to the recognizer.
    reference?.feed(source, enabled ? samples.slice() : samples, rate, timestamp, captureClock);
    if (!enabled) return;
    const resumeClock = this.inputResumeClock.get(source);
    if (resumeClock !== undefined && (this.recording || this.interviewDsp)) {
      if (captureClock === undefined) return;
      const packetStart = this.adapter.captureClockNow ? captureClock : timestamp;
      const skip = Math.max(0, Math.ceil(((resumeClock - packetStart) * rate) / 1000));
      if (skip >= samples.length) return;
      this.inputResumeClock.delete(source);
      // The worker takes ownership of the backing buffer as well as the view.
      if (skip) samples = samples.slice(skip);
      timestamp += (skip * 1000) / rate;
      captureClock += (skip * 1000) / rate;
    }
    if (this.interviewDsp && source === 'microphone') {
      this.interviewDsp.feed(source, samples, rate, timestamp, captureClock);
      return;
    }
    this.recordAudio(source, samples, rate, timestamp);
    this.sendToRecognizer(source, samples, rate, timestamp, captureClock);
  }
  private sendToRecognizer(
    source: AudioSource,
    samples: Float32Array,
    rate: number,
    timestamp: number,
    captureClock?: number,
  ) {
    if (!this.worker || this.worker === this.failedWorker) return;
    const ms = (samples.length / rate) * 1000;
    const limit = this.selection.speechModel === 'qwen' || this.drainingQwenQueue ? 30000 : 2000;
    if (this.queued + ms > limit) {
      this.droppedSamples += samples.length;
      this.unflushedTail = true;
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
      // Re-running an overloaded Qwen or flushing its entire backlog can
      // monopolize the machine for minutes. The recording has its own drain.
      const overloadedQwen = this.selection.speechModel === 'qwen';
      if (overloadedQwen) this.failedWorker = this.worker;
      this.fail(
        overloadedQwen
          ? '多语言语音识别的转写积压已达上限，采集已停止。未完成的转写可能缺失，可切换到轻量语音识别继续面试。'
          : '识别积压超过安全上限，采集已停止；请降低负载或切换推理设备后重试。',
        overloadedQwen ? 'model' : 'service',
        !overloadedQwen,
      );
      return;
    }
    this.queued += ms;
    this.maxQueue = Math.max(this.maxQueue, this.queued);
    const sequence = ++this.sequence;
    this.pendingAudio.set(sequence, { source, ms });
    this.expediteDowngrade();
    // Publish the backlog before the worker can emit a final. A final decoded
    // from old audio is insufficient while newer system audio is unchecked.
    if (++this.pendingBySource[source] === 1) this.progress(source);
    this.worker?.postMessage(
      {
        op: 'audio',
        source,
        samples,
        rate,
        timestamp,
        ...(captureClock !== undefined ? { captureClock } : {}),
        sequence,
        ms,
      },
      [samples.buffer as ArrayBuffer],
    );
  }
  private fail(
    message: string,
    failureSource: SpeechStatus['failureSource'] = 'service',
    recoverable = false,
  ) {
    if (this.status.state === 'error') return;
    const interruptedCapture = this.status.state === 'running' && this.captures.size > 0;
    if (interruptedCapture && (this.worker ? this.worker === this.failedWorker : failureSource === 'model'))
      this.unflushedTail = true;
    const generation = this.restartGeneration;
    const current = () => generation === this.restartGeneration && !this.closed && this.wanted;
    const restart = !!(
      this.adapter.automaticRestart &&
      recoverable &&
      this.status.state === 'running' &&
      this.options &&
      !this.switching &&
      !this.changingInput &&
      !this.blockedInput.size &&
      current()
    );
    // A brief successful open must not replenish an endlessly failing loop.
    if (
      restart &&
      performance.now() - this.runningSince >= 30000 &&
      performance.now() - this.lastProgress < 2000
    )
      this.restartAttempts = 0;
    const options = this.options && structuredClone(this.options);
    const inputState = this.managedInput ? { ...this.inputState } : undefined;
    this.cancelSwitch(false);
    this.state('error', message, failureSource);
    void this.enqueue(async () => {
      try {
        await this.execute({ op: 'stop' }, { stopIntent: restart && current() ? 'recover' : undefined });
      } catch (error) {
        if (interruptedCapture) this.unflushedTail = true;
        throw error;
      }
      if (!current()) return this.status;
      this.state('error', message, failureSource);
      if (!restart) return this.status;
      // Capture.stop has confirmed native close. Retire the recognizer too,
      // so the next attempt cannot inherit a partial or unhealthy session.
      await this.retireWorker();
      if (!current()) return this.status;
      if (this.restartAttempts >= 3) {
        this.state(
          'error',
          '音频自动恢复已达到重试上限，请检查设备或模型后重新连接。',
          failureSource,
        );
        return this.status;
      }
      const delay = 1000 * 2 ** this.restartAttempts++;
      for (const source of options!.sources)
        this.emit({ type: 'gap', source, message: '音频发生中断，不完整片段不会自动用于回答。' });
      this.state('error', '音频已中断，正在自动重新连接…', failureSource);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = undefined;
        if (!current()) return;
        void this.enqueue(async () => {
          if (!current()) return this.status;
          const startup = new AbortController();
          this.restartStartup = startup;
          try {
            return await this.execute(
              { op: 'start', options: options!, inputState },
              { current, signal: startup.signal },
            );
          } finally {
            if (this.restartStartup === startup) this.restartStartup = undefined;
          }
        }).catch((error) => {
          // Device enumeration can fail before entering startup. Preserve a
          // terminal error rather than leaving a reconnection notice forever.
          if (current()) this.state('error', (error as Error).message, failureSource);
        });
      }, delay);
      return this.status;
    }).catch(() => {
      if (generation === this.restartGeneration && (!restart || this.status.state !== 'error'))
        this.state('error', message, failureSource);
    });
  }
  private checkStartup(requireWorker = true) {
    if ((requireWorker && !this.worker) || this.status.state === 'error')
      throw Error(this.status.error || '语音识别进程已退出，请重新开始。');
  }
  private recordAudio(
    source: AudioSource,
    samples: Float32Array,
    rate: number,
    timestamp: number,
  ) {
    if (!this.recording) return;
    try {
      const stop = this.recordingStop;
      const count = stop
        ? Math.max(0, Math.ceil(((stop.at - timestamp) * rate) / 1000))
        : samples.length;
      const skip = Math.max(0, Math.ceil(((this.recording.startedAt - timestamp) * rate) / 1000));
      const chunk = samples.subarray(skip, count);
      if (chunk.length) {
        const start = timestamp + skip * 1000 / rate;
        let channel = this.recordingChannels.get(source);
        if (channel?.rate !== rate) {
          channel = new RecordingChannel(source, rate);
          this.recordingChannels.set(source, channel);
        }
        this.recording.append(source, channel.process(chunk), rate, start);
      }
      if (source === 'microphone' && count <= samples.length) stop?.drained();
    } catch (error) {
      void this.finishRecording(error);
    }
  }
  private endRecordingSources(sources: AudioSource[]) {
    try {
      for (const source of sources) {
        this.recording?.endSource(source);
        this.recordingChannels.delete(source);
      }
    } catch (error) {
      void this.finishRecording(error);
    }
  }
  private finishRecording(cause?: unknown) {
    const writer = this.recording;
    if (!writer) return this.recordingDrain;
    this.recording = undefined;
    this.recordingChannels.clear();
    const stop = this.recordingStop;
    stop?.drained();
    this.recordingStop = undefined;
    const error = cause instanceof Error && cause.message === recordingBacklog ? recordingBacklog :
      cause === undefined ? undefined : recordingFailure;
    this.recordingDrain = writer.close(stop?.at).then(
      () => this.emit({ type: 'recording', active: false }),
      () => {
        this.recordingError = recordingFailure;
        this.emit({ type: 'recording', active: false, error: recordingFailure });
      },
    );
    if (error) {
      this.recordingError = error;
      this.emit({ type: 'recording', active: false, draining: true, error });
    }
    return this.recordingDrain;
  }
  private async execute(
    call: SpeechServiceCall,
    { current = () => true, signal, stopIntent }: {
      current?: () => boolean;
      signal?: AbortSignal;
      stopIntent?: 'recover';
    } = {},
  ): Promise<SpeechStatus> {
    const waiting = <T>(task: Promise<T>) => (signal ? abortable(task, signal) : task);
    if (call.op === 'recording') {
      if (!call.directory) {
        if (this.recording && this.interviewDsp && this.inputEnabled('microphone')) {
          // Let delayed AEC output reach the cut without resetting its learned echo path.
          await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, 150);
            this.recordingStop = { at: Date.now(), drained() { clearTimeout(timer); resolve(); } };
          });
        }
        await this.finishRecording();
      } else if (!this.recording) {
        if (!this.managedInput || this.status.state !== 'running') throw Error('请先开始本地语音面试。');
        await this.recordingDrain;
        const writer = new InterviewRecording(call.directory, Date.now(), () => {
          void this.finishRecording(recordingFailure);
        });
        this.recording = writer;
        try {
          await writer.ready;
        } catch {
          this.recording = undefined;
          this.recordingChannels.clear();
          throw Error(recordingFailure);
        }
        if (this.recording === writer) this.emit({ type: 'recording', active: true });
      }
      return { ...this.status, recording: !!this.recording };
    }
    if (call.op === 'devices')
      return { ...this.status, devices: await this.adapter.devices(this.helper) };
    await this.inputCleanup.catch(() => {});
    if (call.op === 'pause' || call.op === 'stop') {
      if (!this.adapter.drainBeforeRetire) ++this.epoch;
      const captures = [...this.captures];
      const draining = Promise.allSettled(
        captures.map(async ([, capture]) => capture.stop(stopIntent)),
      );
      if (stopIntent === 'recover' && this.adapter.drainBeforeRetire) this.recoveryDrain = draining;
      const stopped = await draining;
      this.recoveryDrain = undefined;
      let dspFailed = false;
      try {
        this.interviewDsp?.flush();
      } catch {
        dspFailed = true;
      } finally {
        this.interviewDsp?.close();
        this.interviewDsp = undefined;
      }
      const recordingDrain = this.finishRecording();
      if (this.adapter.drainBeforeRetire) ++this.epoch;
      this.captures.clear();
      this.anchors.clear();
      this.recentGaps.clear();
      if (dspFailed || stopped.some((result) => result.status === 'rejected')) {
        const worker = this.worker;
        this.worker = undefined;
        this.ready = undefined;
        this.clearAudioQueue();
        // An attributed native diagnostic is available only for the endpoint
        // that actually blocked recovery. Generic stop failures stay service errors.
        const diagnosed = stopIntent === 'recover' ? captures.find(([, capture], index) => {
          const result = stopped[index];
          return result.status === 'rejected' && capture.terminalError !== undefined &&
            result.reason === capture.terminalError;
        }) : undefined;
        const message = diagnosed?.[1].terminalError?.message ??
          (dspFailed ? echoFailure : '音频采集未能正常停止，请重新开始。');
        // Status queries waiting on native close must see its final diagnostic even on slow disks.
        this.state('error', message, diagnosed?.[0] ?? 'service');
        try {
          await worker?.terminate();
        } finally {
          await recordingDrain;
        }
        throw Error(message);
      }
      try {
        if (this.worker && this.worker === this.failedWorker) {
          // An overloaded worker can retire as soon as native capture has stopped.
          const worker = this.worker;
          this.worker = undefined;
          this.ready = undefined;
          this.failedWorker = undefined;
          await worker.terminate();
        }
        if (this.worker && this.ready) {
          const id = ++this.sequence;
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => {
                  this.flushers.delete(id);
                  reject(Error('语音尾段处理超时。'));
                },
                this.selection.speechModel === 'qwen' ? 120000 : 5000,
              );
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
            this.clearAudioQueue();
            await worker?.terminate();
            this.state('error', (error as Error).message);
            throw error;
          }
        }
        this.clearAudioQueue();
        this.drainingQwenQueue = false;
        if (this.reloadAfterStop) await this.retireWorker();
      } finally {
        // Returning from stop makes the history and its recordings available.
        await recordingDrain;
      }
      return this.state(call.op === 'pause' ? 'paused' : 'idle');
    }
    if (call.op !== 'start') throw Error('Invalid speech operation');
    if (this.captures.size) return this.status;
    this.inputResumeClock.clear();
    this.managedInput = !!call.inputState;
    this.inputState = call.inputState
      ? { ...call.inputState }
      : {
          inputMode: 'remote',
          microphoneMuted: !call.options.sources.includes('microphone'),
        };
    this.blockedInput.clear();
    this.drainingQwenQueue = false;
    const selection = speechSelection(call.options);
    if (selection.speechModel === 'qwen' && !this.qwenDirectory)
      throw Error('当前平台不支持多语言语音识别。');
    if (JSON.stringify(selection) !== JSON.stringify(this.selection)) await this.retireWorker();
    this.selection = selection;
    const available = await waiting(this.adapter.devices(this.helper));
    if (!current()) return this.status;
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
      if (!call.levelsOnly) {
        await waiting(this.load());
        if (!current()) throw Error('音频自动恢复已取消。');
        this.checkStartup();
        startupFailure = 'service';
        const id = ++this.sequence;
        await waiting(
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              this.flushers.delete(id);
              reject(Error('语音输入准备超时，请重新开始。'));
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
            this.worker!.postMessage({
              op: 'prepare',
              id,
              sources: call.options.sources,
              inputState: this.inputState,
            });
          }),
        );
        this.checkStartup();
        if (!current()) throw Error('音频自动恢复已取消。');
      }
      const epoch = ++this.epoch;
      let sources = call.options.sources;
      let missingReference = false;
      if (this.managedInput && !call.levelsOnly && this.adapter.preprocessorFile) {
        this.interviewDsp = await loadAudioPreprocessor(
          this.adapter.preprocessorFile,
          (source, samples, rate, timestamp, recognitionSamples = samples) => {
            if (source !== 'microphone' || !this.inputEnabled(source)) return;
            this.recordAudio(source, samples, rate, timestamp);
            this.sendToRecognizer(source, recognitionSamples.slice(), rate, timestamp);
          },
          () => this.fail(echoFailure),
          signal,
        );
        if (!current()) throw Error('音频自动恢复已取消。');
        if (sources.includes('microphone')) {
          // Establish the reference before the first mic packet, even when
          // playback is not a public input to this interview.
          const playback = available.some(device =>
            device.source === 'system' && (!call.options.system || device.id === call.options.system));
          if (playback) sources = ['system', 'microphone'];
          else missingReference = true;
        }
        this.interviewDsp.start(sources);
      }
      for (const source of sources) {
        startupFailure = source;
        const capture = this.capture(source, call.options, epoch, call.levelsOnly);
        this.captures.set(source, capture);
        try {
          await waiting(capture.start());
        } catch (error) {
          // An in-person interview can still use its mic without a loopback endpoint.
          if (source !== 'system' || call.options.sources.includes(source) || !current()) throw error;
          try {
            await capture.stop();
          } catch (stopError) {
            // A denied optional endpoint may exit nonzero. Only continue if
            // its adapter confirms it no longer owns a retiring native process.
            if (capture.retiring !== false) throw stopError;
          }
          this.captures.delete(source);
          this.anchors.delete(source);
          this.interviewDsp!.start(call.options.sources);
          missingReference = true;
        }
        if (!current()) throw Error('音频自动恢复已取消。');
        this.checkStartup(!call.levelsOnly);
      }
      // Native adapters own silence: Windows loopback uses its advancing
      // endpoint clock. Wall time alone cannot establish processed silence.
      this.options = structuredClone(call.options);
      this.runningSince = performance.now();
      this.lastProgress = 0;
      const status = this.state('running');
      if (missingReference) this.emit({
        type: 'gap', source: 'microphone', message: '系统播放参考不可用，麦克风无法消除扬声器回声。',
      });
      return status;
    } catch (error) {
      // Retire callbacks first. A second cleanup failure must not hide the
      // original startup error or leave this controller stuck with captures.
      ++this.epoch;
      this.interviewDsp?.close();
      this.interviewDsp = undefined;
      const captures = [...this.captures.values()];
      this.captures.clear();
      this.clearAudioQueue();
      this.anchors.clear();
      this.recentGaps.clear();
      this.ready = undefined;
      clearTimeout(this.loadingTimer);
      for (const pending of this.flushers.values()) pending.reject(error as Error);
      this.flushers.clear();
      const old = this.worker;
      this.worker = undefined;
      await Promise.allSettled(captures.map(async (capture) => capture.stop()));
      await old?.terminate();
      if (!current()) return this.status;
      return this.state(
        'error',
        (error as Error).message,
        this.status.failureSource ?? startupFailure,
      );
    }
  }
  async close() {
    this.cancelRestart();
    this.wanted = false;
    this.closed = true;
    try {
      await this.enqueue(() => this.execute({ op: 'stop' }));
    } finally {
      await this.retireWorker();
    }
  }
  private async retireWorker() {
    this.reloadAfterStop = false;
    this.drainingQwenQueue = false;
    const worker = this.worker;
    if (!worker) return;
    {
      const id = ++this.sequence;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        this.flushers.set(id, {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: () => {
            clearTimeout(timer);
            resolve();
          },
        });
        worker.postMessage({ op: 'close', id });
      });
      this.flushers.delete(id);
    }
    this.worker = undefined;
    this.ready = undefined;
    this.clearAudioQueue();
    this.chunkMs = undefined;
    this.alignmentDevice = undefined;
    await worker.terminate();
  }
}
