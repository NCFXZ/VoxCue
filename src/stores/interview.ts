import { create } from 'zustand';
import type { Answer, Transcript } from '../services/contracts';
import { mockAI, createMockSpeech } from '../services/mock';
import { useHistory } from './history';
type Status = 'idle' | 'running' | 'paused' | 'ended';
interface InterviewState {
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
  end(): void;
  reset(): void;
  setAutoAnswer(enabled: boolean): void;
  ask(question: string): Promise<void>;
}
let speechController: AbortController | undefined;
let answerController: AbortController | undefined;
let sequence = 0;
const id = () => String(++sequence);
const stop = () => {
  speechController?.abort();
  answerController?.abort();
};
export const useInterview = create<InterviewState>((set, get) => ({
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
      title: (state.answers[0]?.question || state.transcripts[0]?.text || '模拟面试练习').slice(
        0,
        48,
      ),
      startedAt: state.startedAt,
      endedAt: state.endedAt ?? Date.now(),
      status,
      transcripts: structuredClone(state.transcripts),
      answers: structuredClone(state.answers),
      mock: true,
    });
  },
  start() {
    if (get().status === 'running') return;
    speechController?.abort();
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
    set({ status: 'paused', generating: false });
  },
  end() {
    stop();
    set({ status: 'ended', generating: false, endedAt: get().endedAt ?? Date.now() });
    get().archive('ended');
  },
  reset() {
    stop();
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
    });
  },
  async ask(question) {
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
      answers: [...state.answers, { id: answerId, question: question.trim(), content: '' }],
      generating: true,
      error: null,
    }));
    try {
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
      if ((error as Error).name !== 'AbortError') set({ error: '模拟回答失败，请重试。' });
    } finally {
      if (answerController === controller) set({ generating: false });
    }
  },
}));
