import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AutomaticQuestionGate, isAutomaticQuestionFiller } from '../../src/services/speech';
import { useInterview } from '../../src/stores/interview';
import type { SpeechEvent, SpeechSegment, SpeechModelId } from '../../electron/contracts/speech';

const final = (patch: Partial<SpeechSegment> = {}): SpeechSegment => ({
  id: 'question',
  source: 'system',
  text: '请介绍项目',
  final: true,
  startMs: 0,
  endMs: 800,
  silenceStartMs: 0,
  reason: 'silence',
  ...patch,
});
const progress = (
  processedThroughMs: number,
  pending = false,
): SpeechEvent & { type: 'audio-progress' } => ({
  type: 'audio-progress',
  source: 'system',
  pending,
  processedThroughMs,
});

it.each([
  '嗯',
  '呃',
  '额',
  '唔',
  '啊',
  '哦',
  '噢',
  '喔',
  '诶',
  '欸',
  '哎',
  '唉',
  '好',
  '好的',
  '对',
  '对的',
  '是的',
  '行',
  '明白',
  '了解',
  '嗯好的',
  '哦好的',
  '嗯嗯，呃呃，额……',
  '哦 噢 喔\n诶欸哎唉',
  '好好的对对的是的行明白了解',
  '嗯？',
  '啊？',
  '好的？',
])('纯白名单回应仅从自动回答中排除：%s', (text) => {
  expect(isAutomaticQuestionFiller(text)).toBe(true);
});
it.each([
  '',
  '那个',
  '这个',
  '就是',
  '然后',
  '怎么说呢',
  '然后呢？',
  '为什么呢？',
  '行吗？',
  '好在哪里',
  '嗯，为什么用SQLite',
  '哦，我说的是异步',
  '好的，继续',
  '了解需求后怎么实现',
  '明白了吗',
  '谢谢',
  '谢谢您',
  'OK',
  'why',
  '的',
  '白明',
])('未知词、口头衔接和实际内容保守保留：%s', (text) => {
  expect(isAutomaticQuestionFiller(text)).toBe(false);
});

it('800ms分段计入1800ms，音频进度不足时不因墙钟等待而就绪', () => {
  const gate = new AutomaticQuestionGate();
  gate.final(final());
  gate.progress(progress(800));
  expect(gate.ready()).toBe(false);
  gate.progress(progress(1799));
  expect(gate.ready()).toBe(false);
  gate.progress(progress(1800));
  expect(gate.ready()).toBe(true);
});
it('终稿迟到仍沿用原始静音起点，不追加1000ms', () => {
  const gate = new AutomaticQuestionGate();
  gate.progress(progress(2100));
  gate.final(final());
  expect(gate.ready()).toBe(true);
});
it('后续系统音频未处理时阻止旧终稿，麦克风进度不能解除保护', () => {
  const gate = new AutomaticQuestionGate();
  gate.final(final());
  gate.progress(progress(2100, true));
  gate.progress({ ...progress(9000), source: 'microphone' });
  expect(gate.ready()).toBe(false);
  gate.progress(progress(2100));
  expect(gate.ready()).toBe(true);
  gate.cancel();
  gate.progress(progress(5000));
  expect(gate.ready()).toBe(false);
});
it.each(['sentence', 'limit', 'pause', 'stop', 'discontinuity'] as const)(
  '%s终稿不能启动自动回答',
  (reason) => {
    const gate = new AutomaticQuestionGate();
    gate.progress(progress(10000));
    gate.final(final({ reason }));
    expect(gate.ready()).toBe(false);
  },
);
it.each([undefined, NaN, Infinity, 801])('缺失或非法静音起点 %s 不自动发送', (silenceStartMs) => {
  const gate = new AutomaticQuestionGate();
  gate.progress(progress(10000));
  gate.final(final({ silenceStartMs }));
  expect(gate.ready()).toBe(false);
});
it('重置不复用上一场的处理进度，麦克风终稿不能提供自动回答截止点', () => {
  const gate = new AutomaticQuestionGate();
  gate.progress(progress(10000));
  gate.reset();
  gate.final(final());
  expect(gate.ready()).toBe(false);
  gate.progress(progress(10000));
  gate.final(final({ source: 'microphone' }));
  expect(gate.ready()).toBe(false);
});

