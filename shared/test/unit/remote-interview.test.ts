import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  RemoteCommand,
  RemoteInterviewSnapshot,
} from '../../electron/contracts/remoteConnection';
import type { SpeechEvent } from '../../electron/contracts/speech';
import { useInterview } from '../../src/stores/interview';
import { useRemoteConnection } from '../../src/stores/remoteConnection';
import { connectRemoteInterview, projectRemoteInterview } from '../../src/services/remoteInterview';

let receiveCommand: (command: RemoteCommand) => void;
let receiveSpeech: (event: SpeechEvent) => void;
let dispose: (() => void) | undefined;
const snapshots: RemoteInterviewSnapshot[] = [];
const completed = vi.fn(async () => {});
const answers = vi.fn();
let finishAnswer: (() => void) | undefined;
const revisions = {
  sessionEpoch: 1,
  revision: 1,
  micRevision: 1,
  autoAnswerRevision: 1,
  pendingQuestionRevision: 1,
};
const current = () => snapshots.at(-1)!;
const command = (value: Omit<RemoteCommand, 'sessionId' | 'sessionEpoch'>) => {
  receiveCommand({
    ...value,
    sessionId: current().sessionId!,
    sessionEpoch: current().sessionEpoch,
  } as RemoteCommand);
};
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(async () => {
  vi.useFakeTimers();
  snapshots.length = 0;
  completed.mockClear();
  answers.mockReset();
  answers.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishAnswer = () =>
          resolve({ ok: true, answerText: 'Synthetic answer', sources: [], usage: null });
      }),
  );
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('window', {
    desktop: {
      speech: vi.fn(async (call) => ({
        state: call.op === 'start' ? 'running' : 'idle',
        model: 'synthetic',
      })),
      onSpeechEvent: (callback) => {
        receiveSpeech = callback;
        return () => {};
      },
      onChatEvent: () => () => {},
      interviewAnswer: answers,
      interviewCancel: vi.fn(async () => {}),
      setInterviewInput: vi.fn(async (inputState) => ({
        state: 'running',
        model: 'synthetic',
        inputState,
      })),
      publishRemoteInterview: vi.fn(async (snapshot) => {
        snapshots.push(snapshot);
      }),
      onRemoteCommand: (callback) => {
        receiveCommand = callback;
        return () => {};
      },
      finishRemoteCommand: completed,
    },
  });
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  useInterview.getState().configure({
    mode: 'local',
    aiEnabled: true,
    modelId: 'synthetic-model',
    options: {
      sources: ['microphone', 'system'],
      microphone: 'synthetic-mic',
      system: 'synthetic-output',
    },
  });
  useInterview.getState().start();
  await settle();
  receiveSpeech({ type: 'status', status: { state: 'running', model: 'synthetic' } });
  useInterview.getState().setAutoAnswer(false);
  useRemoteConnection.setState({
    error: null,
    state: {
      status: 'connected',
      revision: 1,
      addresses: ['192.0.2.1'],
      clientName: null,
      pending: null,
      error: null,
    },
  });
  dispose = connectRemoteInterview();
  await settle();
});
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  useInterview.getState().reset();
  finishAnswer?.();
  finishAnswer = undefined;
  await settle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('projects bounded latest text with explicit omissions and excludes provider/image data', () => {
  const state = useInterview.getState();
  const snapshot = projectRemoteInterview(
    {
      ...state,
      transcripts: Array.from({ length: 220 }, (_, index) => ({
        id: String(index),
        text: '合成转录'.repeat(1600),
        time: '12:00',
        final: true,
      })),
      answers: Array.from({ length: 45 }, (_, index) => ({
        id: 'answer-' + index,
        question: 'Synthetic',
        content: '合成回答'.repeat(40000),
        images: [{ id: 'private-image' }] as never,
        provider: 'private-provider',
      })),
    },
    revisions,
  );
  const serialized = JSON.stringify(snapshot);
  expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(900 * 1024);
  expect(snapshot.answers.at(-1)?.id).toBe('answer-44');
  expect(snapshot.omitted.transcripts).toBeGreaterThan(0);
  expect(snapshot.omitted.answers).toBeGreaterThan(0);
  expect(snapshot.answers.at(-1)?.contentTruncated).toBe(true);
  expect(serialized).not.toContain('private-image');
  expect(serialized).not.toContain('private-provider');
});

it('ACKs a manual question before the provider completes and never rewrites the desktop draft', async () => {
  useInterview.setState({ draftQuestion: 'Desktop transcription draft' });
  command({ requestId: 'manual-1', action: 'ask', text: 'Phone manual question' } as RemoteCommand);
  await settle();
  expect(answers).toHaveBeenCalledOnce();
  expect(useInterview.getState().generating).toBe(true);
  expect(useInterview.getState().draftQuestion).toBe('Desktop transcription draft');
  expect(completed).toHaveBeenCalledWith({
    requestId: 'manual-1',
    ok: true,
    answerId: useInterview.getState().answers.at(-1)!.id,
  });
  command({ requestId: 'manual-1', action: 'ask', text: 'Phone manual question' } as RemoteCommand);
  await settle();
  expect(answers).toHaveBeenCalledOnce();
});

