import { create } from 'zustand';
import type { Answer, Transcript } from '../services/contracts';
import { mockAI, createMockSpeech } from '../services/mock';
import { useHistory } from './history';
import type {
  SpeechOptions,
  SpeechStatus,
  InterviewConfiguration,
  AudioSource,
  InterviewScreenshot,
} from '../../electron/contracts/speech';
import {
  AutomaticQuestionGate,
  QuestionBuffer,
  interviewAnswer,
  isAutomaticQuestionFiller,
} from '../services/speech';
import type { ReasoningEffort } from '../../electron/contracts/chat';
import { recordAudioLevel, type AudioLevels } from '../services/audioLevel';
import { sameAudioCapture, speechSelection } from '../../electron/contracts/speechSettings';
import { validInterviewImages } from '../../electron/contracts/interviewImages';
import { signalTelemetry } from '../services/telemetry';
type Status = 'idle' | 'running' | 'paused' | 'ended';
interface InterviewState {
  mode: 'local' | 'mock';
  speech: SpeechStatus;
  options: SpeechOptions;
  configurationLocked: boolean;
  knowledgeBaseName?: string;
  initialize(configuration: InterviewConfiguration): void;
  pendingQuestion: string;
  draftQuestion: string;
  aiEnabled: boolean;
  modelId: string;
  effort: ReasoningEffort | 'auto';
  configure(
    value: Partial<Pick<InterviewState, 'mode' | 'options' | 'aiEnabled' | 'modelId' | 'effort'>>,
  ): void;
  submitTranscript(
    editedQuestion?: string,
    includeScreenshots?: boolean,
    automatic?: boolean,
  ): Promise<void>;
  status: Status;
  autoAnswer: boolean;
  updatingModel: boolean;
  updateModel(modelId: string, effort: ReasoningEffort | 'auto'): Promise<boolean>;
  audioLevels: AudioLevels;
  reconnecting: boolean;
  switchingSpeech: boolean;
  speechSwitchError: string | null;
  reconnectAudio(options?: SpeechOptions): Promise<boolean>;
  screenshots: InterviewScreenshot[];
  capturingScreenshot: boolean;
  captureScreenshot(): Promise<void>;
  removeScreenshot(id: string): Promise<void>;
  clearScreenshots(): void;
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
  archive(status: 'ended' | 'interrupted', preserveEmpty?: boolean): void;
  start(): void;
  pause(): void;
  end(options?: { preserveEmpty?: boolean; generateTitle?: boolean }): Promise<void>;
  reset(): void;
  setAutoAnswer(enabled: boolean): void;
  ask(question: string, sourceTranscriptIds?: string[], screenshotIds?: string[]): Promise<void>;
}
let speechController: AbortController | undefined;
let answerController: AbortController | undefined;
let sequence = 0;
let startAttempt = 0;
let finishingSession: string | null = null;
let endingOperation:
  | {
      sessionId: string | null;
      promise: Promise<void>;
      options: { preserveEmpty?: boolean; generateTitle?: boolean };
    }
  | undefined;
