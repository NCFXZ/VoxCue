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
  it('保留旧记录未知附加字段，更新标题不改写正文', () => {
    const legacy = {
      ...record('legacy'),
      mock: false,
      answers: [
        {
          id: 'a',
          question: '问题',
          content: '原有回答',
          provider: 'chatgpt',
          legacyMetadata: { sources: ['original'] },
        },
      ],
    };
    let raw = JSON.stringify([legacy]);
    const service = createHistoryService({
      getItem: () => raw,
      setItem: (_key, value) => {
        raw = value;
      },
    });
    service.save({ ...service.list()[0], title: '新标题' });
    expect(JSON.parse(raw)[0].answers).toEqual(legacy.answers);
  });
  it('旧Mock记录与真实来源记录共存，不把真实转写标成模拟', () => {
    let raw: string | null = null;
    const service = createHistoryService({
      getItem: () => raw,
      setItem: (_k, v) => {
        raw = v;
      },
    });
    service.save(record('old'));
    service.save({
      ...record('real'),
      mock: false,
      transcripts: [
        {
          id: 's',
          source: 'system',
          startMs: 1,
          endMs: 2,
          text: '真实终稿',
          final: true,
          time: '10:00',
        },
      ],
    });
    expect(
      service
        .list()
        .map((r) => r.mock)
        .sort(),
    ).toEqual([false, true]);
    expect(service.list().find((r) => !r.mock)?.transcripts[0].source).toBe('system');
  });
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