it('rejects stale field revisions and uses absolute microphone state with the native ACK', async () => {
  const before = current().micRevision;
  command({
    requestId: 'mic-1',
    action: 'set-microphone',
    muted: true,
    expectedRevision: before,
  } as RemoteCommand);
  await settle();
  expect(useInterview.getState().microphoneMuted).toBe(true);
  expect(window.desktop!.setInterviewInput).toHaveBeenCalledOnce();
  command({
    requestId: 'mic-stale',
    action: 'set-microphone',
    muted: false,
    expectedRevision: before,
  } as RemoteCommand);
  await settle();
  expect(useInterview.getState().microphoneMuted).toBe(true);
  expect(window.desktop!.setInterviewInput).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: 'mic-stale', ok: false }),
  );
});

it('rejects old-session commands and a stale stop that targets a different answer', async () => {
  const old = current();
  useInterview.setState({
    sessionId: 'new-session',
    generating: true,
    answers: [{ id: 'new-answer', question: 'New', content: '', status: 'streaming' }],
  });
  receiveCommand({
    requestId: 'old-session',
    sessionId: old.sessionId!,
    sessionEpoch: old.sessionEpoch,
    action: 'set-auto-answer',
    enabled: true,
    expectedRevision: old.autoAnswerRevision,
  });
  await settle();
  expect(useInterview.getState().autoAnswer).toBe(false);
  await vi.advanceTimersByTimeAsync(80);
  command({
    requestId: 'old-answer',
    action: 'stop-answer',
    answerId: 'old-answer',
  } as RemoteCommand);
  await settle();
  expect(useInterview.getState().generating).toBe(true);
  expect(completed).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: 'old-answer', ok: false }),
  );
});

it('consumes a versioned transcript once and rejects the same candidate after it was sent', async () => {
  receiveSpeech({
    type: 'segment',
    segment: {
      id: 'question-1',
      source: 'system',
      text: 'Synthetic current question',
      final: true,
      startMs: 0,
      endMs: 500,
      reason: 'silence',
    },
  });
  await vi.advanceTimersByTimeAsync(80);
  const pending = current();
  command({
    requestId: 'transcript-1',
    action: 'ask',
    text: pending.pendingQuestion,
    pendingQuestionRevision: pending.pendingQuestionRevision,
  } as RemoteCommand);
  await settle();
  expect(answers).toHaveBeenCalledOnce();
  expect(useInterview.getState().draftQuestion).toBe('');
  finishAnswer?.();
  await settle();
  command({
    requestId: 'transcript-stale',
    action: 'ask',
    text: pending.pendingQuestion,
    pendingQuestionRevision: pending.pendingQuestionRevision,
  } as RemoteCommand);
  await settle();
  expect(answers).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: 'transcript-stale', ok: false }),
  );
});

it('coalesces fast answer changes and never publishes after disposal', async () => {
  const before = snapshots.length;
  for (let index = 0; index < 30; index++)
    useInterview.setState({ answers: [{ id: 'answer', question: 'Q', content: String(index) }] });
  expect(snapshots).toHaveLength(before);
  await vi.advanceTimersByTimeAsync(80);
  expect(snapshots).toHaveLength(before + 1);
  expect(current().answers[0].content).toBe('29');
  dispose?.();
  dispose = undefined;
  useInterview.setState({ autoAnswer: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(snapshots).toHaveLength(before + 1);
});

it('keeps only the latest replacement while a publication is still in flight', async () => {
  let release!: () => void;
  const publish = vi.mocked(window.desktop!.publishRemoteInterview);
  publish.mockImplementationOnce(async (snapshot) => {
    snapshots.push(snapshot);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  useInterview.setState({ answers: [{ id: 'answer', question: 'Q', content: 'first' }] });
  await vi.advanceTimersByTimeAsync(80);
  const inFlightCount = publish.mock.calls.length;
  for (let index = 0; index < 100; index++)
    useInterview.setState({
      answers: [{ id: 'answer', question: 'Q', content: 'update-' + index }],
    });
  await vi.advanceTimersByTimeAsync(1000);
  expect(publish).toHaveBeenCalledTimes(inFlightCount);
  release();
  await settle();
  await vi.advanceTimersByTimeAsync(80);
  expect(publish).toHaveBeenCalledTimes(inFlightCount + 1);
  expect(current().answers.at(-1)?.content).toBe('update-99');
});

it('does no snapshot IPC while the feature is off and publishes the latest state when enabled', async () => {
  useRemoteConnection.setState((state) => ({
    state: { ...state.state!, status: 'off', revision: 2 },
  }));
  const publish = vi.mocked(window.desktop!.publishRemoteInterview);
  const before = publish.mock.calls.length;
  for (let index = 0; index < 100; index++)
    useInterview.setState({
      answers: [{ id: 'off-answer', question: 'Q', content: 'latest-' + index }],
    });
  useInterview.getState().setAutoAnswer(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(publish).toHaveBeenCalledTimes(before);
  useRemoteConnection.setState((state) => ({
    state: { ...state.state!, status: 'waiting', revision: 3 },
  }));
  await vi.advanceTimersByTimeAsync(80);
  expect(publish).toHaveBeenCalledTimes(before + 1);
  expect(current().answers.at(-1)?.content).toBe('latest-99');
  expect(current().autoAnswer).toBe(true);
  expect(current().autoAnswerRevision).toBeGreaterThan(1);
});

it('does not apply a delayed native microphone ACK to a different session', async () => {
  let release!: (value: unknown) => void;
  vi.mocked(window.desktop!.setInterviewInput).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }) as never,
  );
  command({
    requestId: 'native-old',
    action: 'set-microphone',
    muted: true,
    expectedRevision: current().micRevision,
  } as RemoteCommand);
  expect(window.desktop!.setInterviewInput).toHaveBeenCalledOnce();
  useInterview.setState({ sessionId: 'replacement-session', microphoneMuted: false });
  release({
    state: 'running',
    model: 'synthetic',
    inputState: { inputMode: 'remote', microphoneMuted: true },
  });
  await settle();
  expect(useInterview.getState().microphoneMuted).toBe(false);
  expect(completed).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: 'native-old', ok: false }),
  );
});