let unsubscribeSpeech: (() => void) | undefined;
const automaticQuestion = new AutomaticQuestionGate();
let automaticQuestionReady = false;
const questions = new QuestionBuffer();
const answerScreenshots = new Map<string, string[]>();
let screenshotEpoch = 0;
const submittedInterim = new Set<string>();
const id = () => String(++sequence);
const stop = () => {
  automaticQuestion.reset();
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
      knowledgeBaseName: configuration.knowledgeBaseName,
      configurationLocked: true,
      screenshots: [],
      capturingScreenshot: false,
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
  async submitTranscript(editedQuestion, includeScreenshots = false, automatic = false) {
    try {
      const screenshotIds = includeScreenshots ? get().screenshots.map((shot) => shot.id) : [];
      const question = automatic
        ? questions.text('system')
        : editedQuestion?.trim() ||
          (screenshotIds.length ? '' : get().draftQuestion || questions.text('system'));
      if (
        (!question.trim() && !screenshotIds.length) ||
        get().generating ||
        get().updatingModel ||
        (includeScreenshots && get().capturingScreenshot)
      )
        return;
      if (automatic && !screenshotIds.length && isAutomaticQuestionFiller(question)) {
        automaticQuestion.cancel();
        automaticQuestionReady = false;
        return;
      }
      if (!automatic && get().mode === 'local') signalTelemetry({ type: 'manual_question' });
      if (!question.trim()) {
        await get().ask('', undefined, screenshotIds);
        return;
      }
      automaticQuestion.cancel();
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
      await get().ask(question, sourceTranscriptIds, screenshotIds);
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },
  status: 'idle',
  autoAnswer: true,
  audioLevels: {},
  reconnecting: false,
  switchingSpeech: false,
  speechSwitchError: null,
  updatingModel: false,
  async updateModel(modelId, effort) {
    if (get().updatingModel || get().status === 'ended') return false;
    const session = get().sessionId;
    set({ updatingModel: true });
    try {
      const result = await window.desktop!.updateInterviewModel({ modelId, effort });
      if (get().sessionId !== session || get().status === 'ended') return false;
      if (!result.ok) throw Error(result.error.message);
      set({ modelId: result.modelId, effort: result.effort ?? 'auto' });
      return true;
    } finally {
      if (get().sessionId === session) {
        set({ updatingModel: false });
        if (
          automaticQuestionReady &&
          get().autoAnswer &&
          get().status === 'running' &&
          !get().generating
        )
          void get().submitTranscript(undefined, false, true);
      }
    }
  },
  async reconnectAudio(options) {
    if (
      get().reconnecting ||
      get().switchingSpeech ||
      get().speech.state === 'loading' ||
      get().status === 'ended'
    )
      return false;
    const attempt = startAttempt,
      session = get().sessionId;
    const continuous =
      !!options &&
      get().status === 'running' &&
      get().speech.state === 'running' &&
      sameAudioCapture(get().options, options) &&
      JSON.stringify(speechSelection(get().options)) !== JSON.stringify(speechSelection(options));
    if (continuous) {
      set({ switchingSpeech: true, speechSwitchError: null });
      try {
        const result = await window.desktop!.reconnectInterviewAudio(options);
        if (attempt !== startAttempt || get().sessionId !== session || get().status === 'ended')
          return false;
        if (result.state !== 'running') throw Error(result.error ?? '语音切换失败，仍使用原配置。');
        set({ speech: result, options });
        return true;
      } catch (error) {
        if (attempt === startAttempt && get().sessionId === session)
          set({ speechSwitchError: (error as Error).message });
        return false;
      } finally {
        if (attempt === startAttempt && get().sessionId === session)
          set({ switchingSpeech: false });
      }
    }
    automaticQuestion.reset();
    automaticQuestionReady = false;
    set({
      reconnecting: true,
      speechSwitchError: null,
      status: 'paused',
      speechError: null,
      audioLevels: {},
      speech: { model: get().speech.model, state: 'loading' },
    });
    try {
      const result = await window.desktop!.reconnectInterviewAudio(options);
      if (attempt !== startAttempt || get().sessionId !== session || get().status === 'ended')
        return false;
      if (result.state !== 'running')
        throw Error(result.error ?? '音频连接失败，请检查设备后重试。');
      questions.clear();
      set({
        speech: result,
        status: 'running',
        options: options ?? get().options,
        speechWarnings: {},
        pendingQuestion: '',
        draftQuestion: '',
      });
      return true;
    } catch (error) {
      if (attempt === startAttempt)
        set({
          speechError: (error as Error).message,
          speech: { ...get().speech, state: 'error' },
          status: 'paused',
        });
      return false;
    } finally {
      if (attempt === startAttempt) set({ reconnecting: false });
    }
  },
  screenshots: [],
  capturingScreenshot: false,
  async captureScreenshot() {
    if (get().capturingScreenshot || get().generating || get().screenshots.length >= 5) return;
    const epoch = screenshotEpoch;
    set({ capturingScreenshot: true, error: null });
    try {
      if (!get().aiEnabled || !window.desktop) throw Error('截图回答需要先连接模型服务。');
      const result = await window.desktop.interviewScreenshot({ op: 'capture' });
      if (epoch !== screenshotEpoch) return;
      if (!result.ok) throw Error(result.error.message);
      if (!result.screenshot) throw Error('未能获取截图，请重试。');
      set((state) => ({ screenshots: [...state.screenshots, result.screenshot!] }));
    } catch (error) {
      if (epoch === screenshotEpoch) set({ error: (error as Error).message });
    } finally {
      if (epoch === screenshotEpoch) set({ capturingScreenshot: false });
    }
  },
  async removeScreenshot(id) {
    if (get().generating) return;
    const epoch = screenshotEpoch;
    try {
      const result = await window.desktop?.interviewScreenshot({ op: 'remove', id });
      if (epoch !== screenshotEpoch) return;
      if (!result?.ok)
        throw Error(result && !result.ok ? result.error.message : '移除截图失败，请重试。');
      set((state) => ({ screenshots: state.screenshots.filter((shot) => shot.id !== id) }));
    } catch (error) {
      if (epoch === screenshotEpoch) set({ error: (error as Error).message });
    }
  },
  clearScreenshots() {
    ++screenshotEpoch;
    answerScreenshots.clear();
    set({ screenshots: [], capturingScreenshot: false });
    if (typeof window !== 'undefined')
      void window.desktop?.interviewScreenshot?.({ op: 'clear' }).catch(() => {});
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
    automaticQuestion.cancel();
    automaticQuestionReady = false;
    set({ autoAnswer: enabled });
  },
  archive(status, preserveEmpty = false) {
    const state = get();
    if (
      !state.sessionId ||
      state.startedAt === null ||
      (!preserveEmpty && !state.transcripts.length && !state.answers.length)
    )
      return;
    useHistory.getState().save({
      id: state.sessionId,
      title: state.knowledgeBaseName ? `「${state.knowledgeBaseName}」面试记录` : '面试记录',
      ...(state.knowledgeBaseName ? { knowledgeBaseName: state.knowledgeBaseName } : {}),
      startedAt: state.startedAt,
      endedAt: state.endedAt ?? Date.now(),
      status,
      transcripts: structuredClone(state.transcripts),
      answers: structuredClone(
        state.answers.map((answer) =>
          answer.images?.length
            ? {
                ...answer,
                images: answer.images.map(({ id }) => ({ id })),
              }
            : answer,
        ),
      ),
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
          audioLevels: {},
          reconnecting: false,
          switchingSpeech: false,
          speechSwitchError: null,
          sessionId: crypto.randomUUID(),
          startedAt: Date.now(),
          endedAt: null,
        });
      }
      unsubscribeSpeech?.();
      const listeningSession = get().sessionId;
      unsubscribeSpeech = desktop.onSpeechEvent((event) => {
        if (get().sessionId !== listeningSession) return;
        if (
          event.type === 'activity' &&
          (get().speech.state !== 'running' ||
            get().status !== 'running' ||
            !get().options.sources.includes(event.source))
        )
          return;
        if (event.type === 'audio-progress') {
          if (
            event.source !== 'system' ||
            get().reconnecting ||
            finishingSession === get().sessionId
          )
            return;
          automaticQuestion.progress(event);
          automaticQuestionReady = automaticQuestion.ready();
          if (
            automaticQuestionReady &&
            get().status === 'running' &&
            get().speech.state === 'running' &&
            get().autoAnswer &&
            !get().generating &&
            !get().updatingModel
          )
            void get().submitTranscript(undefined, false, true);
          return;
        }
        if (event.type === 'activity')
          set((s) => ({
            audioLevels: {
              ...s.audioLevels,
              [event.source]: recordAudioLevel(
                s.audioLevels[event.source],
                event.level,
                event.speaking,
                Date.now(),
              ),
            },
          }));
        if (event.type === 'gap') {
          set((s) => ({
            speechWarnings: { ...s.speechWarnings, [event.source]: event.message },
            audioLevels: { ...s.audioLevels, [event.source]: undefined },
          }));
          if (event.source === 'system') {
            automaticQuestion.cancel();
            automaticQuestionReady = false;
            questions.clear();
            set({ pendingQuestion: '', draftQuestion: '' });
          }
        }
        if (event.type === 'speech-start' && event.source === 'system') {
          automaticQuestion.cancel();
          automaticQuestionReady = false;
        }
        if (event.type === 'status') {
          if (event.status.state !== 'running') {
            automaticQuestion.reset();
            automaticQuestionReady = false;
          }
          set({
            speech: event.status,
            ...(event.status.state !== 'running' ? { audioLevels: {} } : {}),
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
          if (segment.continuationOf && submittedInterim.has(segment.continuationOf))
            submittedInterim.add(segment.id);
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
          if (get().reconnecting) return;
          if (finishingSession === get().sessionId) return;
          if (segment.reason === 'discontinuity') {
            automaticQuestion.cancel();
            automaticQuestionReady = false;
            questions.clear();
            set({ pendingQuestion: '', draftQuestion: '' });
            return;
          }
          if (submittedInterim.has(segment.id)) return;
          automaticQuestion.cancel();
          automaticQuestionReady = false;

          try {
            if (questions.add(segment)) {
              set({ pendingQuestion: questions.text('system') });
              if (
                get().autoAnswer &&
                get().status === 'running' &&
                get().speech.state === 'running' &&
                segment.reason === 'silence'
              ) {
                automaticQuestion.final(segment);
                automaticQuestionReady = automaticQuestion.ready();
                if (
                  automaticQuestionReady &&
                  get().status === 'running' &&
                  !get().generating &&
                  !get().updatingModel
                )
                  void get().submitTranscript(undefined, false, true);
              }
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
        speech: { model: get().speech.model, state: 'loading' },
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
    set({
      status: 'paused',
      generating: false,

      audioLevels: {},
      reconnecting: false,
      switchingSpeech: false,
      speechSwitchError: null,
    });
  },
  end(options) {
    const sessionId = get().sessionId;
    if (endingOperation?.sessionId === sessionId) {
      if (options?.preserveEmpty) endingOperation.options.preserveEmpty = true;
      if (options?.generateTitle === false) endingOperation.options.generateTitle = false;
      return endingOperation.promise;
    }
    const policy = { ...options };
    const promise = (async () => {
      get().clearScreenshots();
      ++startAttempt;
      stop();
      get().stopAnswer();
      if (get().mode === 'local') {
        finishingSession = sessionId;
        set({
          status: 'paused',
          generating: false,
          audioLevels: {},
          reconnecting: false,
          switchingSpeech: false,
          speechSwitchError: null,
        });
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
      get().archive('ended', policy.preserveEmpty);
      if (get().mode === 'local')
        await window.desktop
          ?.telemetrySignal?.({ type: 'interview_saved', saved: !useHistory.getState().error })
          .catch(() => {});
      const current = get();
      if (
        policy.generateTitle !== false &&
        current.mode === 'local' &&
        current.aiEnabled &&
        current.sessionId &&
        !useHistory.getState().error
      )
        await useHistory.getState().generateTitle(current.sessionId, current.modelId);
    })();
    endingOperation = { sessionId, promise, options: policy };
    return promise.finally(() => {
      if (endingOperation?.promise === promise) endingOperation = undefined;
    });
  },
  reset() {
    get().clearScreenshots();
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
      knowledgeBaseName: undefined,
      updatingModel: false,
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
      audioLevels: {},
      reconnecting: false,
      switchingSpeech: false,
      speechSwitchError: null,
      screenshots: [],
      capturingScreenshot: false,
      speech: { ...get().speech, state: 'idle' },
    });
  },
  async ask(question, sourceTranscriptIds, screenshotIds = []) {
    if (get().updatingModel || (!question.trim() && !screenshotIds.length)) return;
    if (get().status === 'ended') {
      get().reset();
    }
    if (!get().sessionId)
      set({ sessionId: crypto.randomUUID(), startedAt: Date.now(), endedAt: null });
    const screenshotMode = screenshotIds.length ? (question.trim() ? 'attach' : 'only') : undefined;
    answerController?.abort();
    set((state) => ({
      answers: state.answers.map((answer) =>
        answer.status === 'streaming' ? { ...answer, status: 'stopped' as const } : answer,
      ),
    }));
    const controller = new AbortController();
    answerController = controller;
    const answerId = id();
    const sentImages = get()
      .screenshots.filter((shot) => screenshotIds.includes(shot.id))
      .map((shot) => ({ ...shot }));
    if (screenshotIds.length) answerScreenshots.set(answerId, screenshotIds);
    set((state) => ({
      answers: [
        ...state.answers,
        {
          id: answerId,
          question: question.trim() || '截图中的题目',
          sourceTranscriptIds,
          ...(screenshotMode ? { screenshot: screenshotMode } : {}),
          ...(sentImages.length ? { images: sentImages } : {}),
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
        if (screenshotMode) {
          const saved = await window.desktop!.interviewScreenshot({
            op: 'archive',
            ids: screenshotIds,
          });
          controller.signal.throwIfAborted();
          if (!saved.ok) throw Error(saved.error.message);
          if (
            !validInterviewImages(saved.images) ||
            saved.images.length !== screenshotIds.length ||
            saved.images.some((image, index) => image.id !== screenshotIds[index])
          )
            throw Error('截图保存未完成，请重试。');
          set((state) => ({
            answers: state.answers.map((answer) =>
              answer.id === answerId ? { ...answer, images: saved.images } : answer,
            ),
          }));
          get().archive('interrupted');
        }
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
          screenshotIds,
          (attempt, limit) => {
            if (!controller.signal.aborted)
              set((state) => ({
                answers: state.answers.map((answer) =>
                  answer.id === answerId
                    ? {
                        ...answer,
                        retry: { attempt, limit },
                        reasoningSummary: undefined,
                        activity: { phase: 'waiting' },
                      }
                    : answer,
                ),
              }));
          },
        );
        controller.signal.throwIfAborted();
        answerScreenshots.delete(answerId);
        set((state) => ({
          screenshots: state.screenshots.filter((shot) => !screenshotIds.includes(shot.id)),
          answers: state.answers.map((a) =>
            a.id === answerId
              ? {
                  ...a,
                  provider: provider ?? a.provider,
                  status: 'completed' as const,
                  retry: undefined,
                }
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
              void get().submitTranscript(undefined, false, true);
          });
        }
      }
    }
  },
  stopAnswer() {
    automaticQuestion.cancel();
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
    const screenshotIds = answerScreenshots.get(answer.id) ?? [];
    if (
      answer.screenshot &&
      (!screenshotIds.length ||
        screenshotIds.some((id) => !get().screenshots.some((shot) => shot.id === id)))
    ) {
      set({ error: '原截图已移除，请重新截图后发送。' });
      return;
    }
    await get().ask(
      answer.screenshot === 'only' ? '' : answer.question,
      answer.sourceTranscriptIds,
      screenshotIds,
    );
  },
}));
