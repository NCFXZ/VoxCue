import type {
  AudioSource,
  InterviewConfiguration,
  SpeechSegment,
  SpeechEvent,
} from '../../electron/contracts/speech';
import { automaticAnswerSilenceMs } from '../../electron/contracts/speechSettings';
import type { ChatActivity, ChatModel, ReasoningEffort } from '../../electron/contracts/chat';
import { resolveReasoningEffort } from './chatOptions';

export const defaultInterviewConfiguration = (): InterviewConfiguration => ({
  mode: 'local',
  options: { sources: ['microphone', 'system'] },
  aiEnabled: false,
  modelId: '',
  effort: 'auto',
  autoAnswer: true,
});
export function resolveInterviewConfiguration(
  saved: InterviewConfiguration,
  models: ChatModel[],
  live: boolean,
): InterviewConfiguration {
  const model = models.find((m) => m.id === saved.modelId) ?? models[0];
  const effort = resolveReasoningEffort(model, saved.effort);
  return {
    ...structuredClone(saved),
    mode: live ? 'local' : 'mock',
    aiEnabled: live,
    modelId: live ? (model?.id ?? '') : '',
    effort: live ? effort : 'auto',
    autoAnswer: true,
  };
}
// Aggregate final segments for automatic submission. Interim text is available
// separately as a draft and enters AI only on explicit manual submission.
export class QuestionBuffer {
  private seen = new Set<string>();
  private pending: SpeechSegment[] = [];
  add(segment: SpeechSegment) {
    if (!segment.final || this.seen.has(segment.id)) return false;
    if (this.seen.size >= 5000) throw Error('本次转写已达5000段，请保存后重新开始。');
    this.seen.add(segment.id);
    this.pending.push(segment);
    return true;
  }
  text(source: AudioSource) {
    const text = this.pending
      .filter((s) => s.source === source)
      .map((s) => s.text)
      .join(' ');
    if (text.length > 6000) throw Error('待提交问题超过6000字，请在输入框整理后手动发送。');
    return text;
  }
  consume(source: AudioSource) {
    const text = this.text(source);
    this.pending = this.pending.filter((s) => s.source !== source);
    return text;
  }
  ids(source: AudioSource) {
    return this.pending.filter((segment) => segment.source === source).map((segment) => segment.id);
  }
  clear() {
    this.seen.clear();
    this.pending = [];
  }
}

// Recognition and IPC delays consume the silence budget. Wall-clock waiting
// alone cannot prove silence: newer captured audio must also be processed.
export class AutomaticQuestionGate {
  private deadline?: number;
  private through?: number;
  private pending = true;
  final(segment: SpeechSegment) {
    this.cancel();
    if (
      segment.source === 'system' &&
      segment.final &&
      segment.reason === 'silence' &&
      typeof segment.silenceStartMs === 'number' &&
      Number.isFinite(segment.silenceStartMs) &&
      Number.isFinite(segment.endMs) &&
      segment.silenceStartMs <= segment.endMs
    )
      this.deadline = segment.silenceStartMs + automaticAnswerSilenceMs;
  }
  progress(event: Extract<SpeechEvent, { type: 'audio-progress' }>) {
    if (event.source !== 'system') return;
    this.pending = event.pending;
    if (typeof event.processedThroughMs === 'number' && Number.isFinite(event.processedThroughMs))
      this.through = event.processedThroughMs;
  }
  ready() {
    return (
      !this.pending &&
      this.deadline !== undefined &&
      this.through !== undefined &&
      this.through >= this.deadline
    );
  }
  cancel() {
    this.deadline = undefined;
  }
  reset() {
    this.cancel();
    this.through = undefined;
    this.pending = true;
  }
}
export async function interviewAnswer(
  question: string,
  modelId: string,
  effort: ReasoningEffort | 'auto',
  onText: (text: string, final: boolean) => void,
  signal: AbortSignal,
  onSummary?: (text: string) => void,
  onActivity?: (activity: ChatActivity) => void,
  onProvider?: (provider: import('../../electron/contracts/chat').ModelProvider) => void,
  screenshotIds?: string[],
  onRetry?: (attempt: number, limit: number) => void,
) {
  const desktop = window.desktop;
  if (!desktop) throw Error('真实回答需要桌面应用。');
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  let replaceNextText = false;
  const unsubscribe = desktop.onChatEvent((e) => {
    if (signal.aborted || e.id !== id) return;
    if (e.type === 'delta') {
      onText(e.text, replaceNextText);
      replaceNextText = false;
    } else if (e.type === 'interview-retry') {
      replaceNextText = true;
      onRetry?.(e.attempt, e.limit);
    } else if (e.type === 'reasoning-summary') onSummary?.(e.text);
    else if (e.type === 'activity') onActivity?.(e.activity);
    else if (e.type === 'provider') onProvider?.(e.provider);
  });
  const cancel = () => {
    void desktop.interviewCancel(id).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await desktop.interviewAnswer({
      id,
      ...(question.trim() ? { question } : {}),
      ...(screenshotIds?.length ? { screenshotIds } : {}),
      modelId,
      ...(effort === 'auto' ? {} : { effort }),
    });
    signal.throwIfAborted();
    if (!result.ok) throw Error(result.error.message);
    if (result.reasoningSummary !== undefined) onSummary?.(result.reasoningSummary);
    if (result.answerText !== undefined) onText(result.answerText, true);
    return result.provider;
  } finally {
    unsubscribe();
    signal.removeEventListener('abort', cancel);
  }
}
