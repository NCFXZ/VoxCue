import type {
  AudioSource,
  InterviewConfiguration,
  InterviewScreenshotMode,
  SpeechSegment,
} from '../../electron/contracts/speech';
import type { ChatActivity, ChatModel, ReasoningEffort } from '../../electron/contracts/chat';
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
  const effort =
    model?.id === saved.modelId && saved.effort === 'auto'
      ? 'auto'
      : saved.effort !== 'auto' && model?.reasoningEfforts?.includes(saved.effort)
        ? saved.effort
        : model?.reasoningEfforts?.includes('low')
          ? 'low'
          : 'auto';
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
export async function interviewAnswer(
  question: string,
  modelId: string,
  effort: ReasoningEffort | 'auto',
  onText: (text: string, final: boolean) => void,
  signal: AbortSignal,
  onSummary?: (text: string) => void,
  onActivity?: (activity: ChatActivity) => void,
  onProvider?: (provider: import('../../electron/contracts/chat').ModelProvider) => void,
  screenshot?: InterviewScreenshotMode,
) {
  const desktop = window.desktop;
  if (!desktop) throw Error('真实回答需要桌面应用。');
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  const unsubscribe = desktop.onChatEvent((e) => {
    if (signal.aborted || e.id !== id) return;
    if (e.type === 'delta') onText(e.text, false);
    else if (e.type === 'reasoning-summary') onSummary?.(e.text);
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
      ...(screenshot === 'only'
        ? { screenshot: 'only' as const }
        : { question, ...(screenshot === 'attach' ? { screenshot: 'attach' as const } : {}) }),
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
