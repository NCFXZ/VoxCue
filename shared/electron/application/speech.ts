import type {
  DictationCall,
  InterviewConfiguration,
  SpeechServiceCall,
  SpeechStatus,
  SpeechOptions,
  InterviewInputMode,
  InterviewInputState,
  AudioSource,
  SpeechEvent,
} from '../contracts/speech';
import { validateSpeech } from '../backend/speech/validation';
import { reasoningEfforts, type ChatModel } from '../contracts/chat';
import { validProfile } from '../contracts/profile';
import { sameAudioCapture, speechSelection, inputSources } from '../contracts/speechSettings';

export function validateInterviewInput(value: unknown): InterviewInputState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('无效的音频输入设置。');
  const state = value as InterviewInputState;
  if (
    Object.keys(state).some(
      (key) => !['inputMode', 'microphoneMuted', 'systemAudioMuted'].includes(key),
    ) ||
    !Object.hasOwn(state, 'inputMode') ||
    !Object.hasOwn(state, 'microphoneMuted') ||
    !['remote', 'transcription'].includes(state.inputMode) ||
    typeof state.microphoneMuted !== 'boolean' ||
    (state.systemAudioMuted !== undefined && typeof state.systemAudioMuted !== 'boolean')
  )
    throw Error('无效的音频输入设置。');
  return {
    inputMode: state.inputMode,
    microphoneMuted: state.microphoneMuted,
    ...(state.systemAudioMuted !== undefined ? { systemAudioMuted: state.systemAudioMuted } : {}),
  };
}

function requireInterviewSources(
  options: SpeechOptions,
  inputMode?: InterviewInputMode,
  reconnect = false,
) {
  if (inputMode === 'transcription') {
    if (options.sources.length !== 1 || options.sources[0] !== 'microphone')
      throw Error('仅转录需要且只使用麦克风。');
  } else if (!options.sources.includes('system'))
    throw Error(reconnect ? '面试需保留系统音频。' : '面试官问题来自系统音频，请启用系统音频。');
}

export function validateInterviewConfiguration(value: unknown): InterviewConfiguration {
  if (!value || typeof value !== 'object') throw Error('无效的面试设置。');
  const v = value as InterviewConfiguration;
  if (
    Object.keys(v).some(
      (key) =>
        ![
          'mode',
          'inputMode',
          'options',
          'aiEnabled',
          'autoAnswer',
          'modelId',
          'effort',
          'profile',
          'knowledgeBaseId',
          'knowledgeBaseName',
        ].includes(key),
    ) ||
    !['local', 'mock'].includes(v.mode) ||
    (v.inputMode !== undefined && !['remote', 'transcription'].includes(v.inputMode)) ||
    typeof v.aiEnabled !== 'boolean' ||
    typeof v.autoAnswer !== 'boolean' ||
    typeof v.modelId !== 'string' ||
    v.modelId.length > 200 ||
    (v.effort !== undefined && v.effort !== 'auto' && !reasoningEfforts.includes(v.effort)) ||
    (v.aiEnabled && (v.mode !== 'local' || !v.modelId.trim())) ||
    (v.profile !== undefined && !validProfile(v.profile)) ||
    (v.knowledgeBaseName !== undefined &&
      (typeof v.knowledgeBaseName !== 'string' ||
        v.knowledgeBaseName.length > 100 ||
        /[\u0000-\u001f\u007f]/.test(v.knowledgeBaseName))) ||
    (v.knowledgeBaseId !== undefined &&
      v.knowledgeBaseId !== null &&
      (typeof v.knowledgeBaseId !== 'string' || !/^[\w-]{1,100}$/.test(v.knowledgeBaseId)))
  )
    throw Error('无效的面试设置。');
  const audio =
    v.mode === 'local' || v.inputMode === 'transcription'
      ? validateSpeech({ op: 'start', options: v.options })
      : undefined;
  if (audio?.op === 'start') requireInterviewSources(audio.options, v.inputMode);
  return {
    ...(v.inputMode !== undefined ? { inputMode: v.inputMode } : {}),
    mode: v.mode,
    options: audio?.op === 'start' ? structuredClone(audio.options) : { sources: [] },
    aiEnabled: v.aiEnabled,
    modelId: v.aiEnabled ? v.modelId : '',
    effort: v.aiEnabled ? (v.effort ?? 'auto') : 'auto',
    autoAnswer: v.autoAnswer,
    ...(v.profile ? { profile: structuredClone(v.profile) } : {}),
    ...(v.knowledgeBaseId !== undefined ? { knowledgeBaseId: v.knowledgeBaseId } : {}),
    ...(v.knowledgeBaseId && v.knowledgeBaseName
      ? { knowledgeBaseName: v.knowledgeBaseName.trim() }
      : {}),
  };
}

