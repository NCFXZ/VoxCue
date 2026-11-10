import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerInterviewShortcuts } from '../../electron/interviewShortcuts';
import { useInterview } from '../../src/stores/interview';

const submitTranscript = useInterview.getState().submitTranscript;
let reply: ((value: unknown) => void) | undefined;
const answer = vi.fn();
beforeEach(() => {
  answer.mockReset().mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('window', {
    desktop: {
      speech: vi.fn(async () => ({ state: 'idle', model: 'Synthetic' })),
      onChatEvent: () => () => {},
      interviewAnswer: answer,
      interviewCancel: vi.fn(async () => {}),
    },
  });
  useInterview.getState().reset();
  useInterview.setState({
    sessionId: 'synthetic-input-session', status: 'running', mode: 'local',
    aiEnabled: true, modelId: 'synthetic-model', autoAnswer: false,
  });
});
afterEach(async () => {
  useInterview.getState().reset();
  reply?.({ ok: true, answerText: 'Synthetic answer', sources: [], usage: null });
  reply = undefined;
  await Promise.resolve();
  await Promise.resolve();
  vi.restoreAllMocks();
  useInterview.setState({ submitTranscript });
  vi.unstubAllGlobals();
});

it('sends the current shared input through the global shortcut while the entire window stays hidden', () => {
  const callbacks = new Map<string, () => void>();
  const window = {
    isDestroyed: () => false, isVisible: () => false,
    hide: vi.fn(), showInactive: vi.fn(),
  };
  const dispose = registerInterviewShortcuts({
    registry: {
      register: (key, callback) => { callbacks.set(key, callback); return true; },
      unregister: (key) => { callbacks.delete(key); },
    },
    window,
    ready: () => true,
    command: (command) => {
      if (command === 'submit-input') useInterview.getState().submitInput();
    },
  });
  useInterview.getState().setInputDraft('Old draft');
  useInterview.getState().setInputDraft('  Current shared draft  ');
  callbacks.get('Control+Shift+Enter')!();
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0]).toMatchObject({ question: 'Current shared draft' });
  expect(useInterview.getState().answers.at(-1)?.question).toBe('Current shared draft');
  expect(useInterview.getState().inputDraft).toBeNull();
  expect(window.hide).not.toHaveBeenCalled();
  expect(window.showInactive).not.toHaveBeenCalled();
  callbacks.get('Control+Shift+Enter')!();
  expect(answer).toHaveBeenCalledOnce();
  expect(useInterview.getState().answers).toHaveLength(1);
  expect(useInterview.getState().answers[0].status).toBe('streaming');
  dispose();
});

it('never falls back to an older transcript for an explicitly cleared global input', () => {
  useInterview.setState({
    draftQuestion: 'Current candidate', pendingQuestion: 'Current candidate',
    transcripts: [{ id: 'old', text: 'Older question', time: '12:00', final: true, source: 'system' }],
  });
  useInterview.getState().setInputDraft('');
  expect(useInterview.getState().submitInput()).toBe(false);
  expect(answer).not.toHaveBeenCalled();
  expect(useInterview.getState().inputDraft).toBe('');
  expect(useInterview.getState().pendingQuestion).toBe('Current candidate');
});

it.each([
  { inputDraftComposing: true },
  { capturingScreenshot: true },
  { updatingModel: true },
  { status: 'ended' as const },
  { status: 'idle' as const },
])('preserves unsent text while unavailable: %j', (patch) => {
  useInterview.getState().setInputDraft('Unsent question');
  useInterview.setState(patch);
  expect(useInterview.getState().submitInput()).toBe(false);
  expect(answer).not.toHaveBeenCalled();
  expect(useInterview.getState().inputDraft).toBe('Unsent question');
});

it('retains a newer shared edit made as the submitted answer is accepted', () => {
  useInterview.getState().setInputDraft('Submitted text');
  const unsubscribe = useInterview.subscribe((state, previous) => {
    if (state.answers.length > previous.answers.length)
      state.setInputDraft('Next shared draft');
  });
  try {
    expect(useInterview.getState().submitInput()).toBe(true);
    expect(answer.mock.calls[0][0]).toMatchObject({ question: 'Submitted text' });
    expect(useInterview.getState().inputDraft).toBe('Next shared draft');
  } finally {
    unsubscribe();
  }
});

it('cannot submit while the interview is finishing its last audio flush', async () => {
  let stopped!: (value: unknown) => void;
  vi.mocked(window.desktop!.speech).mockReturnValueOnce(new Promise((resolve) => {
    stopped = resolve;
  }));
  useInterview.getState().setInputDraft('Unsent at end');
  const ending = useInterview.getState().end({ generateTitle: false });
  expect(useInterview.getState().status).toBe('paused');
  expect(useInterview.getState().submitInput()).toBe(false);
  expect(answer).not.toHaveBeenCalled();
  expect(useInterview.getState().inputDraft).toBe('Unsent at end');
  stopped({ state: 'idle', model: 'Synthetic' });
  await ending;
});

it('keeps the draft if the existing submit path does not create an answer', () => {
  useInterview.getState().setInputDraft('Not accepted');
  vi.spyOn(useInterview.getState(), 'submitTranscript').mockResolvedValue();
  expect(useInterview.getState().submitInput()).toBe(false);
  expect(useInterview.getState().inputDraft).toBe('Not accepted');
  expect(answer).not.toHaveBeenCalled();
});

it('rejects an outdated visible input revision and retains the latest shared edit', () => {
  useInterview.getState().setInputDraft('Rendered text');
  const rendered = useInterview.getState().inputDraftRevision;
  useInterview.getState().setInputDraft('New device edit');
  expect(useInterview.getState().submitInput({ expectedRevision: rendered })).toBe(false);
  expect(answer).not.toHaveBeenCalled();
  expect(useInterview.getState().inputDraft).toBe('New device edit');
  expect(useInterview.getState().error).toBe('输入已变化，请确认内容后重新发送。');
});

it('keeps the existing explicit fallback for the visible send button', () => {
  useInterview.getState().setInputDraft('');
  expect(useInterview.getState().submitInput({ fallbackQuestion: 'Visible fallback' })).toBe(true);
  expect(answer.mock.calls[0][0]).toMatchObject({ question: 'Visible fallback' });
});

it('rejects an oversized automatic draft before consuming or clearing the visible question', () => {
  const long = '问'.repeat(6001);
  useInterview.setState({ draftQuestion: long, pendingQuestion: 'Finalized fragment' });
  const revision = useInterview.getState().inputDraftRevision;
  expect(useInterview.getState().submitInput()).toBe(false);
  expect(answer).not.toHaveBeenCalled();
  expect(useInterview.getState().answers).toEqual([]);
  expect(useInterview.getState().draftQuestion).toBe(long);
  expect(useInterview.getState().pendingQuestion).toBe('Finalized fragment');
  expect(useInterview.getState().inputDraftRevision).toBe(revision);
  expect(useInterview.getState().error).toBe('待提交问题超过6000字，请在输入框整理后手动发送。');
});
