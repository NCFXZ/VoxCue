import type {
  DictationCall,
  InterviewConfiguration,
  SpeechCall,
  SpeechStatus,
} from '../contracts/speech';
import { validateSpeech } from '../backend/speech/validation';
import { reasoningEfforts, type ChatModel } from '../contracts/chat';

export function validateInterviewConfiguration(value: unknown): InterviewConfiguration {
  if (!value || typeof value !== 'object') throw Error('无效的面试设置。');
  const v = value as InterviewConfiguration;
  if (
    Object.keys(v).some(
      (key) => !['mode', 'options', 'aiEnabled', 'autoAnswer', 'modelId', 'effort'].includes(key),
    ) ||
    !['local', 'mock'].includes(v.mode) ||
    typeof v.aiEnabled !== 'boolean' ||
    typeof v.autoAnswer !== 'boolean' ||
    typeof v.modelId !== 'string' ||
    v.modelId.length > 200 ||
    (v.effort !== undefined && v.effort !== 'auto' && !reasoningEfforts.includes(v.effort)) ||
    (v.aiEnabled && (v.mode !== 'local' || !v.modelId.trim()))
  )
    throw Error('无效的面试设置。');
  const audio =
    v.mode === 'local' ? validateSpeech({ op: 'start', options: v.options }) : undefined;
  if (audio?.op === 'start' && !audio.options.sources.includes('system'))
    throw Error('面试官问题来自系统音频，请启用系统音频。');
  return {
    mode: v.mode,
    options: audio?.op === 'start' ? structuredClone(audio.options) : { sources: [] },
    aiEnabled: v.aiEnabled,
    modelId: v.aiEnabled ? v.modelId : '',
    effort: v.aiEnabled ? (v.effort ?? 'auto') : 'auto',
    autoAnswer: v.autoAnswer,
  };
}

export function validateInterviewModel(configuration: InterviewConfiguration, models: ChatModel[]) {
  const model = models.find((m) => m.id === configuration.modelId);
  if (!model) throw Error('请先登录 ChatGPT 并选择账户可用的回答模型。');
  if (configuration.effort !== 'auto' && !model.reasoningEfforts?.includes(configuration.effort))
    throw Error('所选模型不支持该思考强度，请选择自动或刷新模型列表。');
}

interface SpeechPort {
  call(call: SpeechCall): Promise<SpeechStatus>;
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
  private tail: Promise<unknown> = Promise.resolve();
  private startingDictation = false;
  private dictationAttempt = 0;
  private dictationIntent = 0;
  target: 'dictation' | 'interview' | undefined;
  constructor(private port: SpeechPort) {}
  get configuration() {
    return this.confirmed ? structuredClone(this.confirmed) : undefined;
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => {});
    return next;
  }
  confirm(value: unknown) {
    const configuration = validateInterviewConfiguration(value);
    ++this.dictationIntent;
    this.cancelDictationStart();
    return this.serialize(async () => {
      if (this.confirmed) return;
      if (this.target === 'dictation') await this.port.call({ op: 'stop' });
      this.port.stop();
      this.confirmed = configuration;
      this.target = 'interview';
    });
  }
  interview(value: unknown) {
    const call = validateSpeech(value);
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
          (call.options.system ?? '') !== (options.system ?? '')
        )
          throw Error('本场面试设置已锁定，请结束面试后重新设置。');
        return this.port.call({ op: 'start', options: structuredClone(options) });
      }
      if (configuration.mode === 'mock') return idle();
      return this.port.call(call);
    });
  }
  dictation(value: unknown) {
    const call = value as DictationCall;
    if (!call || !['start', 'stop', 'status'].includes(call.op))
      throw Error('无效的语音输入操作。');
    const options =
      call.op === 'start'
        ? validateSpeech({
            op: 'start',
            options: { sources: ['microphone'], microphone: call.microphone },
          })
        : undefined;
    const intent = call.op === 'status' ? this.dictationIntent : ++this.dictationIntent;
    if (call.op === 'stop') this.cancelDictationStart();
    return this.serialize(async () => {
      if (call.op === 'start') {
        if (intent !== this.dictationIntent) return idle();
        if (this.confirmed) throw Error('请先结束当前面试，再使用准备聊天的语音输入。');
        this.target = 'dictation';
        const attempt = ++this.dictationAttempt;
        this.startingDictation = true;
        try {
          const status = await this.port.call({
            op: 'start',
            options: options?.op === 'start' ? options.options : { sources: ['microphone'] },
          });
          return attempt === this.dictationAttempt ? status : idle();
        } catch (error) {
          if (attempt !== this.dictationAttempt) return idle();
          this.port.stop();
          this.target = undefined;
          throw error;
        } finally {
          this.startingDictation = false;
        }
      }
      if (this.target !== 'dictation') return idle();
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
    ++this.dictationAttempt;
    this.target = undefined;
    this.port.stop();
  }
  private cancelDictationStart() {
    if (!this.startingDictation || this.target !== 'dictation') return;
    ++this.dictationAttempt;
    this.target = undefined;
    this.port.stop();
  }
  releaseInterview(close = false) {
    if (close) this.confirmed = undefined;
    this.target = this.confirmed ? 'interview' : undefined;
    this.port.stop();
  }
}
