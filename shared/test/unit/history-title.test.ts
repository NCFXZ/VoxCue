import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HistoryTitleJobs,
  validateGeneratedTitle,
  validateTitleRequest,
} from '../../../shared/electron/application/historyTitle';
import type { AIChatService } from '../../../shared/electron/backend/chat/ports';
import type { InterviewTitleEvent } from '../../../shared/electron/contracts/history';
const request = { recordId: 'record-1', modelId: 'model', questions: ['介绍你的机器人控制项目'] };
function setup() {
  const stream = vi.fn<AIChatService['stream']>(async () => ({
    answerText: '机器人控制与工业自动化岗位面试',
    usage: null,
    sources: [],
  }));
  const models = vi.fn(async () => [
    { id: 'model', label: 'Model', description: '', reasoningEfforts: ['low' as const] },
  ]);
  const emit = vi.fn<(e: InterviewTitleEvent) => void>();
  const jobs = new HistoryTitleJobs({ stream, models, usage: vi.fn(), resetUsage: vi.fn() }, emit);
  return { stream, models, emit, jobs };
}
describe('面试标题后台任务', () => {
  it('限制输入与输出，拒绝非字符串、稀疏数组、超限与多行标题', () => {
    for (const value of [
      null,
      {},
      { ...request, recordId: undefined },
      { ...request, questions: Array(2) },
      { ...request, questions: [] },
      { ...request, questions: ['x'.repeat(6001)] },
      { ...request, questions: Array(25).fill('q') },
      { ...request, questions: Array(4).fill('x'.repeat(5000)) },
    ])
      expect(() => validateTitleRequest(value)).toThrow();
    for (const title of ['', 'hello\nworld', 'x'.repeat(81), '<script>', 'title\u0000'])
      expect(() => validateGeneratedTitle(title)).toThrow();
    expect(validateGeneratedTitle(' “控制工程师岗位面试” ')).toBe('控制工程师岗位面试');
  });
  it('去重、后台串行生成，限定模型与问题输入，关闭请求者不参与任务生命周期', async () => {
    const { stream, emit, jobs } = setup();
    let finish!: () => void;
    stream.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          finish = () => resolve({ answerText: '机器人岗位面试', usage: null, sources: [] });
        }),
    );
    jobs.enqueue(request);
    jobs.enqueue(request);
    jobs.enqueue({ ...request, recordId: 'record-2' });
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    expect(emit).not.toHaveBeenCalled();
    const body = stream.mock.calls[0][0];
    expect(body).toMatchObject({
      modelId: 'model',
      webSearch: false,
      effort: 'low',
      turns: [{ role: 'user', content: JSON.stringify(request.questions) }],
    });
    expect(body).not.toHaveProperty('retrieval');
    expect(body).not.toHaveProperty('attachments');
    finish();
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(2));
    expect(emit.mock.calls[0][0]).toEqual({ recordId: 'record-1', title: '机器人岗位面试' });
  });
  it('未知模型不回退；失败可重试且不泄露错误细节', async () => {
    const { stream, emit, jobs } = setup();
    jobs.enqueue({ ...request, modelId: 'missing' });
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
    expect(stream).not.toHaveBeenCalled();
    stream.mockRejectedValueOnce(Error('private-token'));
    jobs.enqueue(request);
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(emit.mock.calls)).not.toContain('private-token');
    jobs.enqueue(request);
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(3));
    expect(emit.mock.calls[2][0].title).toBeTruthy();
  });
  it('退出取消运行及排队任务，迟到结果不能覆盖已停止状态', async () => {
    const { stream, emit, jobs } = setup();
    let finish!: () => void;
    stream.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          finish = () => resolve({ answerText: '迟到标题', usage: null, sources: [] });
        }),
    );
    jobs.enqueue(request);
    jobs.enqueue({ ...request, recordId: 'record-2' });
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    jobs.cancelAll();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.every(([e]) => e.error && !e.title)).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
