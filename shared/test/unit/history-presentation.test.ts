import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterviewRecord } from '../../../shared/src/services/history';
import { createHistoryService } from '../../../shared/src/services/history';
import {
  sourceIds,
  titleQuestions,
  exportRecord,
  relativeTime,
} from '../../../shared/src/services/historyPresentation';
import { useHistory } from '../../../shared/src/stores/history';
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
  it('音频间断片段保留并在导出标记，但不参与标题生成', () => {
    const value = record();
    value.transcripts.push({
      id: 'gap',
      source: 'system',
      text: '中断半句',
      time: '',
      final: true,
      reason: 'discontinuity',
    });
    expect(titleQuestions(value)).not.toContain('中断半句');
    expect(exportRecord(value)).toContain('（音频间断，可能不完整）');
    expect(exportRecord(value)).toContain('中断半句');
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
  it('手动重命名持久保存且保留正文，迟到标题和旧归档不能覆盖；可再次重命名', async () => {
    const original = record();
    useHistory.getState().save(original);
    await useHistory.getState().generateTitle(original.id, 'model');
    expect(useHistory.getState().rename(original.id, '  技术交流  ')).toBe(true);
    useHistory.getState().applyTitle({ recordId: original.id, title: '迟到自动标题' });
    useHistory.getState().applyTitle({ recordId: original.id, error: '迟到失败' });
    useHistory.getState().save({ ...original, title: '旧归档标题', titleStatus: 'ready' });
    const saved = createHistoryService(storage).list()[0];
    expect(saved).toMatchObject({
      title: '技术交流',
      titleSource: 'manual',
      titleStatus: 'ready',
      transcripts: original.transcripts,
      answers: original.answers,
    });
    expect(useHistory.getState().rename(original.id, '再次修改')).toBe(true);
    useHistory.getState().load();
    expect(useHistory.getState().records[0].title).toBe('再次修改');
  });
  it('无效标题、存储失败和已删除记录不覆盖原件或复活记录', () => {
    useHistory.getState().save(record());
    const before = storage.getItem('copilot-interview-history-v1');
    for (const title of ['', '   ', 'x'.repeat(81), '第一行\n第二行'])
      expect(useHistory.getState().rename('history-r', title)).toBe(false);
    const fail = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
      throw Error('Storage quota');
    });
    expect(useHistory.getState().rename('history-r', '不会保存')).toBe(false);
    fail.mockRestore();
    expect(storage.getItem('copilot-interview-history-v1')).toBe(before);
    useHistory.getState().remove('history-r');
    expect(useHistory.getState().rename('history-r', '已删除')).toBe(false);
    expect(createHistoryService(storage).list()).toEqual([]);
  });
  it('损坏数据不会在生成标题时被覆盖，也不会抛出未处理异常', async () => {
    values.set('copilot-interview-history-v1', 'broken');
    await useHistory.getState().generateTitle('broken', 'model');
    expect(useHistory.getState().error).toContain('原始数据已保留');
    expect(values.get('copilot-interview-history-v1')).toBe('broken');
  });
});
