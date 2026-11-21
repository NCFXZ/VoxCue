import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInterview } from '../../../../shared/src/stores/interview';
import { useHistory } from '../../../../shared/src/stores/history';
describe('模拟面试生命周期', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    vi.useFakeTimers();
    useInterview.getState().reset();
    useInterview.getState().setAutoAnswer(true);
  });
  afterEach(() => {
    useInterview.getState().reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('逐字转写完成后自动生成流式回答', async () => {
    useInterview.getState().start();
    await vi.advanceTimersByTimeAsync(200);
    expect(useInterview.getState().transcripts[0].final).toBe(false);
    await vi.advanceTimersByTimeAsync(3500);
    expect(useInterview.getState().transcripts[0].final).toBe(true);
    expect(useInterview.getState().answers[0].content.length).toBeGreaterThan(0);
    expect(useInterview.getState().generating).toBe(true);
    await vi.advanceTimersByTimeAsync(8000);
    expect(useInterview.getState().generating).toBe(false);
  });
  it('暂停会取消转写和回答，结束后不会继续写入', async () => {
    useInterview.getState().start();
    await vi.advanceTimersByTimeAsync(3000);
    useInterview.getState().pause();
    const snapshot = JSON.stringify(useInterview.getState());
    await vi.advanceTimersByTimeAsync(30000);
    expect(JSON.stringify(useInterview.getState())).toBe(snapshot);
    expect(useInterview.getState().status).toBe('paused');
    useInterview.getState().start();
    await vi.advanceTimersByTimeAsync(200);
    useInterview.getState().end();
    const ended = JSON.stringify(useInterview.getState());
    await vi.advanceTimersByTimeAsync(30000);
    expect(JSON.stringify(useInterview.getState())).toBe(ended);
  });
  it('关闭自动回答时仅转写，仍允许手动发送问题', async () => {
    useInterview.getState().setAutoAnswer(false);
    useInterview.getState().start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(useInterview.getState().transcripts[0].final).toBe(true);
    expect(useInterview.getState().answers).toHaveLength(0);
    useInterview.getState().pause();
    const response = useInterview.getState().ask(useInterview.getState().transcripts[0].text);
    await vi.advanceTimersByTimeAsync(10000);
    await response;
    expect(useInterview.getState().answers[0].content.length).toBeGreaterThan(100);
  });
  it('新对话清空状态并中止未完成的回答', async () => {
    const result = useInterview.getState().ask('介绍自己');
    await vi.advanceTimersByTimeAsync(100);
    useInterview.getState().reset();
    await result;
    await vi.advanceTimersByTimeAsync(1000);
    expect(useInterview.getState().answers).toEqual([]);
    expect(useInterview.getState().status).toBe('idle');
    expect(useInterview.getState().generating).toBe(false);
  });
  it('新请求会取消旧流，空问题不创建回答', async () => {
    await useInterview.getState().ask('  ');
    expect(useInterview.getState().answers).toHaveLength(0);
    const first = useInterview.getState().ask('第一个问题');
    await vi.advanceTimersByTimeAsync(100);
    const firstText = useInterview.getState().answers[0].content;
    const second = useInterview.getState().ask('第二个问题');
    await vi.advanceTimersByTimeAsync(10000);
    await Promise.all([first, second]);
    expect(useInterview.getState().answers[0].content).toBe(firstText);
    expect(useInterview.getState().answers[1].content.length).toBeGreaterThan(100);
    expect(useInterview.getState().generating).toBe(false);
  });
  it('结束后保存完整快照，新对话不会更改结束时间或创建重复记录', async () => {
    useInterview.getState().start();
    await vi.advanceTimersByTimeAsync(10000);
    await useInterview.getState().end();
    const record = (await useHistory.getState().getRecord(useHistory.getState().records[0].id))!;
    expect(record.mock).toBe(true);
    expect(record.answers[0].content.length).toBeGreaterThan(100);
    await vi.advanceTimersByTimeAsync(5000);
    useInterview.getState().reset();
    expect(useHistory.getState().records).toHaveLength(1);
    expect(useHistory.getState().records[0].endedAt).toBe(record.endedAt);
  });
});
