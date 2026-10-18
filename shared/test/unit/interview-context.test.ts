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
  expect(interviewInstructions).toContain('面试者实际说过的答案');
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
it('完全重复长文本按原文引用去重，保留所有角色、先后、追问关系与当前题原文', () => {
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
  const literal = new Map<string, string>();
  const restored = data.timeline.map((entry: any) => {
    if (entry.textRef) {
      expect(literal.has(entry.textRef)).toBe(true);
      const { textRef, ...rest } = entry;
      return { ...rest, text: literal.get(textRef) };
    }
    literal.set(entry.id, entry.text);
    return entry;
  });
  expect(data.textReferenceRule).toContain('不能把 AI 建议当成实际发言');
  expect(
    restored.filter((entry: any) => entry.text === text).map((entry: any) => entry.kind),
  ).toEqual(['interviewer', 'interviewee', 'submitted_question', 'ai_suggestion']);
  expect(restored.find((entry: any) => entry.kind === 'submitted_question')).toMatchObject({
    questionId: 'q1',
  });
  expect(restored.find((entry: any) => entry.id === 'transcript:correction').text).toContain(
    'Redis',
  );
  expect(Buffer.byteLength(JSON.stringify(data))).toBeLessThan(
    Buffer.byteLength(
      JSON.stringify({ omittedOlderEntries: data.omittedOlderEntries, timeline: restored }),
    ),
  );
  const frozen = JSON.stringify(snapshot);
  context.event(segment('later', '后来补充的事实', 'microphone', Date.now() + 2));
  expect(JSON.stringify(snapshot)).toBe(frozen);
});
it('短文本和仅空白不同的内容保持原文，不为去重增加上下文大小', () => {
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