it('shares explicit empty drafts with strict CAS and rejects writes during PC composition', async () => {
  const before = useInterview.getState().inputDraftRevision;
  command({
    requestId: 'draft-1',
    action: 'set-draft',
    text: 'Phone input',
    expectedRevision: before,
  } as RemoteCommand);
  await settle();
  expect(useInterview.getState().inputDraft).toBe('Phone input');
  useInterview.getState().setInputDraftComposing(true);
  command({
    requestId: 'draft-busy',
    action: 'set-draft',
    text: 'Overwrite',
    expectedRevision: useInterview.getState().inputDraftRevision,
  } as RemoteCommand);
  await settle();
  expect(completed).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: 'draft-busy', ok: false, error: 'draft-busy' }),
  );
  useInterview.getState().setInputDraftComposing(false);
  command({
    requestId: 'draft-stale',
    action: 'set-draft',
    text: 'Old',
    expectedRevision: before,
  } as RemoteCommand);
  command({
    requestId: 'draft-clear',
    action: 'set-draft',
    text: '',
    expectedRevision: useInterview.getState().inputDraftRevision,
  } as RemoteCommand);
  await settle();
  expect(useInterview.getState().inputDraft).toBe('');
  expect(completed).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: 'draft-stale', ok: false, error: 'draft-conflict' }),
  );
});

it('sends the shared input revision through transcript consumption and protects subsequent editing', async () => {
  receiveSpeech({
    type: 'segment',
    segment: {
      id: 'shared-source',
      source: 'system',
      text: 'Original transcription',
      final: true,
      startMs: 0,
      endMs: 500,
      reason: 'silence',
    },
  });
  useInterview.getState().setInputDraft('Edited shared input');
  const revision = useInterview.getState().inputDraftRevision;
  command({
    requestId: 'shared-ask',
    action: 'ask',
    text: 'Edited shared input',
    inputDraftRevision: revision,
  } as RemoteCommand);
  useInterview.getState().setInputDraft('Next desktop input');
  await settle();
  expect(answers).toHaveBeenCalledOnce();
  expect(useInterview.getState().answers.at(-1)?.sourceTranscriptIds).toContain('shared-source');
  expect(useInterview.getState().inputDraft).toBe('Next desktop input');
  expect(completed).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: 'shared-ask',
      ok: true,
      inputDraftRevision: expect.any(Number),
    }),
  );
});

it('publishes the latest canonical revision after nested automatic-draft updates', async () => {
  receiveSpeech({
    type: 'segment',
    segment: {
      id: 'nested-source',
      source: 'system',
      text: 'Automatic shared input',
      final: true,
      startMs: 0,
      endMs: 500,
      reason: 'silence',
    },
  });
  await vi.advanceTimersByTimeAsync(80);
  expect(current().inputDraft).toEqual({
    text: 'Automatic shared input',
    revision: useInterview.getState().inputDraftRevision,
    manual: false,
  });
});

it('labels an oversized automatic draft and refuses to consume only its visible prefix', async () => {
  useInterview.setState({ draftQuestion: '长'.repeat(6001) });
  await vi.advanceTimersByTimeAsync(80);
  expect(current().inputDraft).toMatchObject({ text: '长'.repeat(6000), truncated: true });
  const before = useInterview.getState().inputDraftRevision;
  command({
    requestId: 'too-long-shared',
    action: 'ask',
    text: '长'.repeat(6000),
    inputDraftRevision: before,
  } as RemoteCommand);
  await settle();
  expect(answers).not.toHaveBeenCalled();
  expect(useInterview.getState().draftQuestion).toHaveLength(6001);
  expect(completed).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: 'too-long-shared', ok: false, error: 'draft-too-long' }),
  );
});
