import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryDetail } from '../../src/components/HistoryDetail';
import type { InterviewRecord } from '../../../shared/src/services/history';
import { createHistoryService } from '../../../shared/src/services/history';
import {
  answerSourceLookup,
  titleQuestions,
  exportRecord,
  answerCountLabel,
  relativeTime,
} from '../../../shared/src/services/historyPresentation';
import { useHistory } from '../../../shared/src/stores/history';
import { useGeneralSettings } from '../../src/stores/generalSettings';
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
const sourceIds = (record: InterviewRecord, answer: InterviewRecord['answers'][number]) =>
  answerSourceLookup(record)(answer);
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
beforeEach(() => {
  useGeneralSettings.setState({ language: 'zh-CN' });
  values = new Map();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { desktop: { generateInterviewTitle: vi.fn(async () => {}) } });
  useHistory.setState({ records: [], error: null });
});
it('知识库名称按本场快照添加到AI标题，重试不重复添加且保留手动命名', async () => {
  await useHistory.getState().save({ ...record(), knowledgeBaseName: '研发面试' });
  await useHistory.getState().applyTitle({ recordId: 'history-r', error: '可重试' });
  await useHistory.getState().generateTitle('history-r', 'model');
  await useHistory.getState().applyTitle({ recordId: 'history-r', title: '项目架构与排障' });
  expect(useHistory.getState().records[0].title).toBe('「研发面试」项目架构与排障');
  await useHistory.getState().applyTitle({ recordId: 'history-r', title: '重复结果' });
  expect(useHistory.getState().records[0].title).toBe('「研发面试」项目架构与排障');
  await useHistory.getState().rename('history-r', '我的复盘');
  await useHistory.getState().applyTitle({ recordId: 'history-r', title: '迟到结果' });
  expect(useHistory.getState().records[0].title).toBe('我的复盘');
  await useHistory.getState().save({ ...record(), id: 'no-kb' });
  await useHistory.getState().applyTitle({ recordId: 'no-kb', title: '无知识库的面试' });
  expect(useHistory.getState().records.find((r) => r.id === 'no-kb')?.title).toBe('无知识库的面试');
});
describe('历史时间线、关联与持久化', () => {
  it('关闭的回答栏首屏保留回答入口，同时推迟渲染正文和截图', () => {
    const value = record();
    value.answers[0].sourceTranscriptIds = [];
    value.answers[0].images = [{ id: '11111111-1111-4111-8111-111111111111' }];
    const html = renderToStaticMarkup(createElement(HistoryDetail, {
      record: value, onBack() {}, onDelete: async () => false,
    }));
    expect(html).toContain('1 条 AI 回答');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('markdown-content');
    // The visible gallery still offers the image. The closed answer rail adds no duplicate.
    expect(html.match(/class="interview-image-thumbnail"/g)).toHaveLength(1);
  });
  it('结束后通过原有错误提示展示保存的录音失败原因，完整转写仍独立保留', () => {
    const value = record();
    value.recordingError = '录音写入失败，请检查可用空间。';
    value.status = 'interrupted';
    const html = renderToStaticMarkup(createElement(HistoryDetail, {
      record: value, onBack() {}, onDelete: async () => false,
    }));
    expect(html).toContain(value.recordingError);
    expect(html).toContain('已保存');
    expect(html).not.toContain('转写可能不完整');
  });
  it('回答计数在中英文界面和导出中保留0、1、2语义，英文单数准确且不计Mock', () => {
    for (const [language, labels] of [
      ['zh-CN', ['0 条 AI 回答', '1 条 AI 回答', '2 条 AI 回答']],
      ['en', ['0 AI answers', '1 AI answer', '2 AI answers']],
    ] as const) {
      useGeneralSettings.setState({ language });
      for (const [count, label] of labels.entries()) {
        expect(answerCountLabel(count)).toBe(label);
        const value = record();
        const answer = value.answers[0];
        value.answers = Array.from({ length: count }, (_, index) => ({
          ...answer,
          id: `answer-${index}`,
        }));
        value.answers.push({ ...answer, id: 'mock', provider: 'mock' });
        expect(exportRecord(value).split('\r\n')[2]).toBe(`2:00 · ${label}`);
      }
    }
  });
  it('准确关联系统片段，歧义旧记录和麦克风不产生假定位', () => {
    const r = record(),
      a = r.answers[0];
    expect(sourceIds(r, a)).toEqual(['s1']);
    r.transcripts.push({ ...r.transcripts[0], id: 'duplicate' });
    expect(sourceIds(r, a)).toEqual([]);
    expect(sourceIds(r, { ...a, sourceTranscriptIds: ['s1', 'm1', 'deleted'] })).toEqual(['s1']);
    expect(sourceIds(r, { ...a, questionSource: 'microphone', sourceTranscriptIds: ['s1', 'm1', 'deleted'] })).toEqual(['m1']);
    expect(sourceIds(r, { ...a, question: '私人回答', sourceTranscriptIds: ['m1'] })).toEqual(['m1']);
    expect(sourceIds(r, { ...a, sourceTranscriptIds: ['m1'] })).toEqual([]);
    expect(sourceIds(r, { ...a, sourceTranscriptIds: [] })).toEqual([]);
    r.transcripts = [
      { ...r.transcripts[0], text: '介绍' },
      { ...r.transcripts[0], id: 's2', text: '项目' },
    ];
    expect(sourceIds(r, a)).toEqual(['s1', 's2']);
    expect(sourceIds(r, { ...a, sourceTranscriptIds: [] })).toEqual([]);
    expect(sourceIds(r, { ...a, question: '差不多的项目' })).toEqual([]);
  });
  it('旧问题批量匹配保留六段上限、唯一性和标点归一化', () => {
    const r = record();
    r.transcripts = ['Ａ', '，', 'B', 'C', 'D', 'E', 'F', 'G', '重复', '重复'].map((text, i) =>
      ({ ...r.transcripts[0], id: String(i), text }));
    r.answers = ['abcde', 'abcdef', 'b', 'a', '重复'].map((question, i) =>
      ({ ...r.answers[0], id: String(i), question }));
    const lookup = answerSourceLookup(r);
    expect(r.answers.map(lookup)).toEqual([['0', '1', '2', '3', '4', '5'], [], [], ['0'], []]);
    expect(lookup({ ...r.answers[0], question: 'g' })).toEqual(['7']);
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
    await useHistory.getState().save(record());
    await useHistory.getState().generateTitle('history-r', 'model');
    expect(useHistory.getState().records[0].titleStatus).toBe('pending');
    await useHistory.getState().applyTitle({ recordId: 'history-r', error: '失败' });
    expect(useHistory.getState().records[0].titleStatus).toBe('failed');
    await useHistory.getState().generateTitle('history-r', 'model');
    await useHistory.getState().remove('history-r');
    await useHistory.getState().applyTitle({ recordId: 'history-r', title: '迟到标题' });
    expect(useHistory.getState().records).toEqual([]);
  });
  it('手动重命名持久保存且保留正文，迟到标题和旧归档不能覆盖；可再次重命名', async () => {
    const original = record();
    await useHistory.getState().save(original);
    await useHistory.getState().generateTitle(original.id, 'model');
    expect(await useHistory.getState().rename(original.id, '  技术交流  ')).toBe(true);
    await useHistory.getState().applyTitle({ recordId: original.id, title: '迟到自动标题' });
    await useHistory.getState().applyTitle({ recordId: original.id, error: '迟到失败' });
    await useHistory.getState().save({ ...original, title: '旧归档标题', titleStatus: 'ready' });
    const saved = createHistoryService(storage).list()[0];
    expect(saved).toMatchObject({
      title: '技术交流',
      titleSource: 'manual',
      titleStatus: 'ready',
      transcripts: original.transcripts,
      answers: original.answers,
    });
    expect(await useHistory.getState().rename(original.id, '再次修改')).toBe(true);
    await useHistory.getState().load();
    expect(useHistory.getState().records[0].title).toBe('再次修改');
  });
  it('无效标题、存储失败和已删除记录不覆盖原件或复活记录', async () => {
    await useHistory.getState().save(record());
    const before = storage.getItem('copilot-interview-history-v1');
    for (const title of ['', '   ', 'x'.repeat(81), '第一行\n第二行'])
      expect(await useHistory.getState().rename('history-r', title)).toBe(false);
    const fail = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
      throw Error('Storage quota');
    });
    expect(await useHistory.getState().rename('history-r', '不会保存')).toBe(false);
    fail.mockRestore();
    expect(storage.getItem('copilot-interview-history-v1')).toBe(before);
    await useHistory.getState().remove('history-r');
    expect(await useHistory.getState().rename('history-r', '已删除')).toBe(false);
    expect(createHistoryService(storage).list()).toEqual([]);
  });
  it('损坏数据不会在生成标题时被覆盖，也不会抛出未处理异常', async () => {
    values.set('copilot-interview-history-v1', 'broken');
    await useHistory.getState().generateTitle('broken', 'model');
    expect(useHistory.getState().error).toContain('原始数据已保留');
    expect(values.get('copilot-interview-history-v1')).toBe('broken');
  });
});
