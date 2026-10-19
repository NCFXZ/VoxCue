import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { useInterview } from '../../../shared/src/stores/interview';
import type { SpeechEvent } from '../../../shared/electron/contracts/speech';
import type { ChatEvent } from '../../../shared/electron/contracts/chat';
import { defaultInterviewConfiguration } from '../../../shared/src/services/speech';
let emit: (e: SpeechEvent) => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('window', {
    desktop: {
      speech: vi.fn(async (c) => ({
        state: c.op === 'start' ? 'running' : c.op === 'pause' ? 'paused' : 'idle',
        model: 'test',
      })),
      onSpeechEvent: vi.fn((callback) => {
        emit = callback;
        return () => {
          emit = () => {};
        };
      }),
    },
  });
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  useInterview
    .getState()
    .configure({ mode: 'local', aiEnabled: false, options: { sources: ['microphone', 'system'] } });
  useInterview.getState().setAutoAnswer(false);
  useInterview.getState().start();
  emit({ type: 'status', status: { state: 'running', model: 'test' } });
});
afterEach(() => {
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  useInterview.getState().configure({ mode: 'mock' });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const segment = (id: string, text: string, final: boolean) => ({
  type: 'segment' as const,
  segment: {
    id,
    text,
    final,
    source: 'system' as const,
    startMs: Date.now(),
    endMs: Date.now() + 500,
    reason: 'silence' as const,
  },
});
it('自动回答保留2200ms静音等待，不再提供待提交计时和取消状态', async () => {
  const ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
  useInterview.getState().setAutoAnswer(true);
  emit(segment('normal', '请介绍项目', true));
  await vi.advanceTimersByTimeAsync(2199);
  expect(ask).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(ask).toHaveBeenCalledWith('请介绍项目', ['normal'], []);
  expect(useInterview.getState()).not.toHaveProperty('autoSubmitAt');
  expect(useInterview.getState()).not.toHaveProperty('cancelAutoSubmit');
  expect(useInterview.getState().transcripts.at(-1)?.text).toBe('请介绍项目');
  ask.mockRestore();
});
it('重连音频保留本场记录和回答，恢复后继续接收两路活动及问题', async () => {
  emit(segment('before-reconnect', '已有问题', true));
  const sessionId = useInterview.getState().sessionId;
  useInterview.setState({
    answers: [{ id: 'saved-answer', question: '已有问题', content: '已有回答', createdAt: 0 }],
    screenshots: [{ id: 'shot', preview: 'synthetic' }],
  });
  emit({
    type: 'status',
    status: { state: 'error', model: 'test', error: 'synthetic disconnected' },
  });
  Object.assign(window.desktop!, {
    reconnectInterviewAudio: vi.fn(async () => ({ state: 'running', model: 'test' })),
  });
  expect(
    await useInterview.getState().reconnectAudio({ sources: ['system'], system: 'changed' }),
  ).toBe(true);
  expect(useInterview.getState()).toMatchObject({
    sessionId,
    status: 'running',
    options: { sources: ['system'], system: 'changed' },
  });
  expect(useInterview.getState().transcripts[0].text).toBe('已有问题');
  expect(useInterview.getState().answers[0].content).toBe('已有回答');
  expect(useInterview.getState().screenshots[0].id).toBe('shot');
  emit({ type: 'activity', source: 'system', speaking: true, level: 0.2 });
  emit(segment('after-reconnect', '新问题', true));
  expect(useInterview.getState().audioLevels.system?.level).toBe(0.2);
  expect(useInterview.getState().audioLevels.system?.inputAt).toBe(Date.now());
  expect(useInterview.getState().draftQuestion).toBe('新问题');
});
it('明确回应按2200毫秒自动提交，关闭自动回答后仍可手动发送', async () => {
  const desktop = window.desktop!;
  Object.assign(desktop, {
    onChatEvent: () => () => {},
    interviewCancel: vi.fn(async () => {}),
    interviewAnswer: vi.fn(async () => ({
      ok: true,
      answerText: '合成回答',
      sources: [],
      usage: null,
    })),
  });
  useInterview.setState({ aiEnabled: true, modelId: 'test', effort: 'high' });
  useInterview.getState().setAutoAnswer(true);
  emit(segment('ack-1', '嗯', true));
  emit(segment('ack-2', '好的，谢谢。', true));
  await vi.advanceTimersByTimeAsync(2199);
  expect(desktop.interviewAnswer).not.toHaveBeenCalled();
  expect(useInterview.getState().draftQuestion).toBe('嗯 好的，谢谢。');
  await vi.advanceTimersByTimeAsync(1);
  expect(desktop.interviewAnswer).toHaveBeenCalledOnce();
  expect(useInterview.getState().draftQuestion).toBe('');
  expect(useInterview.getState().transcripts.map((row) => row.text)).toEqual([
    '嗯',
    '好的，谢谢。',
  ]);
  await useInterview.getState().submitTranscript();
  expect(desktop.interviewAnswer).toHaveBeenCalledOnce();
  useInterview.getState().setAutoAnswer(false);
  emit(segment('manual-ack', '谢谢', true));
  await vi.advanceTimersByTimeAsync(3000);
  expect(desktop.interviewAnswer).toHaveBeenCalledOnce();
  await useInterview.getState().submitTranscript();
  expect(desktop.interviewAnswer).toHaveBeenCalledTimes(2);
  expect(useInterview.getState().answers.at(-1)?.question).toBe('谢谢');
  expect(desktop.interviewAnswer).toHaveBeenCalledWith(
    expect.objectContaining({
      question: '嗯 好的，谢谢。',
      modelId: 'test',
      effort: 'high',
    }),
  );
});
it('明确有效问题仍在原来的2200毫秒提交，保留无问号的提问和前置回应', async () => {
  const desktop = window.desktop!;
  Object.assign(desktop, {
    onChatEvent: () => () => {},
    interviewCancel: vi.fn(async () => {}),
    interviewAnswer: vi.fn(async () => ({
      ok: true,
      answerText: '合成回答',
      sources: [],
      usage: null,
    })),
  });
  useInterview.setState({ aiEnabled: true, modelId: 'test' });
  useInterview.getState().setAutoAnswer(true);
  emit(segment('ack', '好的', true));
  await vi.advanceTimersByTimeAsync(1000);
  emit(segment('question', '讲讲你的项目', true));
  await vi.advanceTimersByTimeAsync(2199);
  expect(desktop.interviewAnswer).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(desktop.interviewAnswer).toHaveBeenCalledOnce();
  expect(useInterview.getState().answers[0].question).toBe('好的 讲讲你的项目');
});
it('旧回答完成后正常提交排队致谢，后续纠正与追问仍正常提交', async () => {
  let finish!: (value: unknown) => void;
  const desktop = window.desktop!;
  Object.assign(desktop, {
    onChatEvent: () => () => {},
    interviewCancel: vi.fn(async () => {}),
    interviewAnswer: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ ok: true, answerText: '合成追问回答', sources: [], usage: null }),
  });
  useInterview.setState({ aiEnabled: true, modelId: 'test' });
  useInterview.getState().setAutoAnswer(true);
  const first = useInterview.getState().ask('之前的问题');
  emit(segment('queued-ack', '谢谢', true));
  await vi.advanceTimersByTimeAsync(2200);
  finish({ ok: true, answerText: '原问题回答', sources: [], usage: null });
  await first;
  await vi.advanceTimersByTimeAsync(1);
  expect(desktop.interviewAnswer).toHaveBeenCalledTimes(2);
  expect(useInterview.getState().answers.at(-1)?.question).toBe('谢谢');
  expect(useInterview.getState().draftQuestion).toBe('');
  emit(segment('correction', '不对，我刚才说的是 PostgreSQL，为什么不用 Redis', true));
  await vi.advanceTimersByTimeAsync(2200);
  expect(desktop.interviewAnswer).toHaveBeenCalledTimes(3);
  expect(useInterview.getState().answers.at(-1)?.question).toContain('我刚才说的是 PostgreSQL');
});
it('麦克风间断不阻断系统提问；旧回答忙时保留草稿，完成后自动提交已静音的新问题', async () => {
  let finish!: (value: unknown) => void;
  const desktop = window.desktop!;
  Object.assign(desktop, {
    onChatEvent: () => () => {},
    interviewCancel: vi.fn(async () => {}),
    interviewAnswer: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ ok: true, answerText: '新的回答', sources: [], usage: null }),
  });
  useInterview.setState({ aiEnabled: true, modelId: 'test' });
  useInterview.getState().setAutoAnswer(true);
  const first = useInterview.getState().ask('之前的问题');
  await vi.advanceTimersByTimeAsync(1);
  emit({ type: 'gap', source: 'microphone', message: '麦克风短暂间断' });
  emit(segment('recovered-interim', '恢复后新问题', false));
  expect(useInterview.getState().draftQuestion).toBe('恢复后新问题');
  emit(segment('recovered-interim', '恢复后的完整新问题', true));
  await vi.advanceTimersByTimeAsync(3000);
  expect(desktop.interviewAnswer).toHaveBeenCalledTimes(1);
  expect(useInterview.getState().draftQuestion).toBe('恢复后的完整新问题');
  finish({ ok: true, answerText: '旧回答完成', sources: [], usage: null });
  await first;
  await vi.advanceTimersByTimeAsync(1);
  expect(desktop.interviewAnswer).toHaveBeenCalledTimes(2);
  expect(useInterview.getState().answers.at(-1)?.question).toBe('恢复后的完整新问题');
  expect(useInterview.getState().draftQuestion).toBe('');
});
it('停止AI回答不停止转写，迟到结果丢弃，重试保留问题关联', async () => {
  let resolve!: (value: unknown) => void;
  let chatEvent!: (event: ChatEvent) => void;
  let requestId = '';
  const desktop = window.desktop!;
  Object.assign(desktop, {
    onChatEvent: (callback: typeof chatEvent) => {
      chatEvent = callback;
      return () => {};
    },
    interviewCancel: vi.fn(async () => {}),
    interviewAnswer: vi.fn(async (request: { id: string }) => {
      requestId = request.id;
      return await new Promise((r) => {
        resolve = r;
      });
    }),
  });
  useInterview.setState({ aiEnabled: true, modelId: 'test' });
  const pending = useInterview.getState().ask('待取消的问题', ['source-id']);
  await vi.advanceTimersByTimeAsync(1);
  chatEvent({ id: requestId, type: 'delta', text: '保留的部分' });
  const id = useInterview.getState().answers.at(-1)!.id;
  useInterview.getState().stopAnswer();
  expect(useInterview.getState().status).toBe('running');
  expect(desktop.interviewCancel).toHaveBeenCalledWith(requestId);
  chatEvent({ id: requestId, type: 'delta', text: '迟到内容' });
  resolve({ ok: true, answerText: '迟到终稿', usage: null, sources: [] });
  await pending;
  expect(useInterview.getState().answers.at(-1)?.content).toBe('保留的部分');
  expect(useInterview.getState().answers.at(-1)?.status).toBe('stopped');
  desktop.interviewAnswer = vi.fn(async () => ({
    ok: true as const,
    answerText: '重试完成',
    usage: null,
    sources: [],
  }));
  await useInterview.getState().retryAnswer(id);
  expect(useInterview.getState().answers.at(-1)).toMatchObject({
    question: '待取消的问题',
    content: '重试完成',
    sourceTranscriptIds: ['source-id'],
    status: 'completed',
  });
});
it('间断前的半句不自动回答，恢复后的新问题仍能提交，面试者发言继续只记录', async () => {
  useInterview.getState().setAutoAnswer(true);
  emit(segment('half', '中断前的半句', false));
  emit({ type: 'gap', source: 'system', message: '转写已继续，片段可能不完整' });
  emit({
    type: 'segment',
    segment: { ...segment('half', '中断前的半句', true).segment, reason: 'discontinuity' },
  });
  await vi.advanceTimersByTimeAsync(4000);
  expect(useInterview.getState().answers).toHaveLength(0);
  expect(useInterview.getState().draftQuestion).toBe('');
  expect(useInterview.getState().speechWarnings.system).toContain('转写已继续');
  emit(segment('recovered', '恢复后的完整问题', true));
  expect(useInterview.getState().speechWarnings.system).toBeUndefined();
  await vi.advanceTimersByTimeAsync(12000);
  expect(useInterview.getState().answers.at(-1)?.question).toBe('恢复后的完整问题');
});
it('各音源恢复只清除自身间断提示，静音活动也能恢复，语音错误不覆盖回答错误', async () => {
  await Promise.resolve();
  emit({ type: 'gap', source: 'system', message: '系统间断' });
  emit({ type: 'gap', source: 'microphone', message: '麦克风间断' });
  emit({ type: 'activity', source: 'microphone', speaking: false, level: 0 });
  expect(useInterview.getState().speechWarnings).toEqual({ system: '系统间断' });
  emit({ type: 'activity', source: 'system', speaking: false, level: 0 });
  expect(useInterview.getState().speechWarnings).toEqual({});
  useInterview.setState({ error: '回答服务失败' });
  emit({ type: 'status', status: { state: 'error', model: 'test', error: '系统转写失败' } });
  expect(useInterview.getState().speechError).toBe('系统转写失败');
  emit({ type: 'status', status: { state: 'running', model: 'test' } });
  expect(useInterview.getState().speechError).toBeNull();
  expect(useInterview.getState().error).toBe('回答服务失败');
});
it('中断后的迟到活动不恢复输入或清除故障提示，恢复时不复用旧电平', async () => {
  await Promise.resolve();
  emit({ type: 'activity', source: 'system', speaking: true, level: 0.2 });
  expect(useInterview.getState().audioLevels.system?.inputAt).toBe(Date.now());
  emit({ type: 'gap', source: 'system', message: '系统采集断开' });
  emit({
    type: 'status',
    status: { state: 'error', model: 'test', error: '系统采集断开', failureSource: 'system' },
  });
  emit({ type: 'activity', source: 'system', speaking: true, level: 0.2 });
  expect(useInterview.getState().audioLevels).toEqual({});
  expect(useInterview.getState().speechWarnings.system).toBe('系统采集断开');
  emit({ type: 'status', status: { state: 'running', model: 'test' } });
  expect(useInterview.getState().audioLevels).toEqual({});
});
it('临时结果原位替换，终稿冻结且去重，手动整理后消费一次', async () => {
  emit(segment('s', '请', false));
  emit(segment('s', '请介绍项目', false));
  expect(useInterview.getState().transcripts).toHaveLength(1);
  expect(useInterview.getState().answers).toHaveLength(0);
  emit(segment('s', '请介绍项目', true));
  emit(segment('s', '迟到旧字', false));
  emit(segment('s', '重复终稿', true));
  expect(useInterview.getState().transcripts[0].text).toBe('请介绍项目');
  const answer = useInterview.getState().submitTranscript('请介绍机器人项目');
  await vi.advanceTimersByTimeAsync(12000);
  await answer;
  expect(useInterview.getState().answers[0].question).toBe('请介绍机器人项目');
  await useInterview.getState().submitTranscript();
  expect(useInterview.getState().answers).toHaveLength(1);
});
it('短停顿后新文本阻止提前提交，暂停后不会自动触发AI', async () => {
  useInterview.getState().setAutoAnswer(true);
  emit(segment('one', '前半句', true));
  await vi.advanceTimersByTimeAsync(1000);
  emit(segment('two', '后半句', false));
  await vi.advanceTimersByTimeAsync(2000);
  expect(useInterview.getState().answers).toHaveLength(0);
  emit(segment('two', '后半句', true));
  useInterview.getState().pause();
  await vi.advanceTimersByTimeAsync(4000);
  expect(useInterview.getState().answers).toHaveLength(0);
  expect(useInterview.getState().pendingQuestion).toBe('前半句 后半句');
});
it('初始化后开始一次，设备与回答设置锁定但自动回答可切换', async () => {
  useInterview.getState().reset();
  const desktop = window.desktop!;
  vi.mocked(desktop.speech).mockClear();
  const configuration = defaultInterviewConfiguration();
  useInterview.getState().initialize(configuration);
  useInterview.getState().initialize({ ...configuration, mode: 'mock' });
  useInterview.getState().start();
  expect(vi.mocked(desktop.speech).mock.calls.filter(([c]) => c.op === 'start')).toHaveLength(1);
  configuration.options.sources = ['system'];
  expect(useInterview.getState().options.sources).toEqual(['microphone', 'system']);
  await Promise.resolve();
  emit({ type: 'status', status: { state: 'running', model: 'test' } });
  useInterview.getState().pause();
  useInterview.getState().configure({
    mode: 'mock',
    aiEnabled: true,
    modelId: 'different',
    effort: 'high',
    options: { sources: ['system'] },
  });
  useInterview.getState().setAutoAnswer(true);
  expect(useInterview.getState()).toMatchObject({
    mode: 'local',
    aiEnabled: false,
    effort: 'auto',
    autoAnswer: true,
    options: { sources: ['microphone', 'system'] },
  });
  useInterview.getState().reset();
});
it('麦克风只记录面试者发言，不能成为问题或触发自动回答', async () => {
  useInterview.getState().setAutoAnswer(true);
  const microphone = segment('mic', '我的回答', true);
  emit({ ...microphone, segment: { ...microphone.segment, source: 'microphone' } });
  await vi.advanceTimersByTimeAsync(4000);
  expect(useInterview.getState().transcripts[0].source).toBe('microphone');
  expect(useInterview.getState().pendingQuestion).toBe('');
  expect(useInterview.getState().answers).toHaveLength(0);
  emit(segment('system', '面试官的问题', true));
  await vi.advanceTimersByTimeAsync(12000);
  expect(useInterview.getState().answers[0].question).toBe('面试官的问题');
});
it('面试回答使用确认的思考强度并传过前端服务适配', async () => {
  useInterview.getState().reset();
  window.desktop!.onChatEvent = vi.fn(() => () => {});
  window.desktop!.interviewAnswer = vi.fn(async () => ({
    ok: true,
    answerText: 'Answer',
    reasoningSummary: '公开摘要',
    usage: null,
    sources: [],
  }));
  useInterview.getState().initialize({
    ...defaultInterviewConfiguration(),
    aiEnabled: true,
    modelId: 'test',
    effort: 'high',
  });
  await useInterview.getState().ask('Explain scheduling');
  expect(window.desktop!.interviewAnswer).toHaveBeenCalledWith(
    expect.objectContaining({ modelId: 'test', effort: 'high' }),
  );
  expect(useInterview.getState().answers[0].content).toBe('Answer');
  expect(useInterview.getState().answers[0].reasoningSummary).toBe('公开摘要');
});
it('临时面试官文字可立即提交，迟到终稿不会重复进入下一题', async () => {
  emit(segment('early', '未等静音的问题', false));
  expect(useInterview.getState().draftQuestion).toBe('未等静音的问题');
  expect(useInterview.getState().pendingQuestion).toBe('');
  const sending = useInterview.getState().submitTranscript();
  await vi.advanceTimersByTimeAsync(12000);
  await sending;
  expect(useInterview.getState().answers[0].question).toBe('未等静音的问题');
  emit(segment('early', '迟到完整终稿', true));
  expect(useInterview.getState().draftQuestion).toBe('');
  emit(segment('next', '新的问题', false));
  expect(useInterview.getState().draftQuestion).toBe('新的问题');
});
it('面试中关闭自动回答取消已排队问题，仍保留草稿用于手动发送', async () => {
  useInterview.setState({ configurationLocked: true });
  useInterview.getState().setAutoAnswer(true);
  emit(segment('toggle', '待提交的问题', true));
  useInterview.getState().setAutoAnswer(false);
  await vi.advanceTimersByTimeAsync(4000);
  expect(useInterview.getState().answers).toHaveLength(0);
  expect(useInterview.getState().draftQuestion).toBe('待提交的问题');
});
it('结束等待较慢句末识别时只保存尾段，不重新触发自动回答', async () => {
  let finish!: () => void;
  vi.mocked(window.desktop!.speech).mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        finish = () => resolve({ state: 'idle', model: 'test' });
      }),
  );
  useInterview.getState().setAutoAnswer(true);
  const ending = useInterview.getState().end();
  emit(segment('tail', '句末识别迟到尾段', true));
  await vi.advanceTimersByTimeAsync(5000);
  expect(useInterview.getState().answers).toHaveLength(0);
  expect(useInterview.getState().transcripts.at(-1)?.text).toBe('句末识别迟到尾段');
  finish();
  await ending;
  expect(useInterview.getState().status).toBe('ended');
});

