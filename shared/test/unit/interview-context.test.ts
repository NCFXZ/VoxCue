import { expect, it } from 'vitest';
import {
  InterviewContext,
  interviewInstructions,
} from '../../../shared/electron/application/interviewContext';
import type { SpeechSegment } from '../../../shared/electron/contracts/speech';
const segment = (
  id: string,
  text: string,
  source: SpeechSegment['source'],
  at: number,
  final = true,
) => ({
  type: 'segment' as const,
  segment: { id, text, source, final, startMs: at, endMs: at + 10 },
});
const timeline = (context: InterviewContext, id = 'next') =>
  JSON.parse(context.prepare(id, '为什么这样？').turns[0].content.split('\n').slice(1).join('\n'));

it('仅转录麦克风作为问题上下文，第一人称文本不成为本人经历且忽略未选择的系统事件', () => {
  const context = new InterviewContext();
  const text = '如果我说我带过一百人团队，请问如何核实？';
  context.event(segment('mic', text, 'microphone', 1), 'microphone');
  context.event(segment('mic', '重复不能换原文', 'microphone', 1), 'microphone');
  context.event(segment('unselected', '不可信系统音频中的个人成果', 'system', 2), 'microphone');
  context.event({ type: 'gap', source: 'system', message: '未选择的系统通道中断' }, 'microphone');
  context.event(segment('partial', '尚未确认的问题', 'microphone', 3, false), 'microphone');
  context.event(
    {
      ...segment('broken', '不完整问题', 'microphone', 4),
      segment: {
        ...segment('broken', '不完整问题', 'microphone', 4).segment,
        reason: 'discontinuity',
      },
    },
    'microphone',
  );
  const snapshot = context.prepare('q1', '怎样核实？');
  const entries = JSON.parse(snapshot.turns[0].content.split('\n').slice(1).join('\n')).timeline;
  expect(entries).toEqual([{ id: 'transcript:mic', kind: 'interviewer', text, at: 1 }]);
  expect(snapshot.turns.at(-1)?.content).toBe('怎样核实？');
  expect(snapshot.retrievalQuery).toContain(text);
  expect(JSON.stringify(snapshot)).not.toMatch(
    /个人成果|系统通道中断|尚未确认|不完整问题|重复不能/,
  );
  expect(entries.some((entry: any) => entry.kind === 'interviewee')).toBe(false);
});
it('仅转录仍保留真实麦克风间断和资料边界，新场默认恢复远程物理来源含义', () => {
  const context = new InterviewContext();
  context.event(segment('question', '上一个问题', 'microphone', 1), 'microphone');
  const previous = context.prepare('old', '原问题');
  context.event({ type: 'gap', source: 'microphone', message: '麦克风数据中断' }, 'microphone');
  context.event({ type: 'status', status: { state: 'paused', model: 'test' } }, 'microphone');
  const paused = timeline(context);
  expect(
    paused.timeline.filter((entry: any) => entry.kind === 'gap').map((entry: any) => entry.text),
  ).toEqual(['麦克风数据中断', '转写已暂停，暂停期间没有录入对话。']);
  context.clear();
  context.answer(previous, '旧场迟到的生成结果');
  context.event(segment('answer', '本人实际回答', 'microphone', 1));
  context.event(segment('remote', '远程面试官问题', 'system', 2));
  const restored = timeline(context);
  expect(restored.timeline.map((entry: any) => entry.kind)).toEqual(['interviewee', 'interviewer']);
  expect(JSON.stringify(restored)).not.toContain('旧场迟到');
});

