import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useInterview } from '../../src/stores/interview';
import { defaultInterviewConfiguration } from '../../src/services/speech';
import type {
  AudioSource,
  SpeechEvent,
  SpeechSegment,
  SpeechStatus,
  InterviewInputState,
} from '../../electron/contracts/speech';

let emit: (event: SpeechEvent) => void;
const realAsk = useInterview.getState().ask;
const running = { state: 'running' as const, model: 'synthetic' };
function say(id: string, text: string, patch: Partial<SpeechSegment> = {}) {
  emit({
    type: 'segment',
    segment: {
      id,
      source: 'microphone',
      text,
      final: true,
      startMs: 0,
      endMs: 1000,
      silenceStartMs: 0,
      reason: 'silence',
      ...patch,
    },
  });
}
async function progress(through: number, source: AudioSource = 'microphone', pending = false) {
  emit({ type: 'audio-progress', source, pending, processedThroughMs: through });
  await vi.advanceTimersByTimeAsync(0);
}
function initialize(inputMode: 'remote' | 'transcription' = 'transcription') {
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  useInterview.getState().initialize({
    ...defaultInterviewConfiguration(),
    inputMode,
    options: {
      sources: inputMode === 'transcription' ? ['microphone'] : ['microphone', 'system'],
      microphone: 'saved-mic',
      system: 'saved-output',
    },
  });
  emit({ type: 'status', status: running });
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('window', {
    desktop: {
      speech: vi.fn(async (call) => ({
        ...running,
        state: call.op === 'start' ? 'running' : call.op === 'pause' ? 'paused' : 'idle',
      })),
      reconnectInterviewAudio: vi.fn(async () => running),
      setInterviewInput: vi.fn(async (inputState: InterviewInputState) => ({
        ...running,
        inputState,
      })),
      onSpeechEvent: vi.fn((callback) => {
        emit = callback;
        return () => {};
      }),
    },
  });
  initialize();
  await vi.advanceTimersByTimeAsync(0);
});
afterEach(() => {
  useInterview.getState().reset();
  useInterview.setState({ ask: realAsk, configurationLocked: false });
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('system audio toggles only after native confirmation while microphone and the current answer continue', async () => {
  initialize('remote');
  await vi.advanceTimersByTimeAsync(0);
  useInterview.setState({
    generating: true,
    answers: [
      { id: 'live-answer', question: 'Synthetic', content: 'Keep streaming', status: 'streaming' },
    ],
  });
  let confirm!: (state: SpeechStatus) => void;
  vi.mocked(window.desktop!.setInterviewInput).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  vi.mocked(window.desktop!.speech).mockClear();
  const changing = useInterview.getState().toggleSystemAudio();
  expect(useInterview.getState()).toMatchObject({
    systemAudioMuted: false,
    systemAudioToggling: true,
    generating: true,
  });
  expect(await useInterview.getState().toggleMicrophone()).toBe(false);
  say('late-system', 'Must not enter', { source: 'system' });
  say('microphone-live', 'Microphone still transcribes');
  expect(useInterview.getState().transcripts.map((row) => row.id)).toEqual(['microphone-live']);
  confirm({
    ...running,
    inputState: { inputMode: 'remote', microphoneMuted: false, systemAudioMuted: true },
  });
  expect(await changing).toBe(true);
  expect(useInterview.getState()).toMatchObject({
    systemAudioMuted: true,
    systemAudioToggling: false,
    microphoneMuted: false,
    generating: true,
  });
  expect(useInterview.getState().options.sources).toEqual(['microphone', 'system']);
  expect(useInterview.getState().answers[0]).toMatchObject({
    id: 'live-answer',
    content: 'Keep streaming',
    status: 'streaming',
  });
  expect(window.desktop!.speech).not.toHaveBeenCalled();
  expect(await useInterview.getState().toggleSystemAudio()).toBe(true);
  expect(useInterview.getState().systemAudioMuted).toBe(false);
  say('restored-system', 'System resumes', { source: 'system' });
  expect(useInterview.getState().transcripts.some((row) => row.id === 'restored-system')).toBe(
    true,
  );
});

it('system shortcut cannot switch transcription mode and a late acknowledgement after pause cannot mute the next run', async () => {
  expect(await useInterview.getState().toggleSystemAudio()).toBe(false);
  expect(useInterview.getState().inputMode).toBe('transcription');
  expect(window.desktop!.setInterviewInput).not.toHaveBeenCalled();
  initialize('remote');
  await vi.advanceTimersByTimeAsync(0);
  let confirm!: (state: SpeechStatus) => void;
  vi.mocked(window.desktop!.setInterviewInput).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  const changing = useInterview.getState().toggleSystemAudio();
  useInterview.getState().pause();
  confirm({
    ...running,
    inputState: { inputMode: 'remote', microphoneMuted: false, systemAudioMuted: true },
  });
  expect(await changing).toBe(false);
  expect(useInterview.getState()).toMatchObject({
    systemAudioMuted: false,
    systemAudioToggling: false,
    status: 'paused',
  });
});

it('preserves confirmed system mute across microphone and input-mode changes without enabling it in transcription mode', async () => {
  initialize('remote');
  await vi.advanceTimersByTimeAsync(0);
  expect(await useInterview.getState().toggleSystemAudio()).toBe(true);
  expect(await useInterview.getState().toggleMicrophone()).toBe(true);
  expect(useInterview.getState()).toMatchObject({ systemAudioMuted: true, microphoneMuted: true });
  expect(await useInterview.getState().setInputMode('transcription')).toBe(true);
  expect(await useInterview.getState().toggleSystemAudio()).toBe(false);
  expect(await useInterview.getState().setInputMode('remote')).toBe(true);
  expect(useInterview.getState()).toMatchObject({ systemAudioMuted: true, inputMode: 'remote' });
});

it('cancels a ready automatic system question immediately while native mute confirmation is pending', async () => {
  initialize('remote');
  await vi.advanceTimersByTimeAsync(0);
  const ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
  let modelReady!: (result: any) => void;
  window.desktop!.updateInterviewModel = vi.fn(
    () =>
      new Promise((resolve) => {
        modelReady = resolve;
      }),
  );
  const modelChange = useInterview.getState().updateModel('synthetic-model', 'auto');
  say('queued-system-question', 'Question waiting for the model update', { source: 'system' });
  await progress(1800, 'system');
  expect(ask).not.toHaveBeenCalled();
  let inputReady!: (status: SpeechStatus) => void;
  vi.mocked(window.desktop!.setInterviewInput).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        inputReady = resolve;
      }),
  );
  const mute = useInterview.getState().toggleSystemAudio();
  modelReady({ ok: true, modelId: 'synthetic-model', effort: 'auto' });
  await modelChange;
  await vi.advanceTimersByTimeAsync(0);
  expect(ask).not.toHaveBeenCalled();
  inputReady({
    ...running,
    inputState: { inputMode: 'remote', microphoneMuted: false, systemAudioMuted: true },
  });
  expect(await mute).toBe(true);
  await progress(8000, 'system');
  expect(ask).not.toHaveBeenCalled();
});

