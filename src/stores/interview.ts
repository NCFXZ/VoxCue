import { create } from 'zustand';
import type { Answer, Transcript } from '../services/contracts';
import { mockAI, createMockSpeech } from '../services/mock';
import { useHistory } from './history';
import type {
  AudioSource,
  SpeechOptions,
  SpeechStatus,
  SpeechEvent,
  InterviewConfiguration,
} from '../../electron/contracts/speech';
import { QuestionBuffer, interviewAnswer } from '../services/speech';
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
  activities: Partial<Record<AudioSource, { speaking: boolean; level: number }>>;
  metrics?: Extract<SpeechEvent, { type: 'metrics' }>;
  configure(
    value: Partial<Pick<InterviewState, 'mode' | 'options' | 'aiEnabled' | 'modelId' | 'effort'>>,
  ): void;
  submitTranscript(editedQuestion?: string): Promise<void>;
  status: Status;
  autoAnswer: boolean;
  transcripts: Transcript[];
  answers: Answer[];
  generating: boolean;
  error: string | null;
  sessionId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  archive(status: 'ended' | 'interrupted'): void;
  start(): void;
  pause(): void;
  end(): Promise<void>;
  reset(): void;
  setAutoAnswer(enabled: boolean): void;
  ask(question: string, sourceTranscriptIds?: string[]): Promise<void>;
}
let speechController: AbortController | undefined;
let answerController: AbortController | undefined;
let sequence = 0;
let unsubscribeSpeech: (() => void) | undefined;
let questionTimer: ReturnType<typeof setTimeout> | undefined;
const questions = new QuestionBuffer();
const submittedInterim = new Set<string>();
const id = () => String(++sequence);
const stop = () => {
  clearTimeout(questionTimer);
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
    });
    get().start();
  },
  pendingQuestion: '',
  draftQuestion: '',
  aiEnabled: false,
  modelId: '',
  effort: 'auto',
  activities: {},
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
  transcripts: [],
  answers: [],
  generating: false,
  error: null,
  sessionId: null,
  startedAt: null,
  endedAt: null,
  setAutoAnswer(enabled) {
    clearTimeout(questionTimer);
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
    if (get().status === 'running' || get().speech.state === 'loading') return;
    speechController?.abort();
    if (get().mode === 'local') {
      const desktop = window.desktop;
      if (!desktop) {
        set({ error: '真实语音需要 Windows 桌面应用。' });
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
        if (event.type === 'status') {
          set({
            speech: event.status,
            ...(event.status.state !== 'running' ? { activities: {} } : {}),
            ...(event.status.state === 'running'
              ? { status: 'running' as const }
              : event.status.state === 'paused'
                ? { status: 'paused' as const }
                : event.status.state === 'error'
                  ? { status: 'paused' as const, error: event.status.error ?? '语音服务失败' }
                  : {}),
          });
        }
        if (event.type === 'activity')
          set((s) => ({
            activities: {
              ...s.activities,
              [event.source]: { speaking: event.speaking, level: event.level },
            },
          }));
        if (event.type === 'metrics') set({ metrics: event });
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
          if (submittedInterim.has(segment.id)) return;
          clearTimeout(questionTimer);
          try {
            if (questions.add(segment)) {
              set({ pendingQuestion: questions.text('system') });
              if (get().autoAnswer && segment.reason === 'silence')
                questionTimer = setTimeout(() => {
                  if (get().status === 'running' && get().autoAnswer) void get().submitTranscript();
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
      set({ error: null, speech: { ...get().speech, state: 'loading' } });
      const sessionId = get().sessionId;
      void desktop
        .speech({ op: 'start', options: get().options })
        .then((speech) => {
          if (get().sessionId !== sessionId || get().status === 'ended') return;
          set({
            speech,
            status: speech.state === 'running' ? 'running' : get().status,
            error: speech.error ?? null,
          });
        })
        .catch((error) => {
          if (get().sessionId !== sessionId || get().status === 'ended') return;
          set({
            status: 'paused',
            error: (error as Error).message,
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
    stop();
    if (get().mode === 'local')
      void window.desktop
        ?.speech({ op: 'pause' })
        .catch((error) => set({ error: (error as Error).message }));
    set({ status: 'paused', generating: false });
  },
  async end() {
    stop();
    if (get().mode === 'local') {
      try {
        await window.desktop?.speech({ op: 'stop' });
      } catch (error) {
        set({ error: (error as Error).message });
      }
      unsubscribeSpeech?.();
      unsubscribeSpeech = undefined;
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
      sessionId: null,
      startedAt: null,
      endedAt: null,
      pendingQuestion: '',
      draftQuestion: '',
      activities: {},
      speech: { ...get().speech, state: 'idle' },
    });
  },
  async ask(question, sourceTranscriptIds) {
    if (!question.trim()) return;
    if (get().status === 'ended') {
      get().reset();
    }
    if (!get().sessionId)
      set({ sessionId: crypto.randomUUID(), startedAt: Date.now(), endedAt: null });
    answerController?.abort();
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
          createdAt: Date.now(),
          content: '',
          provider: state.aiEnabled ? 'chatgpt' : 'mock',
          activity: { phase: 'waiting' },
        },
      ],
      generating: true,
      error: null,
    }));
    try {
      if (get().aiEnabled) {
        if (!get().modelId) throw Error('请选择账户模型后启用真实回答。');
        await interviewAnswer(
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
        );
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
    } catch (error) {
      if ((error as Error).name !== 'AbortError')
        set({ error: (error as Error).message || '回答失败，请重试。' });
    } finally {
      if (answerController === controller) set({ generating: false });
    }
  },
}));