export function validateInterviewModel(configuration: InterviewConfiguration, models: ChatModel[]) {
  const model = models.find((m) => m.id === configuration.modelId);
  if (!model) throw Error('请先连接模型服务并选择账户可用的回答模型。');
  if (configuration.effort !== 'auto' && !model.reasoningEfforts?.includes(configuration.effort))
    throw Error('所选模型不支持该思考强度，请选择自动或刷新模型列表。');
}

interface SpeechPort {
  call(call: SpeechServiceCall): Promise<SpeechStatus>;
  stop(): void;
}
const idle = (): SpeechStatus => ({
  state: 'idle',
  model: 'Paraformer 中英 INT8 · Silero VAD · 本地',
});
// One native pipeline, with explicit ownership. Main-window dictation can never
// change an interview's devices, and confirming an interview flushes dictation first.
export class SpeechCoordinator {
  private confirmed?: InterviewConfiguration;
  private currentInput?: InterviewInputState;
  private inputOperation?: { sources: AudioSource[]; reject(error: Error): void };
  private tail: Promise<unknown> = Promise.resolve();
  private startingDictation = false;
  private dictationAttempt = 0;
  private dictationIntent = 0;
  private pending = 0;
  private running = false;
  private reconnectAttempt = 0;
  private testId?: string;
  private testTimer?: ReturnType<typeof setTimeout>;
  target: 'dictation' | 'audio-test' | 'interview' | undefined;
  constructor(private port: SpeechPort) {}
  get busy() {
    return this.pending > 0 || this.target !== undefined || this.confirmed !== undefined;
  }
  get configuration() {
    return this.confirmed ? structuredClone(this.confirmed) : undefined;
  }
  get inputState() {
    return this.currentInput && { ...this.currentInput };
  }
  get inputChanging() {
    return !!this.inputOperation;
  }
  blocksInput(event: SpeechEvent) {
    const source =
      event.type === 'segment'
        ? event.segment.source
        : 'source' in event
          ? event.source
          : undefined;
    return !!source && !!this.inputOperation?.sources.includes(source);
  }
  cancelInput() {
    const operation = this.inputOperation;
    if (!operation) return;
    this.inputOperation = undefined;
    operation.reject(Error('语音切换已取消，仍使用原配置。'));
    void this.port.call({ op: 'cancel-input-state' }).catch(() => {});
  }
  setInputState(value: unknown): Promise<SpeechStatus> {
    const state = validateInterviewInput(value);
    const configuration = this.confirmed;
    if (!configuration || configuration.mode !== 'local') throw Error('请先开始本地语音面试。');
    if (this.inputOperation || this.pending) throw Error('音频输入正在切换，请稍候。');
    let reject!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    const previous = this.currentInput!;
    const sources: AudioSource[] =
      previous.inputMode !== state.inputMode
        ? ['microphone', 'system']
        : [
            ...(previous.microphoneMuted !== state.microphoneMuted ? ['microphone' as const] : []),
            ...(!!previous.systemAudioMuted !== !!state.systemAudioMuted
              ? ['system' as const]
              : []),
          ];
    const operation = { sources, reject };
    this.inputOperation = operation;
    return (async () => {
      try {
        const status = await Promise.race([
          this.port.call({ op: 'set-input-state', state }),
          cancelled,
        ]);
        if (this.inputOperation !== operation || this.confirmed !== configuration)
          throw Error('语音切换已取消，仍使用原配置。');
        if (
          status.inputState?.inputMode !== state.inputMode ||
          status.inputState?.microphoneMuted !== state.microphoneMuted ||
          !!status.inputState?.systemAudioMuted !== !!state.systemAudioMuted
        ) {
          this.port.stop();
          this.running = false;
          throw Error('音频输入切换未能确认，请重新开始。');
        }
        configuration.inputMode = state.inputMode;
        configuration.options = { ...configuration.options, sources: inputSources(state) };
        this.currentInput = { ...state };
        this.running = status.state === 'running';
        return status;
      } finally {
        if (this.inputOperation === operation) this.inputOperation = undefined;
      }
    })();
  }
  updateModel(value: unknown, models: ChatModel[]) {
    if (!this.confirmed?.aiEnabled) throw Error('请先开始已连接模型的面试。');
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).some((key) => !['modelId', 'effort'].includes(key))
    )
      throw Error('无效的回答模型设置。');
    const update = value as Pick<InterviewConfiguration, 'modelId' | 'effort'>;
    const configuration = validateInterviewConfiguration({ ...this.confirmed, ...update });
    validateInterviewModel(configuration, models);
    this.confirmed.modelId = configuration.modelId;
    this.confirmed.effort = configuration.effort;
    return { modelId: configuration.modelId, effort: configuration.effort };
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    this.pending++;
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => {});
    return next.finally(() => this.pending--);
  }
  confirm(value: unknown) {
    const configuration = validateInterviewConfiguration(value);
    ++this.dictationIntent;
    this.clearTest();
    this.cancelDictationStart();
    return this.serialize(async () => {
      if (this.confirmed) {
        if ((this.confirmed.inputMode ?? 'remote') !== (configuration.inputMode ?? 'remote'))
          throw Error('本场输入方式已锁定，请结束面试后重新设置。');
        return;
      }
      if (this.target === 'dictation' || this.target === 'audio-test')
        await this.port.call({ op: 'stop' });
      this.port.stop();
      this.confirmed = configuration;
      this.currentInput = {
        inputMode: configuration.inputMode ?? 'remote',
        microphoneMuted: !configuration.options.sources.includes('microphone'),
      };
      this.target = 'interview';
    });
  }
  reconnect(value?: SpeechOptions) {
    if (this.inputChanging) throw Error('音频输入正在切换，请稍候。');
    const call = value === undefined ? undefined : validateSpeech({ op: 'start', options: value });
    if (call?.op === 'start')
      requireInterviewSources(call.options, this.confirmed?.inputMode, true);
    const attempt = ++this.reconnectAttempt;
    return this.serialize(async () => {
      if (!this.confirmed || this.confirmed.mode !== 'local') throw Error('请先开始本地语音面试。');
      const configuration = this.confirmed;
      const options = call?.op === 'start' ? structuredClone(call.options) : this.confirmed.options;
      const inputState = {
        inputMode: configuration.inputMode ?? ('remote' as const),
        microphoneMuted:
          configuration.inputMode === 'transcription'
            ? !!this.currentInput?.microphoneMuted
            : !options.sources.includes('microphone'),
        ...(this.currentInput?.systemAudioMuted !== undefined
          ? { systemAudioMuted: this.currentInput.systemAudioMuted }
          : {}),
      };
      requireInterviewSources(options, configuration.inputMode, true);
      if (
        value &&
        this.running &&
        sameAudioCapture(configuration.options, options) &&
        JSON.stringify(speechSelection(configuration.options)) !==
          JSON.stringify(speechSelection(options))
      ) {
        // Return the promise in a container so pause/end never queue behind model loading.
        return {
          change: this.port.call({ op: 'switch-recognizer', options }),
          configuration,
          options,
        };
      }
      try {
        await this.port.call({ op: 'stop' });
      } catch {
        /* Retire a failed native host before reconnecting. */
      }
      this.port.stop();
      if (this.confirmed !== configuration || attempt !== this.reconnectAttempt)
        return { status: idle() };
      this.target = 'interview';
      const status = await this.port.call({ op: 'start', options, inputState });
      if (this.confirmed !== configuration || attempt !== this.reconnectAttempt) {
        this.port.stop();
        return { status: idle() };
      }
      if (status.state === 'running') {
        configuration.options = options;
        this.currentInput = status.inputState ?? inputState;
      }
      this.running = status.state === 'running';
      return { status };
    }).then(async (result) => {
      if ('status' in result) return result.status!;
      const status = await result.change;
      if (this.confirmed !== result.configuration || attempt !== this.reconnectAttempt)
        return idle();
      if (status.state === 'running') result.configuration.options = result.options;
      return status;
    });
  }
  interview(value: unknown) {
    const call = validateSpeech(value);
    if (call.op === 'start' || call.op === 'pause' || call.op === 'stop') this.cancelInput();
    if (call.op === 'pause' || call.op === 'stop') {
      ++this.reconnectAttempt;
      this.running = false;
    }
    return this.serialize(async () => {
      const configuration = this.confirmed;
      if (!configuration) throw Error('请先确认开始面试。');
      if (call.op === 'start') {
        const options = configuration.options;
        if (
          configuration.mode !== 'local' ||
          call.options.sources.length !== options.sources.length ||
          call.options.sources.some((s) => !options.sources.includes(s)) ||
          (call.options.microphone ?? '') !== (options.microphone ?? '') ||
          (call.options.system ?? '') !== (options.system ?? '') ||
          (call.options.speechModel ?? 'paraformer') !== (options.speechModel ?? 'paraformer') ||
          (call.options.inferenceDevice ?? 'cuda') !== (options.inferenceDevice ?? 'cuda')
        )
          throw Error('本场面试设置已锁定，请结束面试后重新设置。');
        const status = await this.port.call({
          op: 'start',
          options: structuredClone(options),
          inputState: this.inputState,
        });
        this.currentInput = status.inputState ?? this.currentInput;
        this.running = status.state === 'running';
        return status;
      }
      if (configuration.mode === 'mock') return idle();
      return this.port.call(call);
    });
  }
  dictation(value: unknown, fallback?: Pick<SpeechOptions, 'speechModel' | 'inferenceDevice'>) {
    const call = value as DictationCall;
    if (!call || !['start', 'stop', 'status', 'test', 'test-stop'].includes(call.op))
      throw Error('无效的语音输入操作。');
    if (
      (call.op === 'test' || call.op === 'test-stop') &&
      (typeof call.id !== 'string' || !/^[\w-]{1,100}$/.test(call.id))
    )
      throw Error('无效的音频测试。');
    if (call.op === 'test-stop' && this.testId !== call.id) return Promise.resolve(idle());
    const starting = call.op === 'start' || call.op === 'test';
    const options = starting
      ? validateSpeech({
          op: 'start',
          options:
            call.op === 'test'
              ? call.options
              : {
                  sources: ['microphone'],
                  microphone: call.microphone,
                },
        })
      : undefined;
    // Prefer the lightweight Paraformer for dictation and preflight. The trusted
    // main process supplies a Qwen fallback only when it is the installed model.
    if (options?.op === 'start') {
      delete options.options.speechModel;
      delete options.options.inferenceDevice;
      Object.assign(options.options, fallback);
    }
    const intent = call.op === 'status' ? this.dictationIntent : ++this.dictationIntent;
    if (call.op !== 'status') {
      this.clearTest();
      if (call.op === 'test') this.testId = call.id;
      if (call.op === 'stop' || call.op === 'test-stop') this.cancelDictationStart();
    }
    return this.serialize(async () => {
      if (starting) {
        if (intent !== this.dictationIntent) return idle();
        if (this.confirmed) throw Error('请先结束当前面试，再使用准备聊天的语音输入。');
        if (this.target === 'dictation' || this.target === 'audio-test') {
          await this.port.call({ op: 'stop' });
          this.port.stop();
        }
        if (intent !== this.dictationIntent) return idle();
        this.target = call.op === 'test' ? 'audio-test' : 'dictation';
        const attempt = ++this.dictationAttempt;
        this.startingDictation = true;
        try {
          const status = await this.port.call({
            op: 'start',
            options: options?.op === 'start' ? options.options : { sources: ['microphone'] },
          });
          if (attempt !== this.dictationAttempt) return idle();
          if (call.op === 'test' && status.state !== 'running') {
            this.clearTest();
            this.port.stop();
            this.target = undefined;
          }
          if (call.op === 'test' && this.testId === call.id && status.state === 'running') {
            this.testTimer = setTimeout(() => {
              void this.dictation({ op: 'test-stop', id: call.id }).catch(() =>
                this.releaseDictation(),
              );
            }, 10000);
          }
          return status;
        } catch (error) {
          if (attempt !== this.dictationAttempt) return idle();
          this.port.stop();
          this.target = undefined;
          throw error;
        } finally {
          this.startingDictation = false;
        }
      }
      if (this.target !== 'dictation' && this.target !== 'audio-test') return idle();
      if (call.op === 'status') return this.port.call({ op: 'status' });
      try {
        return await this.port.call({ op: 'stop' });
      } finally {
        this.target = undefined;
      }
    });
  }
  releaseDictation() {
    if (this.target === 'interview') return;
    ++this.dictationIntent;
    this.clearTest();
    ++this.dictationAttempt;
    this.target = undefined;
    this.port.stop();
  }
  private cancelDictationStart() {
    if (!this.startingDictation || (this.target !== 'dictation' && this.target !== 'audio-test'))
      return;
    ++this.dictationAttempt;
    this.target = undefined;
    this.port.stop();
  }
  private clearTest() {
    clearTimeout(this.testTimer);
    this.testTimer = undefined;
    this.testId = undefined;
  }
  releaseInterview(close = false) {
    this.cancelInput();
    ++this.reconnectAttempt;
    this.running = false;
    if (close) {
      this.confirmed = undefined;
      this.currentInput = undefined;
    }
    this.target = this.confirmed ? 'interview' : undefined;
    this.port.stop();
  }
}