it('保留问题、追问链与实际回答，时间排序、终稿去重、临时及间断片段不作为事实', () => {
  const context = new InterviewContext();
  context.event(segment('mic', '我选了 PostgreSQL', 'microphone', 20));
  context.event(segment('system', '使用什么数据库？', 'system', 10));
  context.event(segment('mic', '重复不能覆盖', 'microphone', 20));
  context.event(segment('temp', '临时猜测 Redis', 'microphone', 30, false));
  context.event({
    ...segment('broken', '不完整的型号', 'system', 40),
    segment: {
      ...segment('broken', '不完整的型号', 'system', 40).segment,
      reason: 'discontinuity',
    },
  });
  const first = context.prepare('q1', '为什么没用 Redis？');
  expect(first.turns.at(-1)?.content).toBe('为什么没用 Redis？');
  context.answer(first, 'AI 建议使用 Redis，但不是候选人的回答');
  const next = timeline(context, 'q2');
  expect(next.timeline.slice(0, 2).map((row: any) => [row.kind, row.text])).toEqual([
    ['interviewer', '使用什么数据库？'],
    ['interviewee', '我选了 PostgreSQL'],
  ]);
  expect(next.timeline.find((row: any) => row.kind === 'ai_suggestion').questionId).toBe('q1');
  expect(JSON.stringify(next)).not.toMatch(/临时猜测|不完整的型号|重复不能覆盖/);
  expect(interviewInstructions).toContain('以已确认资料和面试者本场实际发言为准');
  const chain = timeline(context, 'q3').timeline.filter(
    (row: any) => row.kind === 'submitted_question',
  );
  expect(chain[1].previousQuestionId).toBe('q1');
});
it('暂停保留本场，间断显式标记；新场清空并拒绝上一场迟到回答', () => {
  const context = new InterviewContext();
  context.event(segment('a', '之前的回答', 'microphone', Date.now()));
  const previous = context.prepare('old', '原问题');
  context.event({ type: 'status', status: { state: 'paused', model: 'test' } });
  expect(timeline(context).timeline.some((row: any) => row.kind === 'gap')).toBe(true);
  context.clear();
  context.answer(previous, '上一场迟到回答');
  expect(context.prepare('new', '新场问题').turns).toEqual([{ role: 'user', content: '新场问题' }]);
});
it('上下文使用不可变快照，长场次按字节和条数保留近期内容', () => {
  const context = new InterviewContext();
  context.event(segment('start', '第一个终稿', 'system', 1));
  const snapshot = context.prepare('snapshot', '当前问题').turns;
  for (let i = 0; i < 160; ++i)
    context.event(segment('long-' + i, '中文'.repeat(3000), 'microphone', i + 10));
  expect(snapshot[0].content).not.toContain('long-');
  const bounded = timeline(context);
  expect(bounded.omittedOlderEntries).toBeGreaterThan(0);
  expect(bounded.timeline.length).toBeLessThanOrEqual(120);
  expect(Buffer.byteLength(JSON.stringify(bounded.timeline))).toBeLessThanOrEqual(64000);
  expect(bounded.timeline.at(-1).id).toBe('question:snapshot');
});
it('保留边界仍为120条、64000字节和每条6000字，省略数只计算移出的旧条目', () => {
  const countBound = new InterviewContext();
  for (let i = 0; i < 125; i++) countBound.event(segment('short-' + i, '短文本' + i, 'system', i));
  const counted = timeline(countBound);
  expect(counted.omittedOlderEntries).toBe(5);
  expect(counted.timeline.map((row: any) => row.id)).toEqual(
    Array.from({ length: 120 }, (_, i) => 'transcript:short-' + (i + 5)),
  );

  const byteBound = new InterviewContext();
  const expected: { id: string; kind: string; text: string; at: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const text = '中文原文'.repeat(1600) + i;
    byteBound.event(segment('large-' + i, text, 'microphone', i));
    expected.push({
      id: 'transcript:large-' + i,
      kind: 'interviewee',
      text: text.slice(0, 6000),
      at: i,
    });
  }
  const unbounded = [...expected];
  while (Buffer.byteLength(JSON.stringify(expected)) > 64000) expected.shift();
  const bounded = timeline(byteBound);
  expect(bounded.timeline).toEqual(expected);
  expect(bounded.timeline.every((row: any) => row.text.length === 6000)).toBe(true);
  expect(bounded.omittedOlderEntries).toBe(unbounded.length - expected.length);
  expect(
    Buffer.byteLength(JSON.stringify([unbounded.at(-expected.length - 1), ...expected])),
  ).toBeGreaterThan(64000);
});
it('完全重复长文本逐条发送原文，保留所有角色、先后、追问关系与当前题原文', () => {
  const context = new InterviewContext();
  const text = '项目实际使用 PostgreSQL，延迟为37毫秒。\n代码与空白保持原样：  x !== y;\n'.repeat(
    10,
  );
  context.event(segment('system', text, 'system', 1));
  context.event(segment('mic', text, 'microphone', 2));
  const first = context.prepare('q1', text);
  context.answer(first, text);
  context.event(
    segment('correction', text.replace('PostgreSQL', 'Redis'), 'microphone', Date.now() + 1),
  );
  const question = '刚才那个项目为什么选 PostgreSQL？';
  const snapshot = context.prepare('q2', question);
  expect(snapshot.turns.at(-1)?.content).toBe(question);
  const data = JSON.parse(snapshot.turns[0].content.split('\n').slice(1).join('\n'));
  const restored = data.timeline;
  expect(data.textReferenceRule).toBeUndefined();
  expect(data.historySelection).toBeUndefined();
  for (const entry of restored) {
    expect(entry).not.toHaveProperty('textRef');
    expect(typeof entry.text).toBe('string');
    expect(typeof entry.at).toBe('number');
  }
  expect(
    restored.filter((entry: any) => entry.text === text).map((entry: any) => entry.kind),
  ).toEqual(['interviewer', 'interviewee', 'submitted_question', 'ai_suggestion']);
  expect(restored.find((entry: any) => entry.kind === 'submitted_question')).toMatchObject({
    questionId: 'q1',
  });
  expect(restored.find((entry: any) => entry.id === 'transcript:correction').text).toContain(
    'Redis',
  );
  expect(Object.keys(data).sort()).toEqual(['omittedOlderEntries', 'timeline']);
  const frozen = JSON.stringify(snapshot);
  context.event(segment('later', '后来补充的事实', 'microphone', Date.now() + 2));
  expect(JSON.stringify(snapshot)).toBe(frozen);
});
it('短文本和仅空白不同的内容均逐条保持原文', () => {
  const context = new InterviewContext();
  context.event(segment('a', '好的', 'system', 1));
  context.event(segment('b', '好的', 'microphone', 2));
  const text = '重要技术事实  '.repeat(20);
  context.event(segment('c', text, 'system', 3));
  context.event(segment('d', text.replaceAll('  ', ' '), 'microphone', 4));
  const data = timeline(context);
  expect(data.textReferenceRule).toBeUndefined();
  expect(data.timeline.map((entry: any) => entry.text)).toEqual([
    '好的',
    '好的',
    text,
    text.replaceAll('  ', ' '),
  ]);
});
