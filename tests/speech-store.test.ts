import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { useInterview } from '../src/stores/interview';
import type { SpeechEvent } from '../electron/contracts/speech';
import type { ChatEvent } from '../electron/contracts/chat';
import { defaultInterviewConfiguration } from '../src/services/speech';
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
  useInterview.getState().configure({ mode: 'local', aiEnabled: false });
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