it('切换模型期间保留到期问题，后台成功后用新设置提交；结束后的迟到更新不回写', async () => {
  const ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
  let finish!: (value: unknown) => void;
  Object.assign(window.desktop!, {
    updateInterviewModel: vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  });
  useInterview.getState().setAutoAnswer(true);
  const changing = useInterview.getState().updateModel('next', 'low');
  emit(segment('model-change', '如何设计接口', true));
  await vi.advanceTimersByTimeAsync(2200);
  expect(ask).not.toHaveBeenCalled();
  finish({ ok: true, modelId: 'next', effort: 'low' });
  expect(await changing).toBe(true);
  expect(useInterview.getState()).toMatchObject({
    modelId: 'next',
    effort: 'low',
    updatingModel: false,
  });
  expect(ask).toHaveBeenCalledWith('如何设计接口', ['model-change'], []);
  const late = useInterview.getState().updateModel('late', 'high');
  useInterview.getState().reset();
  finish({ ok: true, modelId: 'late', effort: 'high' });
  expect(await late).toBe(false);
  expect(useInterview.getState().modelId).toBe('next');
  expect(useInterview.getState().updatingModel).toBe(false);
  ask.mockRestore();
});

it('回答过程中设置下一题模型和强度，不取消当前回答，到期的后续问题使用新设置', async () => {
  let finish!: (value: unknown) => void;
  let onChat!: (event: ChatEvent) => void;
  const answer = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ ok: true, answerText: 'next answer', provider: 'chatgpt' });
  const cancel = vi.fn(async () => {});
  Object.assign(window.desktop!, {
    onChatEvent: (listener: (event: ChatEvent) => void) => {
      onChat = listener;
      return () => {};
    },
    interviewAnswer: answer,
    interviewCancel: cancel,
    updateInterviewModel: vi.fn(async () => ({ ok: true, modelId: 'next', effort: 'high' })),
  });
  useInterview.setState({ aiEnabled: true, modelId: 'old', effort: 'low' });
  useInterview.getState().setAutoAnswer(true);
  const current = useInterview.getState().ask('当前问题');
  expect(answer.mock.calls[0][0]).toMatchObject({ modelId: 'old', effort: 'low' });
  expect(await useInterview.getState().updateModel('next', 'high')).toBe(true);
  expect(useInterview.getState().generating).toBe(true);
  expect(cancel).not.toHaveBeenCalled();
  onChat({ id: answer.mock.calls[0][0].id, type: 'delta', text: 'old stream continues' });
  expect(useInterview.getState().answers[0].content).toBe('old stream continues');
  emit(segment('next-question', '后续问题', true));
  await vi.advanceTimersByTimeAsync(2200);
  expect(answer).toHaveBeenCalledTimes(1);
  finish({ ok: true, answerText: 'old answer', provider: 'chatgpt' });
  await current;
  await vi.advanceTimersByTimeAsync(0);
  expect(answer).toHaveBeenCalledTimes(2);
  expect(answer.mock.calls[1][0]).toMatchObject({
    question: '后续问题',
    modelId: 'next',
    effort: 'high',
  });
  expect(useInterview.getState().answers[0].content).toBe('old answer');
  expect(cancel).not.toHaveBeenCalled();
});
