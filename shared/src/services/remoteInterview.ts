import type {
  RemoteCommand,
  RemoteCommandResult,
  RemoteInterviewSnapshot,
} from '../../electron/contracts/remoteConnection';
import { questionSource } from '../../electron/contracts/speechSettings';
import { useInterview } from '../stores/interview';
import { useRemoteConnection } from '../stores/remoteConnection';

type InterviewState = ReturnType<typeof useInterview.getState>;
interface Revisions {
  sessionEpoch: number;
  revision: number;
  micRevision: number;
  autoAnswerRevision: number;
  pendingQuestionRevision: number;
}
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
let lastEpoch = 0;
const nextEpoch = () => (lastEpoch = Math.max(Date.now(), lastEpoch + 1));
const candidate = (state: InterviewState) => state.draftQuestion || state.pendingQuestion;
const lastQuestionTranscript = (state: InterviewState) => {
  const source = questionSource(state.inputMode);
  for (let index = state.transcripts.length - 1; index >= 0; index--)
    if (state.transcripts[index].source === source) return state.transcripts[index];
};

export function projectRemoteInterview(
  state: InterviewState,
  revisions: Revisions,
): RemoteInterviewSnapshot {
  const active =
    state.mode === 'local' && !!state.sessionId && ['running', 'paused'].includes(state.status);
  const microphoneBusy =
    state.microphoneToggling ||
    state.systemAudioToggling ||
    state.inputChanging ||
    state.reconnecting ||
    state.switchingSpeech;
  const rawDraft = state.inputDraft ?? state.draftQuestion;
  const snapshot: RemoteInterviewSnapshot = {
    ...revisions,
    sessionId: state.mode === 'local' ? state.sessionId : null,
    status: state.mode === 'local' ? state.status : 'idle',
    inputMode: state.inputMode,
    transcripts: [],
    answers: [],
    pendingQuestion: candidate(state).slice(0, 6000),
    inputDraft: {
      text: state.mode === 'local' ? rawDraft.slice(0, 6000) : '',
      revision: state.inputDraftRevision,
      manual: state.inputDraft !== null,
      ...(rawDraft.length > 6000 ? { truncated: true } : {}),
    },
    generating: state.generating,
    aiEnabled: state.aiEnabled,
    microphoneMuted: state.microphoneMuted,
    microphoneToggling: microphoneBusy,
    autoAnswer: state.autoAnswer,
    omitted: { transcripts: state.transcripts.length, answers: state.answers.length },
    capabilities: {
      sendQuestion:
        active && state.aiEnabled && !!state.modelId && !state.generating && !state.updatingModel,
      setMicrophone:
        active && !microphoneBusy && ['running', 'paused'].includes(state.speech.state),
      setAutoAnswer: active && state.aiEnabled,
      stopAnswer: active && state.generating,
    },
  };
  if (state.mode !== 'local') return snapshot;
  // Full replacement snapshots stay bounded. Keep the newest complete rows,
  // label omitted history, and reserve room for the currently streaming answer.
  let budget = 900 * 1024 - bytes(snapshot);
  const answers = state.answers.slice(-40).map((row) => ({
    id: row.id,
    question: row.question.slice(0, 6000),
    content: row.content.slice(-128000),
    ...(row.status ? { status: row.status } : {}),
    ...(row.error ? { error: row.error.slice(0, 2000) } : {}),
    ...(row.content.length > 128000 ? { contentTruncated: true } : {}),
  }));
  const transcripts = state.transcripts.slice(-200).map((row) => ({
    id: row.id,
    text: row.text.slice(0, 6000),
    time: row.time,
    final: row.final,
    ...(row.source ? { source: row.source } : {}),
    ...(row.text.length > 6000 ? { textTruncated: true } : {}),
  }));
  // Share the remaining budget between both histories without dropping the
  // latest answer to make room for older transcript rows.
  let answerIndex = answers.length - 1,
    transcriptIndex = transcripts.length - 1;
  while (answerIndex >= 0 || transcriptIndex >= 0) {
    if (answerIndex >= 0) {
      const row = answers[answerIndex--],
        size = bytes(row) + 1;
      if (size <= budget) {
        snapshot.answers.unshift(row);
        budget -= size;
      } else answerIndex = -1;
    }
    if (transcriptIndex >= 0) {
      const row = transcripts[transcriptIndex--],
        size = bytes(row) + 1;
      if (size <= budget) {
        snapshot.transcripts.unshift(row);
        budget -= size;
      } else transcriptIndex = -1;
    }
  }
  snapshot.omitted = {
    transcripts: state.transcripts.length - snapshot.transcripts.length,
    answers: state.answers.length - snapshot.answers.length,
  };
  return snapshot;
}

