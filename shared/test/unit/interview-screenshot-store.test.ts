import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useInterview } from '../../../shared/src/stores/interview';
import type { SpeechEvent } from '../../../shared/electron/contracts/speech';
let emit: (event: SpeechEvent) => void;
const answer = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  answer.mockReset().mockResolvedValue({ ok: true, answerText: '回答', usage: null, sources: [] });
  vi.stubGlobal('window', {
    desktop: {
      speech: vi.fn(async () => ({ state: 'running', model: 'test' })),
      onSpeechEvent: (callback: typeof emit) => {
        emit = callback;
        return () => {};
      },
      onChatEvent: () => () => {},
      interviewAnswer: answer,
      interviewCancel: vi.fn(async () => {}),
    },
  });
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  useInterview.getState().configure({ mode: 'local', aiEnabled: true, modelId: 'test' });
  useInterview.getState().setAutoAnswer(false);
  useInterview.getState().start();
  emit({ type: 'status', status: { state: 'running', model: 'test' } });
});
afterEach(() => {
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('默认不截图，打开附截图后手动和自动问题都带捕获意图，关闭后恢复普通请求', async () => {
  expect(useInterview.getState().attachScreenshot).toBe(false);
  useInterview.getState().setAttachScreenshot(true);
  await useInterview.getState().submitTranscript('手动题目');
  expect(answer.mock.calls[0][0]).toMatchObject({ question: '手动题目', screenshot: 'attach' });
  useInterview.getState().setAutoAnswer(true);
  emit({
    type: 'segment',
    segment: {
      id: 'automatic',
      source: 'system',
      text: '自动问题',
      final: true,
      startMs: Date.now(),
      endMs: Date.now() + 10,
      reason: 'silence',
    },
  });
  await vi.advanceTimersByTimeAsync(2300);
  expect(answer.mock.calls[1][0]).toMatchObject({ question: '自动问题', screenshot: 'attach' });
  useInterview.getState().setAttachScreenshot(false);
  await useInterview.getState().submitTranscript('普通题目');
  expect(answer.mock.calls[2][0]).not.toHaveProperty('screenshot');
});
it('仅截图不带题目且不消耗转写草稿，生成中不能重复发送', async () => {
  emit({
    type: 'segment',
    segment: {
      id: 'draft',
      source: 'system',
      text: '未发送转写',
      final: false,
      startMs: 1,
      endMs: 2,
    },
  });
  let finish!: (value: unknown) => void;
  answer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = useInterview.getState().submitScreenshot();
  await useInterview.getState().submitScreenshot();
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0]).toMatchObject({ screenshot: 'only' });
  expect(answer.mock.calls[0][0]).not.toHaveProperty('question');
  expect(useInterview.getState().draftQuestion).toBe('未发送转写');
  finish({ ok: true, answerText: '截图回答', usage: null, sources: [] });
  await pending;
  expect(useInterview.getState().draftQuestion).toBe('未发送转写');
  expect(useInterview.getState().answers[0]).toMatchObject({
    question: '当前屏幕截图',
    screenshot: 'only',
  });
});
it('重试保留原截图模式，未连接服务不能以模拟答案替代截图请求', async () => {
  answer.mockResolvedValueOnce({ ok: false, error: { message: '截取失败' } });
  useInterview.getState().setAttachScreenshot(true);
  await useInterview.getState().ask('带图问题');
  const failed = useInterview.getState().answers.at(-1)!;
  useInterview.getState().setAttachScreenshot(false);
  await useInterview.getState().retryAnswer(failed.id);
  expect(answer.mock.calls[1][0]).toMatchObject({ question: '带图问题', screenshot: 'attach' });
  useInterview.setState({ aiEnabled: false });
  await useInterview.getState().submitScreenshot();
  expect(answer).toHaveBeenCalledTimes(2);
  expect(useInterview.getState().answers.at(-1)).toMatchObject({
    status: 'failed',
    error: '截图回答需要先连接模型服务。',
    content: '',
  });
});
