import { describe, expect, it } from 'vitest';
import { createHistoryService, type InterviewRecord } from './history';
const record = (id: string, startedAt = 100): InterviewRecord => ({
  id,
  title: '练习',
  startedAt,
  endedAt: 200,
  status: 'ended',
  transcripts: [],
  answers: [],
  mock: true,
});
describe('本地历史记录', () => {
  it('按时间排序、更新同场记录不重复，并可跨实例读取和删除', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const service = createHistoryService(storage);
    service.save(record('first'));
    service.save(record('second', 150));
    service.save({ ...record('first'), title: '更新后的练习' });
    expect(
      createHistoryService(storage)
        .list()
        .map((r) => r.id),
    ).toEqual(['second', 'first']);
    expect(service.list()[1].title).toBe('更新后的练习');
    service.remove('second');
    expect(service.list()).toHaveLength(1);
  });
  it('损坏的数据不会被静默覆盖', () => {
    let saved = false;
    const service = createHistoryService({
      getItem: () => 'invalid json',
      setItem: () => {
        saved = true;
      },
    });
    expect(() => service.save(record('new'))).toThrow();
    expect(saved).toBe(false);
  });
  it('存储空间不足时报告失败', () => {
    const service = createHistoryService({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => service.save(record('new'))).toThrow('quota');
  });
});