const relevant = (state: InterviewState, previous: InterviewState) =>
  state.sessionId !== previous.sessionId ||
  state.mode !== previous.mode ||
  state.status !== previous.status ||
  state.inputMode !== previous.inputMode ||
  state.transcripts !== previous.transcripts ||
  state.answers !== previous.answers ||
  candidate(state) !== candidate(previous) ||
  state.generating !== previous.generating ||
  state.aiEnabled !== previous.aiEnabled ||
  state.autoAnswer !== previous.autoAnswer ||
  state.modelId !== previous.modelId ||
  state.inputDraftRevision !== previous.inputDraftRevision ||
  state.inputDraft !== previous.inputDraft ||
  state.microphoneMuted !== previous.microphoneMuted ||
  state.microphoneToggling !== previous.microphoneToggling ||
  state.systemAudioToggling !== previous.systemAudioToggling ||
  state.inputChanging !== previous.inputChanging ||
  state.reconnecting !== previous.reconnecting ||
  state.switchingSpeech !== previous.switchingSpeech ||
  state.updatingModel !== previous.updatingModel ||
  state.speech.state !== previous.speech.state;

export function connectRemoteInterview(): () => void {
  const desktop = window.desktop;
  if (!desktop?.publishRemoteInterview || !desktop.onRemoteCommand || !desktop.finishRemoteCommand)
    return () => {};
  let active = true;
  let revisions: Revisions = {
    sessionEpoch: nextEpoch(),
    revision: 1,
    micRevision: 1,
    autoAnswerRevision: 1,
    pendingQuestionRevision: 1,
  };
  let latest: InterviewState | undefined = useInterview.getState();
  let publishing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const enabled = () =>
    ['waiting', 'connected', 'reconnecting'].includes(
      useRemoteConnection.getState().state?.status ?? '',
    );
  const requests = new Map<string, { fingerprint: string; result: Promise<RemoteCommandResult> }>();
  const flush = () => {
    timer = undefined;
    if (!active || publishing || !latest || !enabled()) return;
    const snapshot = projectRemoteInterview(latest, revisions);
    latest = undefined;
    publishing = true;
    void desktop
      .publishRemoteInterview(snapshot)
      .catch(() => {
        if (active) useRemoteConnection.setState({ error: '无法同步设备画面，请重新连接。' });
      })
      .finally(() => {
        publishing = false;
        if (active && latest && !timer && enabled()) timer = setTimeout(flush, 80);
      });
  };
  let observed = useInterview.getState();
  const unsubscribe = useInterview.subscribe(() => {
    const state = useInterview.getState(),
      previous = observed;
    observed = state;
    if (!relevant(state, previous)) return;
    if (state.sessionId !== previous.sessionId) {
      revisions = {
        sessionEpoch: nextEpoch(),
        revision: revisions.revision,
        micRevision: 1,
        autoAnswerRevision: 1,
        pendingQuestionRevision: 1,
      };
      requests.clear();
    } else {
      if (
        state.microphoneMuted !== previous.microphoneMuted ||
        state.inputMode !== previous.inputMode
      )
        revisions.micRevision++;
      if (state.autoAnswer !== previous.autoAnswer) revisions.autoAnswerRevision++;
      if (
        candidate(state) !== candidate(previous) ||
        state.inputMode !== previous.inputMode ||
        (state.transcripts !== previous.transcripts &&
          lastQuestionTranscript(state) !== lastQuestionTranscript(previous))
      )
        revisions.pendingQuestionRevision++;
    }
    revisions.revision++;
    latest = state;
    if (!timer && !publishing && enabled()) timer = setTimeout(flush, 80);
  });
  const unsubscribeConnection = useRemoteConnection.subscribe((connection, previous) => {
    if (connection.state?.status === previous.state?.status) return;
    if (!enabled()) return;
    latest = useInterview.getState();
    if (!timer && !publishing) timer = setTimeout(flush, 80);
  });
  const execute = async (command: RemoteCommand): Promise<RemoteCommandResult> => {
    const result = (ok: boolean, error?: string): RemoteCommandResult => ({
      requestId: command.requestId,
      ok,
      ...(error ? { error } : {}),
    });
    const state = useInterview.getState();
    if (
      !active ||
      useRemoteConnection.getState().state?.status !== 'connected' ||
      !state.sessionId ||
      command.sessionId !== state.sessionId ||
      command.sessionEpoch !== revisions.sessionEpoch
    )
      return result(false, '面试已变化，请同步后重试。');
    const snapshot = projectRemoteInterview(state, revisions);
    switch (command.action) {
      case 'set-draft': {
        const draftResult = (ok: boolean, error?: string): RemoteCommandResult => ({
          ...result(ok, error),
          inputDraftRevision: useInterview.getState().inputDraftRevision,
        });
        if (!['running', 'paused'].includes(state.status))
          return draftResult(false, 'draft-unavailable');
        if (state.inputDraftComposing) return draftResult(false, 'draft-busy');
        if (typeof command.text !== 'string' || command.text.length > 6000)
          return draftResult(false, 'draft-too-long');
        return state.setInputDraft(command.text, command.expectedRevision)
          ? draftResult(true)
          : draftResult(false, 'draft-conflict');
      }
      case 'set-microphone':
        if (command.expectedRevision !== revisions.micRevision)
          return result(false, '麦克风状态已变化，请同步后重试。');
        if (!snapshot.capabilities.setMicrophone)
          return result(false, '当前无法切换麦克风，请稍后重试。');
        if (state.microphoneMuted === command.muted) return result(true);
        if (!(await state.toggleMicrophone()))
          return result(false, '麦克风切换失败，请在电脑端检查。');
        if (
          !active ||
          command.sessionId !== useInterview.getState().sessionId ||
          command.sessionEpoch !== revisions.sessionEpoch
        )
          return result(false, '面试已变化，本次操作已取消。');
        return useInterview.getState().microphoneMuted === command.muted
          ? result(true)
          : result(false, '麦克风状态未确认，请重试。');
      case 'set-auto-answer':
        if (command.expectedRevision !== revisions.autoAnswerRevision)
          return result(false, '自动回答状态已变化，请同步后重试。');
        if (!snapshot.capabilities.setAutoAnswer) return result(false, '当前无法切换自动回答。');
        if (state.autoAnswer !== command.enabled) state.setAutoAnswer(command.enabled);
        return result(true);
      case 'stop-answer':
        if (!snapshot.capabilities.stopAnswer) return result(false, '当前没有正在生成的回答。');
        if (state.answers.at(-1)?.id !== command.answerId)
          return result(false, '当前回答已变化，请同步后重试。');
        state.stopAnswer();
        return result(true);
      case 'ask': {
        const text = command.text.trim();
        if (!text || text.length > 6000) return result(false, '请输入不超过 6000 字符的问题。');
        if (!snapshot.capabilities.sendQuestion)
          return result(false, '当前无法发送问题，请等待回答完成后重试。');
        const fromTranscript = command.pendingQuestionRevision !== undefined;
        const fromSharedInput = command.inputDraftRevision !== undefined;
        if (fromTranscript && fromSharedInput) return result(false, '无效的问题来源。');
        if (fromSharedInput && (state.inputDraft ?? state.draftQuestion).length > 6000)
          return {
            ...result(false, 'draft-too-long'),
            inputDraftRevision: state.inputDraftRevision,
          };
        if (
          fromSharedInput &&
          (state.inputDraftComposing ||
            command.inputDraftRevision !== state.inputDraftRevision ||
            text !== (state.inputDraft ?? state.draftQuestion).trim())
        )
          return {
            ...result(false, state.inputDraftComposing ? 'draft-busy' : 'draft-conflict'),
            inputDraftRevision: state.inputDraftRevision,
          };
        if (
          fromTranscript &&
          (command.pendingQuestionRevision !== revisions.pendingQuestionRevision ||
            !candidate(state).trim() ||
            text !== candidate(state).trim())
        )
          return result(false, '当前转录问题已变化或已发送，请同步后重试。');
        const previousAnswers = state.answers;
        const pending =
          fromTranscript || fromSharedInput
            ? state.submitTranscript(text, false, false)
            : state.ask(text);
        // Both existing entry points create the answer synchronously before
        // awaiting the provider. ACK acceptance, not the eventual AI outcome.
        const answer = useInterview
          .getState()
          .answers.find((row) => !previousAnswers.some((old) => old.id === row.id));
        void pending.catch(() => {});
        if (answer && fromSharedInput)
          useInterview.getState().setInputDraft(null, command.inputDraftRevision);
        return answer
          ? {
              requestId: command.requestId,
              ok: true,
              answerId: answer.id,
              ...(fromSharedInput
                ? { inputDraftRevision: useInterview.getState().inputDraftRevision }
                : {}),
            }
          : result(false, '问题未被接收，请同步后重试。');
      }
    }
  };
  const unsubscribeCommands = desktop.onRemoteCommand((command) => {
    const fingerprint = JSON.stringify(command);
    let entry = requests.get(command.requestId);
    if (entry && entry.fingerprint !== fingerprint) {
      void desktop
        .finishRemoteCommand({
          requestId: command.requestId,
          ok: false,
          error: '重复的操作标识无效。',
        })
        .catch(() => {});
      return;
    }
    if (!entry) {
      entry = {
        fingerprint,
        result: execute(command).catch(() => ({
          requestId: command.requestId,
          ok: false,
          error: '设备控制操作失败，请重试。',
        })),
      };
      requests.set(command.requestId, entry);
      if (requests.size > 512) requests.delete(requests.keys().next().value!);
    }
    void entry.result.then((result) => {
      if (active) void desktop.finishRemoteCommand(result).catch(() => {});
    });
  });
  flush();
  return () => {
    active = false;
    latest = undefined;
    if (timer) clearTimeout(timer);
    unsubscribe();
    unsubscribeConnection();
    unsubscribeCommands();
    requests.clear();
  };
}
