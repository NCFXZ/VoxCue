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
