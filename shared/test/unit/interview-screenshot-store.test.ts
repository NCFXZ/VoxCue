import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useInterview } from '../../../shared/src/stores/interview';
import type { SpeechEvent } from '../../../shared/electron/contracts/speech';
import type { ChatEvent } from '../../../shared/electron/contracts/chat';
let emit: (event: SpeechEvent) => void;
let emitChat: (event: ChatEvent) => void;
const answer = vi.fn();
const screenshot = vi.fn();
let captureCount = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  captureCount = 0;
  screenshot.mockReset().mockImplementation(async (call) =>
    call.op === 'capture'
      ? {
          ok: true,
          screenshot: { id: 'shot-' + ++captureCount, preview: 'data:image/jpeg;base64,fixture' },
        }
      : { ok: true },
  );
  answer.mockReset().mockResolvedValue({ ok: true, answerText: '回答', usage: null, sources: [] });
  vi.stubGlobal('window', {
    desktop: {
      speech: vi.fn(async () => ({ state: 'running', model: 'test' })),
      onSpeechEvent: (callback: typeof emit) => {
        emit = callback;
        return () => {};
      },
      onChatEvent: (callback: typeof emitChat) => {
        emitChat = callback;
        return () => {};
      },
      interviewAnswer: answer,
      interviewScreenshot: screenshot,
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
it('截取只暂存、不消耗草稿或发送请求，手动发送包含原图片引用', async () => {
  useInterview.setState({ draftQuestion: '未发送转写' });
  await useInterview.getState().captureScreenshot();
  expect(answer).not.toHaveBeenCalled();
  expect(useInterview.getState().draftQuestion).toBe('未发送转写');
  expect(useInterview.getState().screenshots).toHaveLength(1);
  await useInterview.getState().submitTranscript('', true);
  expect(answer.mock.calls[0][0]).toMatchObject({ screenshotIds: ['shot-1'] });
  expect(answer.mock.calls[0][0]).not.toHaveProperty('question');
  expect(useInterview.getState().screenshots).toHaveLength(0);
  expect(useInterview.getState().draftQuestion).toBe('未发送转写');
  expect(useInterview.getState().answers[0].screenshot).toBe('only');
});
it('限制五张，移除后可继续截取；手动问题带全部图像引用', async () => {
  for (let i = 0; i < 6; i++) await useInterview.getState().captureScreenshot();
  expect(useInterview.getState().screenshots).toHaveLength(5);
  expect(captureCount).toBe(5);
  await useInterview.getState().removeScreenshot('shot-2');
  await useInterview.getState().captureScreenshot();
  await useInterview.getState().submitTranscript('解释这些图', true);
  expect(answer.mock.calls[0][0]).toMatchObject({
    question: '解释这些图',
    screenshotIds: ['shot-1', 'shot-3', 'shot-4', 'shot-5', 'shot-6'],
  });
  expect(useInterview.getState().screenshots).toHaveLength(0);
});
it('自动问题只发文字，不带走待发送截图，也不再次捕获', async () => {
  await useInterview.getState().captureScreenshot();
  useInterview.getState().setAutoAnswer(true);
  emit({
    type: 'segment',
    segment: {
      id: 'automatic',
      source: 'system',
      text: '自动问题',
      final: true,
      startMs: 1,
      endMs: Date.now(),
      silenceStartMs: Date.now() - 800,
      reason: 'silence',
    },
  });
  await vi.advanceTimersByTimeAsync(1000);
  emit({
    type: 'audio-progress',
    source: 'system',
    pending: false,
    processedThroughMs: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(answer.mock.calls[0][0]).toMatchObject({ question: '自动问题' });
  expect(answer.mock.calls[0][0]).not.toHaveProperty('screenshotIds');
  expect(useInterview.getState().screenshots).toHaveLength(1);
  expect(captureCount).toBe(1);
});
it('失败重试使用相同截图而不重新采集，移除后明确拒绝重试', async () => {
  await useInterview.getState().captureScreenshot();
  answer.mockResolvedValueOnce({ ok: false, error: { message: '模型失败' } });
  await useInterview.getState().submitTranscript('带图问题', true);
  const failed = useInterview.getState().answers.at(-1)!;
  expect(useInterview.getState().screenshots).toHaveLength(1);
  await useInterview.getState().retryAnswer(failed.id);
  expect(answer.mock.calls[1][0]).toMatchObject({
    question: '带图问题',
    screenshotIds: ['shot-1'],
  });
  expect(captureCount).toBe(1);
  expect(useInterview.getState().screenshots).toHaveLength(0);
  await useInterview.getState().retryAnswer(failed.id);
  expect(answer).toHaveBeenCalledTimes(2);
  expect(useInterview.getState().error).toContain('原截图已移除');
});
it('捕获串行，结束或重置丢弃迟到图像；截图不进入归档', async () => {
  let finish!: (value: unknown) => void;
  screenshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = useInterview.getState().captureScreenshot();
  await useInterview.getState().captureScreenshot();
  expect(useInterview.getState().capturingScreenshot).toBe(true);
  useInterview.getState().reset();
  finish({ ok: true, screenshot: { id: 'late', preview: 'data:image/png;base64,fixture' } });
  await pending;
  expect(useInterview.getState().screenshots).toHaveLength(0);
  expect(useInterview.getState().capturingScreenshot).toBe(false);
  expect(answer).not.toHaveBeenCalled();
});

it('停止保留待发送截图，重试仍使用原引用且不会重复捕获', async () => {
  await useInterview.getState().captureScreenshot();
  let finish!: (value: unknown) => void;
  answer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = useInterview.getState().submitTranscript('带图问题', true);
  useInterview.getState().stopAnswer();
  const stopped = useInterview.getState().answers.at(-1)!;
  finish({ ok: true, answerText: '迟到回答', usage: null, sources: [] });
  await pending;
  expect(useInterview.getState().screenshots).toHaveLength(1);
  expect(useInterview.getState().answers.at(-1)?.status).toBe('stopped');
  await useInterview.getState().retryAnswer(stopped.id);
  expect(answer.mock.calls[1][0]).toMatchObject({ screenshotIds: ['shot-1'] });
  expect(captureCount).toBe(1);
});

it('自动重试保留已有正文到新输出到达，随后替换而不拼接；停止忽略重试和迟到输出', async () => {
  let finish!: (value: unknown) => void;
  answer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = useInterview.getState().submitTranscript('需要重试的问题');
  const requestId = answer.mock.calls[0][0].id;
  emitChat({ id: requestId, type: 'delta', text: '旧尝试正文' });
  emitChat({ id: requestId, type: 'reasoning-summary', text: '旧摘要' });
  emitChat({ id: requestId, type: 'interview-retry', attempt: 1, limit: 3 });
  expect(useInterview.getState().answers.at(-1)).toMatchObject({
    content: '旧尝试正文',
    retry: { attempt: 1, limit: 3 },
    reasoningSummary: undefined,
  });
  emitChat({ id: requestId, type: 'delta', text: '新尝试' });
  emitChat({ id: requestId, type: 'delta', text: '正文' });
  expect(useInterview.getState().answers.at(-1)?.content).toBe('新尝试正文');
  useInterview.getState().stopAnswer();
  emitChat({ id: requestId, type: 'interview-retry', attempt: 2, limit: 3 });
  emitChat({ id: requestId, type: 'delta', text: '停止后的迟到内容' });
  finish({ ok: false, error: { message: '已取消' } });
  await pending;
  expect(useInterview.getState().answers.at(-1)).toMatchObject({
    status: 'stopped',
    content: '新尝试正文',
    retry: { attempt: 1, limit: 3 },
  });
  expect(useInterview.getState().error).toBeNull();
  expect(useInterview.getState().generating).toBe(false);
  expect(answer).toHaveBeenCalledOnce();
});
