import { expect, it, vi } from 'vitest';
import { SpeechCoordinator, validateInterviewInput } from '../../electron/application/speech';
import type {
  InterviewConfiguration,
  InterviewInputState,
  SpeechServiceCall,
  SpeechStatus,
  SpeechEvent,
} from '../../electron/contracts/speech';

const remote: InterviewInputState = { inputMode: 'remote', microphoneMuted: false };
const muted: InterviewInputState = { inputMode: 'transcription', microphoneMuted: true };
const configuration = (): InterviewConfiguration => ({
  mode: 'local',
  aiEnabled: false,
  autoAnswer: true,
  modelId: '',
  effort: 'auto',
  options: { sources: ['microphone', 'system'], microphone: 'mic', system: 'output' },
  knowledgeBaseId: 'kept',
  knowledgeBaseName: 'Kept knowledge',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup() {
  const port = {
    call: vi.fn(async (call: SpeechServiceCall): Promise<SpeechStatus> => ({
      state: call.op === 'start' ? 'running' : call.op === 'pause' ? 'paused' : 'idle',
      model: 'synthetic',
      ...(call.op === 'start' ? { inputState: call.inputState } : {}),
    })),
    stop: vi.fn(),
  };
  const coordinator = new SpeechCoordinator(port);
  await coordinator.confirm(configuration());
  await coordinator.interview({ op: 'start', options: configuration().options });
  port.call.mockClear();
  port.stop.mockClear();
  return { coordinator, port };
}
it('accepts only exact owned mode/boolean fields and no source, device or OS-mute controls', () => {
  expect(validateInterviewInput(muted)).toEqual(muted);
  expect(validateInterviewInput({ ...remote, systemAudioMuted: true })).toEqual({
    ...remote,
    systemAudioMuted: true,
  });
  for (const value of [
    null,
    [],
    {},
    { ...muted, systemMute: true },
    { ...muted, microphone: 'other' },
    { inputMode: 'remote', microphoneMuted: 0 },
    { ...remote, systemAudioMuted: 1 },
    { inputMode: 'other', microphoneMuted: false },
    Object.assign(Object.create({ inputMode: 'remote' }), { microphoneMuted: false, path: '/' }),
  ])
    expect(() => validateInterviewInput(value)).toThrow('无效');
});
it('confirms system-only input gating without blocking the microphone or restarting capture, including reconnect state', async () => {
  const { coordinator, port } = await setup(),
    ack = deferred<SpeechStatus>();
  port.call.mockImplementationOnce(() => ack.promise);
  const state = { ...remote, systemAudioMuted: true };
  const changing = coordinator.setInputState(state);
  expect(coordinator.blocksInput({ type: 'speech-start', source: 'system' })).toBe(true);
  expect(coordinator.blocksInput({ type: 'speech-start', source: 'microphone' })).toBe(false);
  expect(coordinator.inputState).toEqual(remote);
  ack.resolve({ state: 'running', model: 'synthetic', inputState: state });
  await changing;
  expect(coordinator.inputState).toEqual(state);
  expect(coordinator.configuration?.options.sources).toEqual(['microphone', 'system']);
  expect(port.stop).not.toHaveBeenCalled();
  expect(port.call.mock.calls).toEqual([[{ op: 'set-input-state', state }]]);
  await coordinator.reconnect();
  expect(port.call.mock.calls.find(([call]) => call.op === 'start')?.[0]).toMatchObject({
    inputState: state,
  });
});

it('rejects a system gate acknowledgement which did not confirm the requested state', async () => {
  const { coordinator, port } = await setup();
  port.call.mockResolvedValueOnce({ state: 'running', model: 'synthetic', inputState: remote });
  await expect(coordinator.setInputState({ ...remote, systemAudioMuted: true })).rejects.toThrow(
    '未能确认',
  );
  expect(coordinator.inputState).toEqual(remote);
  expect(port.stop).toHaveBeenCalledOnce();
});
it('waits for the native ACK, then changes only logical input while preserving session configuration and capture', async () => {
  const { coordinator, port } = await setup(),
    ack = deferred<SpeechStatus>();
  const before = coordinator.configuration;
  port.call.mockImplementationOnce(() => ack.promise);
  const changing = coordinator.setInputState(muted);
  expect(coordinator.inputChanging).toBe(true);
  expect(coordinator.configuration).toEqual(before);
  expect(coordinator.inputState).toEqual(remote);
  ack.resolve({ state: 'running', model: 'synthetic', inputState: muted });
  expect((await changing).inputState).toEqual(muted);
  expect(coordinator.inputChanging).toBe(false);
  expect(coordinator.configuration).toEqual({
    ...before,
    inputMode: 'transcription',
    options: { ...before!.options, sources: ['microphone'] },
  });
  expect(port.call.mock.calls).toEqual([[{ op: 'set-input-state', state: muted }]]);
  expect(port.stop).not.toHaveBeenCalled();
  expect(coordinator.inputState).toEqual(muted);
});
it('keeps system finals and processed progress deliverable during a microphone-only boundary', async () => {
  const { coordinator, port } = await setup(),
    ack = deferred<SpeechStatus>();
  port.call.mockImplementationOnce(() => ack.promise);
  const events: SpeechEvent[] = [
    {
      type: 'segment',
      segment: {
        id: 'system-question',
        source: 'system',
        text: 'Synthetic question',
        final: true,
        startMs: 0,
        endMs: 1000,
        reason: 'silence',
        silenceStartMs: 0,
      },
    },
    { type: 'audio-progress', source: 'system', pending: false, processedThroughMs: 1800 },
    { type: 'speech-start', source: 'microphone' },
    { type: 'audio-progress', source: 'microphone', pending: false, processedThroughMs: 1800 },
  ];
  const next = { ...remote, microphoneMuted: true };
  const changing = coordinator.setInputState(next);
  // Main uses this exact filter before delivering events to context and Renderer.
  expect(events.filter((event) => !coordinator.blocksInput(event))).toEqual(events.slice(0, 2));
  ack.resolve({ state: 'running', model: 'synthetic', inputState: next });
  await changing;
  expect(events.some((event) => coordinator.blocksInput(event))).toBe(false);
});
it('fences both source lanes only while the question input mode changes, and clears on cancellation', async () => {
  const { coordinator, port } = await setup(),
    ack = deferred<SpeechStatus>();
  port.call.mockImplementationOnce(() => ack.promise);
  const changing = coordinator.setInputState(muted);
  const rejected = expect(changing).rejects.toThrow('已取消');
  const mic: SpeechEvent = { type: 'speech-start', source: 'microphone' };
  const system: SpeechEvent = { type: 'audio-progress', source: 'system', pending: false };
  expect(coordinator.blocksInput(mic)).toBe(true);
  expect(coordinator.blocksInput(system)).toBe(true);
  expect(
    coordinator.blocksInput({ type: 'status', status: { state: 'paused', model: 'synthetic' } }),
  ).toBe(false);
  coordinator.cancelInput();
  await rejected;
  expect(coordinator.blocksInput(mic)).toBe(false);
  expect(coordinator.blocksInput(system)).toBe(false);
  ack.resolve({ state: 'running', model: 'late', inputState: muted });
});
it('keeps a paused microphone muted across logical changes and renderer reload/resume', async () => {
  const { coordinator, port } = await setup();
  await coordinator.interview({ op: 'pause' });
  port.call.mockClear();
  port.call.mockResolvedValueOnce({ state: 'paused', model: 'synthetic', inputState: muted });
  await coordinator.setInputState(muted);
  expect(port.call.mock.calls).toEqual([[{ op: 'set-input-state', state: muted }]]);
  coordinator.releaseInterview();
  expect(coordinator.inputState).toEqual(muted);
  await coordinator.interview({ op: 'start', options: coordinator.configuration!.options });
  expect(port.call).toHaveBeenLastCalledWith({
    op: 'start',
    options: coordinator.configuration!.options,
    inputState: muted,
  });
});
it('preserves the old input when native application fails and rejects overlapping input/device operations', async () => {
  const { coordinator, port } = await setup(),
    ack = deferred<SpeechStatus>();
  const before = coordinator.configuration;
  port.call.mockRejectedValueOnce(Error('Synthetic permission failure'));
  await expect(coordinator.setInputState(muted)).rejects.toThrow('permission failure');
  expect(coordinator.configuration).toEqual(before);
  expect(coordinator.inputState).toEqual(remote);
  expect(port.stop).not.toHaveBeenCalled();
  port.call.mockImplementationOnce(() => ack.promise);
  const changing = coordinator.setInputState(muted);
  expect(() => coordinator.setInputState(remote)).toThrow('正在切换');
  expect(() => coordinator.reconnect()).toThrow('正在切换');
  ack.resolve({ state: 'running', model: 'synthetic', inputState: muted });
  await changing;
});
it('fails closed for an unconfirmed/mismatched native ACK without committing a mode', async () => {
  const { coordinator, port } = await setup();
  const before = coordinator.configuration;
  port.call.mockResolvedValueOnce({ state: 'running', model: 'synthetic', inputState: remote });
  await expect(coordinator.setInputState(muted)).rejects.toThrow('未能确认');
  expect(coordinator.configuration).toEqual(before);
  expect(port.stop).toHaveBeenCalledOnce();
  expect(coordinator.inputChanging).toBe(false);
});
it('pause immediately cancels the control lane and late ACKs cannot change the old configuration', async () => {
  const { coordinator, port } = await setup(),
    ack = deferred<SpeechStatus>();
  const before = coordinator.configuration;
  port.call.mockImplementationOnce(() => ack.promise);
  const changing = coordinator.setInputState(muted);
  const rejected = expect(changing).rejects.toThrow('已取消');
  const pausing = coordinator.interview({ op: 'pause' });
  expect(port.call).toHaveBeenCalledWith({ op: 'cancel-input-state' });
  await rejected;
  await pausing;
  ack.resolve({ state: 'running', model: 'late', inputState: muted });
  await Promise.resolve();
  expect(coordinator.configuration).toEqual(before);
  expect(coordinator.inputState).toEqual(remote);
});
it('window/session release retires the pending control before a new confirmation can be mutated', async () => {
  const { coordinator, port } = await setup(),
    ack = deferred<SpeechStatus>();
  port.call.mockImplementationOnce(() => ack.promise);
  const changing = coordinator.setInputState(muted);
  const rejected = expect(changing).rejects.toThrow('已取消');
  coordinator.releaseInterview(true);
  await rejected;
  await coordinator.confirm({
    ...configuration(),
    options: { sources: ['system'], system: 'new' },
  });
  ack.resolve({ state: 'running', model: 'late', inputState: muted });
  await Promise.resolve();
  expect(coordinator.inputState).toEqual({ inputMode: 'remote', microphoneMuted: true });
  expect(coordinator.configuration!.options).toEqual({ sources: ['system'], system: 'new' });
});
