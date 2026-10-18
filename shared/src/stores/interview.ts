import { create } from 'zustand';
import type { Answer, Transcript } from '../services/contracts';
import { mockAI, createMockSpeech } from '../services/mock';
import { useHistory } from './history';
import type {
  SpeechOptions,
  SpeechStatus,
  InterviewConfiguration,
  AudioSource,
  InterviewScreenshotMode,
} from '../../electron/contracts/speech';
import { QuestionBuffer, interviewAnswer, isAcknowledgementOnly } from '../services/speech';
import type { ReasoningEffort } from '../../electron/contracts/chat';
type Status = 'idle' | 'running' | 'paused' | 'ended';
interface InterviewState {
  mode: 'local' | 'mock';
  speech: SpeechStatus;
  options: SpeechOptions;
  configurationLocked: boolean;
  initialize(configuration: InterviewConfiguration): void;
  pendingQuestion: string;
  draftQuestion: string;
  aiEnabled: boolean;
  modelId: string;
  effort: ReasoningEffort | 'auto';
  configure(
    value: Partial<Pick<InterviewState, 'mode' | 'options' | 'aiEnabled' | 'modelId' | 'effort'>>,
  ): void;
  submitTranscript(editedQuestion?: string): Promise<void>;
  status: Status;
  autoAnswer: boolean;
  attachScreenshot: boolean;
  setAttachScreenshot(enabled: boolean): void;
  submitScreenshot(): Promise<void>;
  transcripts: Transcript[];
  answers: Answer[];
  generating: boolean;
  stopAnswer(): void;
  retryAnswer(id: string): Promise<void>;
  error: string | null;
  speechError: string | null;
  speechWarnings: Partial<Record<AudioSource, string>>;
  sessionId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  archive(status: 'ended' | 'interrupted'): void;
  start(): void;
  pause(): void;
  end(): Promise<void>;
  reset(): void;
  setAutoAnswer(enabled: boolean): void;
  ask(
    question: string,
    sourceTranscriptIds?: string[],
    screenshot?: InterviewScreenshotMode | false,
  ): Promise<void>;
}
let speechController: AbortController | undefined;
let answerController: AbortController | undefined;
let sequence = 0;
let startAttempt = 0;
let finishingSession: string | null = null;
let unsubscribeSpeech: (() => void) | undefined;
let questionTimer: ReturnType<typeof setTimeout> | undefined;
let automaticQuestionReady = false;
const questions = new QuestionBuffer();
const submittedInterim = new Set<string>();
function submitAutomaticTranscript() {
  if (isAcknowledgementOnly(questions.text('system'))) {
    // Retain the draft and original transcript for manual submission and later
    // context. Acknowledgements alone must not queue another model request.
    automaticQuestionReady = false;
    return;
  }
  void useInterview.getState().submitTranscript();
}
const id = () => String(++sequence);
const stop = () => {
  clearTimeout(questionTimer);
  automaticQuestionReady = false;
  speechController?.abort();
  answerController?.abort();
};
export const useInterview = create<InterviewState>((set, get) => ({
  mode: typeof window === 'undefined' ? 'mock' : 'local',
  speech: { state: 'idle', model: 'Paraformer 中英 INT8 · Silero VAD · 本地' },
  options: { sources: ['microphone', 'system'] },
  configurationLocked: false,
  initialize(configuration) {
    if (get().configurationLocked) return;
    set({
      ...structuredClone(configuration),
      configurationLocked: true,
      attachScreenshot: false,
    });
    get().start();
  },
  pendingQuestion: '',
  draftQuestion: '',
  aiEnabled: false,
  modelId: '',
  effort: 'auto',
  configure(value) {
    if (get().configurationLocked || get().status === 'running' || get().speech.state === 'loading')
      return;
    if (value.mode && value.mode !== get().mode) {
      get().reset();
      if (value.mode === 'mock') set({ aiEnabled: false, autoAnswer: false });
    }
    set(value);
    if (get().mode === 'mock' || !get().aiEnabled)
      set({
        aiEnabled: get().mode === 'mock' ? false : get().aiEnabled,
      });
    if (value.mode) {
      questions.clear();
      submittedInterim.clear();
      set({ pendingQuestion: '', draftQuestion: '' });
    }
  },
  async submitTranscript(editedQuestion) {
    try {
      clearTimeout(questionTimer);
      const question = editedQuestion?.trim() || get().draftQuestion || questions.text('system');
      if (!question.trim() || get().generating) return;
      automaticQuestionReady = false;
      const sourceTranscriptIds = [
        ...new Set([
          ...questions.ids('system'),
          ...get()
            .transcripts.filter(
              (row) => row.source === 'system' && !row.final && !submittedInterim.has(row.id),
            )
            .map((row) => row.id),
        ]),
      ];
      for (const row of get().transcripts)
        if (row.source === 'system' && !row.final) submittedInterim.add(row.id);
      questions.consume('system');
      set({ pendingQuestion: '', draftQuestion: '' });
      await get().ask(question, sourceTranscriptIds);
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },
  status: 'idle',
  autoAnswer: true,
  attachScreenshot: false,
  setAttachScreenshot(enabled) {
    set({ attachScreenshot: enabled });
  },
  async submitScreenshot() {
    if (get().generating) return;
    clearTimeout(questionTimer);
    automaticQuestionReady = false;
    await get().ask('当前屏幕截图', undefined, 'only');
  },
  transcripts: [],
  answers: [],
  generating: false,
  error: null,
  speechError: null,
  speechWarnings: {},
  sessionId: null,
  startedAt: null,
  endedAt: null,
  setAutoAnswer(enabled) {
    clearTimeout(questionTimer);
    automaticQuestionReady = false;
    set({ autoAnswer: enabled });
  },
  archive(status) {
    const state = get();
    if (
      !state.sessionId ||
      state.startedAt === null ||
      (!state.transcripts.length && !state.answers.length)
    )
      return;
    useHistory.getState().save({
      id: state.sessionId,
      title: '面试记录',
      startedAt: state.startedAt,
      endedAt: state.endedAt ?? Date.now(),
      status,
      transcripts: structuredClone(state.transcripts),
      answers: structuredClone(state.answers),
      mock: state.mode === 'mock',
    });
  },
  start() {
    if (finishingSession) return;
    if (get().status === 'running' || get().speech.state === 'loading') return;
    const attempt = ++startAttempt;
    speechController?.abort();
    if (get().mode === 'local') {
      const desktop = window.desktop;
      if (!desktop) {
        set({ error: '真实语音需要桌面应用。' });
        return;
      }
      if (get().status !== 'paused') {
        get().archive(get().status === 'ended' ? 'ended' : 'interrupted');
        stop();
        questions.clear();
        set({
          transcripts: [],
          answers: [],
          pendingQuestion: '',
          draftQuestion: '',
          sessionId: crypto.randomUUID(),
          startedAt: Date.now(),
          endedAt: null,
        });
      }
      unsubscribeSpeech?.();
      unsubscribeSpeech = desktop.onSpeechEvent((event) => {
        if (event.type === 'gap') {
          set((s) => ({ speechWarnings: { ...s.speechWarnings, [event.source]: event.message } }));
          if (event.source === 'system') {
            clearTimeout(questionTimer);
            automaticQuestionReady = false;
            questions.clear();
            set({ pendingQuestion: '', draftQuestion: '' });
          }
        }
        if (event.type === 'status') {
          set({
            speech: event.status,
            ...(event.status.state === 'running'
              ? { status: 'running' as const, speechError: null }
              : event.status.state === 'paused'
                ? { status: 'paused' as const }
                : event.status.state === 'error'
                  ? { status: 'paused' as const, speechError: event.status.error ?? '语音服务失败' }
                  : {}),
          });
        }
        // Only healthy events from the affected source clear its gap notice.
        // A discontinuity final belongs to the broken audio, not recovery.
        if (
          event.type === 'activity' ||
          (event.type === 'segment' && event.segment.reason !== 'discontinuity')
        ) {
          const source = event.type === 'activity' ? event.source : event.segment.source;
          if (get().speechWarnings[source])
            set((s) => {
              const speechWarnings = { ...s.speechWarnings };
              delete speechWarnings[source];
              return { speechWarnings };
            });
        }
        if (event.type === 'segment') {
          const segment = event.segment;
          const existing = get().transcripts.find((t) => t.id === segment.id);
          if (existing?.final) return;
          const row = {
            ...segment,
            time: new Date(segment.startMs).toLocaleTimeString('zh-CN', { hour12: false }),
          };
          set((s) => ({
            transcripts: existing
              ? s.transcripts.map((t) => (t.id === row.id ? row : t))
              : [...s.transcripts, row],
          }));
          // Microphone text is always the interviewee, never an AI question.
          if (segment.source !== 'system') return;
          if (finishingSession === get().sessionId) return;
          if (segment.reason === 'discontinuity') {
            clearTimeout(questionTimer);
            automaticQuestionReady = false;
            questions.clear();
            set({ pendingQuestion: '', draftQuestion: '' });
            return;
          }
          if (submittedInterim.has(segment.id)) return;
          clearTimeout(questionTimer);
          automaticQuestionReady = false;
          try {
            if (questions.add(segment)) {
              set({ pendingQuestion: questions.text('system') });
              if (get().autoAnswer && segment.reason === 'silence')
                questionTimer = setTimeout(() => {
                  automaticQuestionReady = true;
                  if (get().status === 'running' && get().autoAnswer && !get().generating)
                    submitAutomaticTranscript();
                }, 2200);
            }
            const interim = get()
              .transcripts.filter(
                (t) => t.source === 'system' && !t.final && !submittedInterim.has(t.id),
              )
              .map((t) => t.text)
              .join(' ');
            set({ draftQuestion: [questions.text('system'), interim].filter(Boolean).join(' ') });
          } catch (error) {
            set({ error: (error as Error).message });
          }
        }
      });
      set({
        error: null,
        speechError: null,
        speechWarnings: {},
        speech: { ...get().speech, state: 'loading' },
      });
      const sessionId = get().sessionId;
      void desktop
        .speech({ op: 'start', options: get().options })
        .then((speech) => {
          if (attempt !== startAttempt || get().sessionId !== sessionId || get().status === 'ended')
            return;
          set({
            speech,
            status: speech.state === 'running' ? 'running' : get().status,
            speechError: speech.error ?? null,
          });
        })
        .catch((error) => {
          if (attempt !== startAttempt || get().sessionId !== sessionId || get().status === 'ended')
            return;
          set({
            status: 'paused',
            speechError: (error as Error).message,
            speech: { ...get().speech, state: 'error' },
          });
        });
      return;
    }
    const controller = new AbortController();
    speechController = controller;
    const completed = get().status === 'paused' ? get().transcripts.filter((t) => t.final) : [];
    const startIndex = completed.length % 3;
    if (get().status !== 'paused') {
      get().archive(get().status === 'ended' ? 'ended' : 'interrupted');
      answerController?.abort();
      set({
        transcripts: [],
        answers: [],
        generating: false,
        sessionId: crypto.randomUUID(),
        startedAt: Date.now(),
        endedAt: null,
      });
    } else set({ transcripts: completed });
    set({ status: 'running', error: null });
    let currentId = id();
    void createMockSpeech(startIndex)
      .start((text, final) => {
        if (controller.signal.aborted) return;
        const row = {
          id: currentId,
          text,
          final,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        };
        set((state) => ({
          transcripts: [...state.transcripts.filter((t) => t.id !== currentId), row],
        }));
        set({ draftQuestion: text });
        if (final) {
          if (get().autoAnswer) void get().ask(text);
          currentId = id();
        }
      }, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          set({ status: 'ended', endedAt: Date.now() });
          get().archive('ended');
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError')
          set({ error: '模拟转写失败，请重新开始。', status: 'paused' });
      });
  },
  pause() {
    ++startAttempt;
    stop();
    get().stopAnswer();
    if (get().mode === 'local')
      void window.desktop
        ?.speech({ op: 'pause' })
        .catch((error) => set({ error: (error as Error).message }));
    set({ status: 'paused', generating: false });
  },
  async end() {
    ++startAttempt;
    const sessionId = get().sessionId;
    stop();
    get().stopAnswer();
    if (get().mode === 'local') {
      finishingSession = sessionId;
      set({ status: 'paused', generating: false });
      try {
        await window.desktop?.speech({ op: 'stop' });
      } catch (error) {
        set({ error: (error as Error).message });
      }
      unsubscribeSpeech?.();
      unsubscribeSpeech = undefined;
      if (finishingSession === sessionId) finishingSession = null;
      if (get().sessionId !== sessionId) return;
    }
    set({ status: 'ended', generating: false, endedAt: get().endedAt ?? Date.now() });
    get().archive('ended');
    const current = get();
    if (
      current.mode === 'local' &&
      current.aiEnabled &&
      current.sessionId &&
      !useHistory.getState().error
    )
      await useHistory.getState().generateTitle(current.sessionId, current.modelId);
  },
  reset() {
    finishingSession = null;
    ++startAttempt;
    stop();
    unsubscribeSpeech?.();
    unsubscribeSpeech = undefined;
    questions.clear();
    submittedInterim.clear();
    if (get().mode === 'local' && typeof window !== 'undefined')
      void window.desktop?.speech({ op: 'stop' }).catch(() => {});
    get().archive(get().status === 'ended' ? 'ended' : 'interrupted');
    set({
      status: 'idle',
      transcripts: [],
      answers: [],
      generating: false,
      error: null,
      speechError: null,
      speechWarnings: {},
      sessionId: null,
      startedAt: null,
      endedAt: null,
      pendingQuestion: '',
      draftQuestion: '',
      attachScreenshot: false,
      speech: { ...get().speech, state: 'idle' },
    });
  },
  async ask(question, sourceTranscriptIds, screenshot) {
    if (!question.trim()) return;
    if (get().status === 'ended') {
      get().reset();
    }
    if (!get().sessionId)
      set({ sessionId: crypto.randomUUID(), startedAt: Date.now(), endedAt: null });
    const screenshotMode = screenshot ?? (get().attachScreenshot ? 'attach' : undefined);
    answerController?.abort();
    set((state) => ({
      answers: state.answers.map((answer) =>
        answer.status === 'streaming' ? { ...answer, status: 'stopped' as const } : answer,
      ),
    }));
    const controller = new AbortController();
    answerController = controller;
    const answerId = id();
    set((state) => ({
      answers: [
        ...state.answers,
        {
          id: answerId,
          question: question.trim(),
          sourceTranscriptIds,
          ...(screenshotMode ? { screenshot: screenshotMode } : {}),
          createdAt: Date.now(),
          content: '',
          provider: state.aiEnabled ? 'unknown' : 'mock',
          activity: { phase: 'thinking' },
          status: 'streaming',
        },
      ],
      generating: true,
      error: null,
    }));
    try {
      if (screenshotMode && !get().aiEnabled) throw Error('截图回答需要先连接模型服务。');
      if (get().aiEnabled) {
        if (!get().modelId) throw Error('请选择账户模型后启用真实回答。');
        const provider = await interviewAnswer(
          question,
          get().modelId,
          get().effort,
          (text, final) => {
            if (!controller.signal.aborted)
              set((state) => ({
                answers: state.answers.map((a) =>
                  a.id === answerId ? { ...a, content: final ? text : a.content + text } : a,
                ),
              }));
          },
          controller.signal,
          (reasoningSummary) => {
            if (!controller.signal.aborted)
              set((state) => ({
                answers: state.answers.map((answer) =>
                  answer.id === answerId ? { ...answer, reasoningSummary } : answer,
                ),
              }));
          },
          (activity) => {
            if (!controller.signal.aborted)
              set((state) => ({
                answers: state.answers.map((answer) =>
                  answer.id === answerId ? { ...answer, activity } : answer,
                ),
              }));
          },
          (provider) => {
            if (!controller.signal.aborted)
              set((state) => ({
                answers: state.answers.map((answer) =>
                  answer.id === answerId ? { ...answer, provider } : answer,
                ),
              }));
          },
          screenshotMode || undefined,
        );
        controller.signal.throwIfAborted();
        set((state) => ({
          answers: state.answers.map((a) =>
            a.id === answerId
              ? { ...a, provider: provider ?? a.provider, status: 'completed' as const }
              : a,
          ),
        }));
        return;
      }
      await mockAI.streamAnswer(
        question,
        (chunk) => {
          if (!controller.signal.aborted)
            set((state) => ({
              answers: state.answers.map((a) =>
                a.id === answerId ? { ...a, content: a.content + chunk } : a,
              ),
            }));
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      set((state) => ({
        answers: state.answers.map((a) =>
          a.id === answerId ? { ...a, status: 'completed' as const } : a,
        ),
      }));
    } catch (error) {
      const stopped = controller.signal.aborted;
      const message = stopped ? undefined : (error as Error).message || '回答失败，请重试。';
      set((state) => ({
        ...(answerController === controller && message ? { error: message } : {}),
        answers: state.answers.map((a) =>
          a.id === answerId
            ? { ...a, status: stopped ? ('stopped' as const) : ('failed' as const), error: message }
            : a,
        ),
      }));
    } finally {
      if (answerController === controller) {
        answerController = undefined;
        set({ generating: false });
        // A final question may have reached its silence deadline while the
        // preceding answer was busy. Keep it queued across microphone gaps.
        if (
          !controller.signal.aborted &&
          automaticQuestionReady &&
          get().autoAnswer &&
          get().status === 'running' &&
          questions.text('system').trim()
        ) {
          const sessionId = get().sessionId;
          queueMicrotask(() => {
            if (
              get().sessionId === sessionId &&
              get().status === 'running' &&
              get().autoAnswer &&
              automaticQuestionReady &&
              !get().generating
            )
              submitAutomaticTranscript();
          });
        }
      }
    }
  },
  stopAnswer() {
    automaticQuestionReady = false;
    answerController?.abort();
    set((state) => ({
      generating: false,
      answers: state.answers.map((a) =>
        a.status === 'streaming' ? { ...a, status: 'stopped' as const } : a,
      ),
    }));
  },
  async retryAnswer(id) {
    const answer = get().answers.find((a) => a.id === id);
    if (!answer || get().generating || !['failed', 'stopped'].includes(answer.status ?? '')) return;
    await get().ask(answer.question, answer.sourceTranscriptIds, answer.screenshot ?? false);
  },
}));