let receive: (event: SpeechEvent) => void;
let ask: ReturnType<typeof vi.spyOn>;
const realAsk = useInterview.getState().ask;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('window', {
    desktop: {
      speech: vi.fn(async () => ({ state: 'running', model: 'synthetic' })),
      onSpeechEvent: (callback: typeof receive) => {
        receive = callback;
        return () => {
          receive = () => {};
        };
      },
    },
  });
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  useInterview
    .getState()
    .configure({ mode: 'local', aiEnabled: false, options: { sources: ['microphone', 'system'] } });
  useInterview.getState().setAutoAnswer(true);
  useInterview.getState().start();
  await vi.advanceTimersByTimeAsync(0);
  receive({ type: 'status', status: { state: 'running', model: 'synthetic' } });
  ask = vi.spyOn(useInterview.getState(), 'ask').mockResolvedValue();
});
afterEach(() => {
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  vi.restoreAllMocks();
  // Zustand copies actions into new state objects; restore the current copy too.
  useInterview.setState({ ask: realAsk });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['paraformer', 'qwen'] as SpeechModelId[])(
  '%s共用1800ms截止点，终稿1.2秒就绪时只剩600ms',
  async (speechModel) => {
    useInterview.setState({ options: { sources: ['system'], speechModel } });
    receive({ type: 'segment', segment: final({ speechModel }) });
    receive(progress(1200));
    await vi.advanceTimersByTimeAsync(5000); // A stalled capture cannot prove continuing silence.
    expect(ask).not.toHaveBeenCalled();
    receive(progress(1799));
    expect(ask).not.toHaveBeenCalled();
    receive(progress(1800));
    expect(ask).toHaveBeenCalledWith('请介绍项目', ['question'], []);
    receive({ type: 'segment', segment: final({ speechModel }) });
    receive(progress(9000));
    expect(ask).toHaveBeenCalledTimes(1);
  },
);
it('积压中的迟到终稿等后续音频检查完毕才立即提交，不再另等1000ms', () => {
  receive(progress(2100, true));
  receive({ type: 'segment', segment: final() });
  expect(ask).not.toHaveBeenCalled();
  receive(progress(2100));
  expect(ask).toHaveBeenCalledTimes(1);
});
it('迟到有效终稿使用最终缓冲，不能被旧语气词临时稿误过滤', () => {
  receive({ type: 'segment', segment: final({ final: false, text: '嗯' }) });
  receive(progress(10000));
  receive({ type: 'segment', segment: final({ text: '请解释并发控制' }) });
  expect(ask).toHaveBeenCalledOnce();
  expect(ask).toHaveBeenCalledWith('请解释并发控制', ['question'], []);
});
it('排队音频内重新开口取消旧截止点，并从新一轮静音重新计算', () => {
  receive({ type: 'segment', segment: final() });
  receive(progress(1800, true));
  receive({ type: 'speech-start', source: 'system' });
  receive(progress(2200));
  expect(ask).not.toHaveBeenCalled();
  receive({
    type: 'segment',
    segment: final({ id: 'continued', text: '以及技术取舍', silenceStartMs: 2200, endMs: 3000 }),
  });
  receive(progress(3999));
  expect(ask).not.toHaveBeenCalled();
  receive(progress(4000));
  expect(ask).toHaveBeenCalledWith('请介绍项目 以及技术取舍', ['question', 'continued'], []);
});
it('麦克风重新开口不取消系统问题，自动回答关闭和暂停仍阻止提交', () => {
  receive({ type: 'segment', segment: final() });
  receive({ type: 'speech-start', source: 'microphone' });
  receive(progress(1800));
  expect(ask).toHaveBeenCalledTimes(1);
  receive({ type: 'segment', segment: final({ id: 'next', silenceStartMs: 3000, endMs: 3800 }) });
  useInterview.getState().setAutoAnswer(false);
  receive(progress(5000));
  useInterview.getState().setAutoAnswer(true);
  receive(progress(6000));
  expect(ask).toHaveBeenCalledTimes(1);
  receive({ type: 'segment', segment: final({ id: 'paused', silenceStartMs: 7000, endMs: 7800 }) });
  useInterview.getState().pause();
  receive(progress(9000));
  expect(ask).toHaveBeenCalledTimes(1);
});
it('上一题回答期间保存就绪问题，后续系统音频积压时不提前消费', () => {
  useInterview.setState({ generating: true });
  receive({ type: 'segment', segment: final() });
  receive(progress(1800));
  expect(ask).not.toHaveBeenCalled();
  receive(progress(1800, true));
  useInterview.setState({ generating: false });
  receive({ ...progress(5000), source: 'microphone' });
  expect(ask).not.toHaveBeenCalled();
  receive(progress(2100));
  expect(ask).toHaveBeenCalledTimes(1);
});

it('上一题完成时仍有系统积压，排队问题等ACK后提交一次', async () => {
  ask.mockRestore();
  let finish!: (value: unknown) => void;
  const answer = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ ok: true, answerText: '下一题合成回答', sources: [], usage: null });
  Object.assign(window.desktop!, {
    onChatEvent: () => () => {},
    interviewCancel: vi.fn(async () => {}),
    interviewAnswer: answer,
  });
  useInterview.setState({ aiEnabled: true, modelId: 'synthetic' });
  const first = useInterview.getState().ask('上一题');
  receive({ type: 'segment', segment: final() });
  receive(progress(1800));
  receive(progress(1800, true));
  finish({ ok: true, answerText: '上一题合成回答', sources: [], usage: null });
  await first;
  await vi.advanceTimersByTimeAsync(0);
  expect(answer).toHaveBeenCalledTimes(1);
  receive(progress(2100));
  await vi.advanceTimersByTimeAsync(0);
  expect(answer).toHaveBeenCalledTimes(2);
  expect(answer.mock.calls[1][0]).toMatchObject({ question: '请介绍项目' });
  receive(progress(2500));
  expect(answer).toHaveBeenCalledTimes(2);
});
it('暂停期间迟到的silence终稿只保留文字，恢复状态不能重启旧截止点', () => {
  useInterview.getState().pause();
  receive({ type: 'segment', segment: final() });
  receive(progress(5000));
  receive({ type: 'status', status: { state: 'running', model: 'synthetic' } });
  receive(progress(6000));
  expect(ask).not.toHaveBeenCalled();
  expect(useInterview.getState().transcripts[0].text).toBe('请介绍项目');
});