it('麦克风临时稿与终稿立即进入草稿，保留物理来源，不接受系统音频', () => {
  say('mic', '介绍你的', { final: false });
  expect(useInterview.getState().draftQuestion).toBe('介绍你的');
  say('mic', '介绍你的项目');
  say('unselected', '不能进入草稿', { source: 'system' });
  emit({ type: 'gap', source: 'system', message: 'unselected gap' });
  expect(useInterview.getState().draftQuestion).toBe('介绍你的项目');
  expect(useInterview.getState().transcripts).toMatchObject([{ id: 'mic', source: 'microphone' }]);
  expect(useInterview.getState().speechWarnings).toEqual({});
});
it('沿用1800ms音频截止、恢复讲话取消截止及多个终稿合并，不额外按墙钟发送', async () => {
  const ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
  say('a', '第一部分');
  await vi.advanceTimersByTimeAsync(10000);
  expect(ask).not.toHaveBeenCalled();
  await progress(1800, 'system');
  expect(ask).not.toHaveBeenCalled();
  await progress(1799);
  emit({ type: 'speech-start', source: 'microphone' });
  await progress(1800);
  expect(ask).not.toHaveBeenCalled();
  say('b', '第二部分', { startMs: 2000, endMs: 3000, silenceStartMs: 2000 });
  await progress(3800, 'microphone', true);
  expect(ask).not.toHaveBeenCalled();
  await progress(3800);
  expect(ask).toHaveBeenCalledExactlyOnceWith('第一部分 第二部分', ['a', 'b'], []);
  await progress(5000);
  say('b', '重复终稿');
  expect(ask).toHaveBeenCalledTimes(1);
});
it('语气词自动过滤保留原文和手动发送能力，已提交临时稿不因迟到终稿重复提交', async () => {
  const ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
  say('filler', '嗯');
  await progress(1800);
  expect(ask).not.toHaveBeenCalled();
  expect(useInterview.getState().draftQuestion).toBe('嗯');
  await useInterview.getState().submitTranscript();
  expect(ask).toHaveBeenLastCalledWith('嗯', ['filler'], []);
  say('early', '尚未结束的问题', { final: false });
  await useInterview.getState().submitTranscript();
  ask.mockClear();
  say('early', '尚未结束的问题修订');
  await progress(8000);
  expect(ask).not.toHaveBeenCalled();
  expect(useInterview.getState().draftQuestion).toBe('');
});
it('关闭自动回答时逐句进入草稿，手动编辑发送可消费对应麦克风原文', async () => {
  const ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
  useInterview.getState().setAutoAnswer(false);
  say('a', '原问题');
  await progress(4000);
  expect(ask).not.toHaveBeenCalled();
  expect(useInterview.getState().draftQuestion).toBe('原问题');
  await useInterview.getState().submitTranscript('编辑后的问题');
  expect(ask).toHaveBeenCalledExactlyOnceWith('编辑后的问题', ['a'], []);
  expect(useInterview.getState().draftQuestion).toBe('');
});
it('单麦软静音保留连接、草稿和当前回答，不调用暂停或重连，恢复沿用同一场次', async () => {
  say('saved', '未发送的问题');
  const session = useInterview.getState().sessionId;
  const stopAnswer = vi.spyOn(useInterview.getState(), 'stopAnswer');
  vi.mocked(window.desktop!.speech).mockClear();
  expect(await useInterview.getState().toggleMicrophone()).toBe(true);
  expect(window.desktop!.setInterviewInput).toHaveBeenCalledExactlyOnceWith({
    inputMode: 'transcription',
    microphoneMuted: true,
  });
  expect(useInterview.getState()).toMatchObject({
    sessionId: session,
    microphoneMuted: true,
    status: 'running',
    draftQuestion: '未发送的问题',
    reconnecting: false,
  });
  say('muted', '静音后迟到内容');
  expect(useInterview.getState().transcripts.map((row) => row.id)).toEqual(['saved']);
  await progress(8000);
  expect(useInterview.getState().answers).toHaveLength(0);
  expect(await useInterview.getState().toggleMicrophone()).toBe(true);
  expect(useInterview.getState()).toMatchObject({
    sessionId: session,
    microphoneMuted: false,
    status: 'running',
    draftQuestion: '未发送的问题',
  });
  expect(stopAnswer).not.toHaveBeenCalled();
  expect(window.desktop!.speech).not.toHaveBeenCalled();
  expect(window.desktop!.reconnectInterviewAudio).not.toHaveBeenCalled();
});
it('远程麦克风软静音不会屏蔽系统问题或重置已累计的自动发送截止点', async () => {
  initialize('remote');
  await vi.advanceTimersByTimeAsync(0);
  const ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
  say('system', '远程问题', { source: 'system' });
  await progress(1700, 'system');
  let finish!: (status: SpeechStatus) => void;
  vi.mocked(window.desktop!.setInterviewInput).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = useInterview.getState().toggleMicrophone();
  await progress(1800, 'system');
  expect(ask).toHaveBeenCalledExactlyOnceWith('远程问题', ['system'], []);
  finish({ ...running, inputState: { inputMode: 'remote', microphoneMuted: true } });
  expect(await pending).toBe(true);
  expect(useInterview.getState().options.sources).toEqual(['system']);
  expect(await useInterview.getState().toggleMicrophone()).toBe(true);
  expect(useInterview.getState().options).toEqual({
    sources: ['microphone', 'system'],
    microphone: 'saved-mic',
    system: 'saved-output',
  });
  expect(window.desktop!.reconnectInterviewAudio).not.toHaveBeenCalled();
});
it('软静音失败保持采集和已确认状态，仅显示操作错误，不误报断线重连', async () => {
  vi.mocked(window.desktop!.setInterviewInput).mockRejectedValueOnce(
    Error('synthetic gate failure'),
  );
  expect(await useInterview.getState().toggleMicrophone()).toBe(false);
  expect(useInterview.getState()).toMatchObject({
    microphoneMuted: false,
    microphoneToggling: false,
    status: 'running',
    speechError: null,
    error: 'synthetic gate failure',
    reconnecting: false,
  });
});
it('原生确认前不改变显示，连续按键或设备重连互斥，结束后的迟到确认不改下一场', async () => {
  let finish!: (status: SpeechStatus) => void;
  vi.mocked(window.desktop!.setInterviewInput).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = useInterview.getState().toggleMicrophone();
  expect(useInterview.getState()).toMatchObject({
    microphoneMuted: false,
    microphoneToggling: true,
  });
  expect(await useInterview.getState().toggleMicrophone()).toBe(false);
  expect(await useInterview.getState().setInputMode('remote')).toBe(false);
  expect(
    await useInterview.getState().reconnectAudio({ sources: ['microphone'], microphone: 'other' }),
  ).toBe(false);
  expect(window.desktop!.setInterviewInput).toHaveBeenCalledTimes(1);
  expect(window.desktop!.reconnectInterviewAudio).not.toHaveBeenCalled();
  initialize();
  finish({ ...running, inputState: { inputMode: 'transcription', microphoneMuted: true } });
  expect(await pending).toBe(false);
  expect(useInterview.getState()).toMatchObject({
    microphoneMuted: false,
    microphoneToggling: false,
    status: 'running',
  });
});
it('运行中切换问题来源保留转写和回答，旧临时稿与静音截止不会被下一模式误发送', async () => {
  const ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
  say('old', '麦克风旧句');
  say('interim', '未完成旧句', { final: false });
  const session = useInterview.getState().sessionId;
  useInterview.setState({
    answers: [{ id: 'a', question: '已发送', content: '原回答', createdAt: 0 }],
  });
  expect(await useInterview.getState().setInputMode('remote')).toBe(true);
  expect(useInterview.getState()).toMatchObject({
    sessionId: session,
    inputMode: 'remote',
    inputChanging: false,
    status: 'running',
    draftQuestion: '',
    pendingQuestion: '',
  });
  expect(useInterview.getState().transcripts).toHaveLength(2);
  expect(useInterview.getState().answers[0].content).toBe('原回答');
  await progress(8000, 'system');
  expect(ask).not.toHaveBeenCalled();
  say('remote', '远程新句', {
    source: 'system',
    startMs: 9000,
    endMs: 10000,
    silenceStartMs: 9000,
  });
  await progress(10800, 'system');
  expect(ask).toHaveBeenCalledExactlyOnceWith('远程新句', ['remote'], []);
  expect(await useInterview.getState().setInputMode('transcription')).toBe(true);
  say('new-mic', '仅转录新句', { startMs: 11000, endMs: 12000, silenceStartMs: 11000 });
  expect(useInterview.getState().draftQuestion).toBe('仅转录新句');
  await progress(12800);
  expect(ask).toHaveBeenLastCalledWith('仅转录新句', ['new-mic'], []);
  expect(window.desktop!.reconnectInterviewAudio).not.toHaveBeenCalled();
});
it('切换失败保留原模式、草稿和记录，原生未确认不能乐观启用系统音频', async () => {
  say('saved', '已有问题');
  vi.mocked(window.desktop!.setInterviewInput).mockRejectedValueOnce(
    Error('synthetic system unavailable'),
  );
  expect(await useInterview.getState().setInputMode('remote')).toBe(false);
  expect(useInterview.getState()).toMatchObject({
    inputMode: 'transcription',
    inputChanging: false,
    draftQuestion: '已有问题',
    error: 'synthetic system unavailable',
    status: 'running',
  });
  expect(useInterview.getState().transcripts).toHaveLength(1);
  vi.mocked(window.desktop!.setInterviewInput).mockResolvedValueOnce({
    ...running,
    inputState: { inputMode: 'transcription', microphoneMuted: false },
  });
  expect(await useInterview.getState().setInputMode('remote')).toBe(false);
  expect(useInterview.getState().inputMode).toBe('transcription');
});
it('切换方式期间屏蔽旧问题的自动发送；暂停后迟到结果不更改已暂停的设置', async () => {
  const ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
  say('saved', '已有问题');
  let finish!: (status: SpeechStatus) => void;
  vi.mocked(window.desktop!.setInterviewInput).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = useInterview.getState().setInputMode('remote');
  await progress(8000);
  expect(ask).not.toHaveBeenCalled();
  useInterview.getState().pause();
  finish({ ...running, inputState: { inputMode: 'remote', microphoneMuted: false } });
  expect(await pending).toBe(false);
  expect(useInterview.getState()).toMatchObject({
    inputMode: 'transcription',
    inputChanging: false,
    status: 'paused',
    draftQuestion: '已有问题',
  });
});
it('重载快照和暂停状态保留软静音，控制操作不会自动恢复暂停采集', async () => {
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  window.desktop!.speech = vi.fn(async () => ({
    ...running,
    inputState: { inputMode: 'transcription', microphoneMuted: true },
  }));
  useInterview.getState().initialize(
    {
      ...defaultInterviewConfiguration(),
      inputMode: 'transcription',
      options: { sources: ['microphone'] },
    },
    { inputMode: 'transcription', microphoneMuted: true },
  );
  expect(useInterview.getState().microphoneMuted).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(useInterview.getState().microphoneMuted).toBe(true);
  useInterview.setState({ status: 'paused', speech: { ...running, state: 'paused' } });
  vi.mocked(window.desktop!.setInterviewInput).mockResolvedValueOnce({
    state: 'paused',
    model: 'synthetic',
    inputState: { inputMode: 'transcription', microphoneMuted: false },
  });
  expect(await useInterview.getState().toggleMicrophone()).toBe(true);
  expect(useInterview.getState()).toMatchObject({
    microphoneMuted: false,
    status: 'paused',
    speech: { state: 'paused' },
  });
});
