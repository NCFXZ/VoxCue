import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterviewRecord } from '../src/services/history';
import { createHistoryService } from '../src/services/history';
import {
  sourceIds,
  titleQuestions,
  exportRecord,
  relativeTime,
} from '../src/services/historyPresentation';
import { useHistory } from '../src/stores/history';
const record = (): InterviewRecord => ({
  id: 'history-r',
  title: '面试记录',
  startedAt: 1000,
  endedAt: 121000,
  status: 'ended',
  mock: false,
  transcripts: [
    { id: 's1', source: 'system', text: '介绍项目', time: '00:00', startMs: 62000, final: true },
    { id: 'm1', source: 'microphone', text: '私人回答', time: '00:00', final: true },
  ],
  answers: [{ id: 'a1', provider: 'chatgpt', question: '介绍项目', content: '**项目回答**' }],
});
let values: Map<string, string>;
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { desktop: { generateInterviewTitle: vi.fn(async () => {}) } });
  useHistory.setState({ records: [], error: null });
});
describe('历史时间线、关联与持久化', () => {
  it('准确关联系统片段，歧义旧记录和麦克风不产生假定位', () => {
    const r = record(),
      a = r.answers[0];
    expect(sourceIds(r, a)).toEqual(['s1']);
    r.transcripts.push({ ...r.transcripts[0], id: 'duplicate' });
    expect(sourceIds(r, a)).toEqual([]);
    expect(sourceIds(r, { ...a, sourceTranscriptIds: ['s1', 'm1', 'deleted'] })).toEqual(['s1']);
    r.transcripts = [
      { ...r.transcripts[0], text: '介绍' },
      { ...r.transcripts[0], id: 's2', text: '项目' },
    ];
    expect(sourceIds(r, a)).toEqual(['s1', 's2']);
    expect(sourceIds(r, { ...a, question: '差不多的项目' })).toEqual([]);
  });
  it('时间、导出中文、Markdown原文、空回答保留；Mock回答不展示', () => {
    const r = record();
    r.answers.push(
      { id: 'empty', question: '空问题', content: '' },
      { id: 'mock', provider: 'mock', question: 'mock sentinel', content: 'hidden' },
    );
    expect(relativeTime(r, r.transcripts[0])).toBe('1:01');
    const text = exportRecord(r);
    expect(text).toContain('[1:01] 面试官\r\n介绍项目');
    expect(text).toContain('我\r\n私人回答');
    expect(text).toContain('**项目回答**');
    expect(text).toContain('这条回答没有保存内容');
    expect(text).not.toContain('mock sentinel');
  });
  it('标题均匀取样限定24个问题，不传麦克风内容和AI正文', () => {
    const r = record();
    r.transcripts.push(
      ...Array.from({ length: 100 }, (_, i) => ({
        id: 's' + i,
        source: 'system' as const,
        text: '系统问题' + i,
        time: '',
        final: true,
      })),
    );
    const questions = titleQuestions(r);
    expect(questions).toHaveLength(24);
    expect(questions).toContain('系统问题99');
    expect(questions.join()).not.toContain('私人回答');
    expect(questions.join()).not.toContain('项目回答');
  });
  it('归档晚写保留生成的标题、失败状态不覆盖已完成标题', () => {
    const service = createHistoryService(storage);
    service.save({ ...record(), title: 'AI标题', titleStatus: 'ready' });
    service.save(record());
    service.save({ ...record(), titleStatus: 'failed' });
    expect(service.list()[0]).toMatchObject({ title: 'AI标题', titleStatus: 'ready' });
  });
  it('标题任务失败可重试，删除后迟到事件不复活记录', async () => {
    useHistory.getState().save(record());
    await useHistory.getState().generateTitle('history-r', 'model');
    expect(useHistory.getState().records[0].titleStatus).toBe('pending');
    useHistory.getState().applyTitle({ recordId: 'history-r', error: '失败' });
    expect(useHistory.getState().records[0].titleStatus).toBe('failed');
    await useHistory.getState().generateTitle('history-r', 'model');
    useHistory.getState().remove('history-r');
    useHistory.getState().applyTitle({ recordId: 'history-r', title: '迟到标题' });
    expect(useHistory.getState().records).toEqual([]);
  });
  it('损坏数据不会在生成标题时被覆盖，也不会抛出未处理异常', async () => {
    values.set('copilot-interview-history-v1', 'broken');
    await useHistory.getState().generateTitle('broken', 'model');
    expect(useHistory.getState().error).toContain('原始数据已保留');
    expect(values.get('copilot-interview-history-v1')).toBe('broken');
  });
});
