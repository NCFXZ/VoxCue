import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InterviewContext } from '../../electron/application/interviewContext';

type Row = {
  id: string;
  kind: string;
  text: string;
  at: number;
  questionId?: string;
  previousQuestionId?: string;
};
let clock = 1800000000000;
beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
});
const originals = (context: InterviewContext): Row[] =>
  structuredClone((context as unknown as { entries: Row[] }).entries);
function transcript(
  context: InterviewContext,
  id: string,
  text: string,
  source: 'system' | 'microphone',
) {
  clock += 100;
  context.event({
    type: 'segment',
    segment: {
      id,
      text,
      source,
      final: true,
      startMs: clock,
      endMs: clock + 10,
      reason: 'silence',
    },
  });
}
function round(context: InterviewContext, label: string, topic: string, actual?: string) {
  const question = `介绍${topic}的${label}部分，说明设计取舍。`;
  transcript(context, 'interviewer-' + label, question, 'system');
  clock += 100;
  const snapshot = context.prepare('question-' + label, question);
  clock += 100;
  context.answer(
    snapshot,
    `候选表达：${topic} ${label}。` +
      '在方案设计中，先明确输入输出，再说明接口边界以及异常处理。'.repeat(14),
  );
  transcript(
    context,
    'actual-' + label,
    actual ??
      `我负责${topic}的${label}部分。` +
        '团队通过异步消息拆分职责，交付过程中关注权限约束、故障定位和回滚路径。'.repeat(5),
    'microphone',
  );
}
function history() {
  const context = new InterviewContext();
  round(context, '甲', '项目A', '项目A使用PostgreSQL，延迟为37毫秒，我负责事务与数据一致性。');
  round(
    context,
    '乙',
    '项目A',
    '项目A的PostgreSQL提供事务保障。纠正：前面说的延迟应为42毫秒，负责人仍是我。',
  );
  for (const label of ['丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '子', '丑'])
    round(context, label, '项目B');
  return context;
}
function decode(snapshot: ReturnType<InterviewContext['prepare']>) {
  const data = JSON.parse(snapshot.turns[0].content.split('\n').slice(1).join('\n'));
  expect(data).not.toHaveProperty('historySelection');
  expect(data).not.toHaveProperty('textReferenceRule');
  const rows: Row[] = data.timeline;
  for (const row of rows) {
    expect(row).not.toHaveProperty('textRef');
    expect(typeof row.text).toBe('string');
  }
  return { data, rows };
}

it('跨话题返回项目A时发送完整时间线，包括较早无关AI建议、原问答和纠正', () => {
  const context = history();
  const question = '项目A的PostgreSQL为什么选择事务？';
  const before = originals(context);
  const snapshot = context.prepare('return-a', question);
  const { data, rows } = decode(snapshot);
  expect(rows).toEqual(before);
  expect(rows.find((row) => row.id === 'transcript:actual-甲')).toEqual(
    before.find((row) => row.id === 'transcript:actual-甲'),
  );
  expect(rows.find((row) => row.id === 'transcript:actual-乙')?.text).toContain('42毫秒');
  expect(rows.find((row) => row.id === 'question:question-甲')?.questionId).toBe('question-甲');
  for (const row of rows) expect(row).toEqual(before.find((entry) => entry.id === row.id));
  for (const row of before.slice(-18)) expect(rows.some((entry) => entry.id === row.id)).toBe(true);
  expect(snapshot.turns.at(-1)?.content).toBe(question);
  expect(originals(context).slice(0, before.length)).toEqual(before);
  const fullBytes = Buffer.byteLength(JSON.stringify({ omittedOlderEntries: 0, timeline: before }));
  const sentBytes = Buffer.byteLength(JSON.stringify(data));
  expect(sentBytes).toBe(fullBytes);
  console.log(
    'OFFLINE_CONTEXT_BYTES ' +
      JSON.stringify({
        baseline: fullBytes,
        restored: sentBytes,
        originalRows: before.length,
        sentRows: rows.length,
      }),
  );
});

it.each([
  '为什么这样做？',
  '它和PostgreSQL有什么不同？',
  '刚才那个方案为什么用了PostgreSQL？',
  '对比两个项目的PostgreSQL选择',
  'What about that PostgreSQL choice?',
  '嗯PostgreSQL这块咋弄的',
  'PostgreSQL那块你展开讲讲',
  'PostgreSQL跟刚说的那套比呢',
  'PostgreSQL和Redis有啥不一样',
  'PostgreSQL这俩方案咋选',
  '刚刚PostgreSQL你说的那啥再讲一遍',
  '接着上回PostgreSQL往下说',
  'PostgreSQL之前说的方案还有啥坑',
  'umm PostgreSQL what about the other one',
])('含糊指代或跨项目比较保留完整窗口：%s', (question) => {
  const context = history();
  const before = originals(context);
  const { data, rows } = decode(context.prepare('ambiguous', question));
  expect(data.historySelection).toBeUndefined();
  expect(rows).toEqual(before);
});

it.each([
  '呃咱换一套走SQLite这边吧',
  '唉我说岔了，归档库用SQLite',
  '刚讲反了哈，归档库才用SQLite',
  '嗯确切点讲我只负责归档库的SQLite接入',
  '归档库的SQLite跟业务库独立部署',
])('较早真实发言始终保留，不依赖纠正词或主题识别：%s', (actual) => {
  const context = new InterviewContext();
  for (const [index, label] of [
    '甲',
    '乙',
    '丙',
    '丁',
    '戊',
    '己',
    '庚',
    '辛',
    '壬',
    '癸',
    '子',
    '丑',
  ].entries())
    round(context, label, index === 0 ? '项目A' : '项目B', index === 2 ? actual : undefined);
  const before = originals(context);
  const { rows } = decode(context.prepare('oral-reference', '项目A的接口为何选异步？'));
  expect(rows).toEqual(before);
  expect(rows.find((row) => row.id === 'transcript:actual-丙')?.text).toBe(actual);
});

it('当前终稿中的新主题不冒充较早历史中的匹配，完整保留原窗口', () => {
  const context = history();
  const question = 'CockroachDB为何适合这个场景？';
  transcript(context, 'new-topic', question, 'system');
  const before = originals(context);
  const { data, rows } = decode(context.prepare('new-topic', question));
  expect(data.historySelection).toBeUndefined();
  expect(rows).toEqual(before);
});

it('连续追问和后续纠正保留原始先后，不把旧AI建议覆盖到实际发言', () => {
  const context = history();
  for (const [index, question] of [
    '项目A的PostgreSQL为什么选择事务？',
    '为什么这样？',
    '它有什么缺点？',
  ].entries()) {
    const before = originals(context);
    const snapshot = context.prepare('follow-' + index, question);
    const { rows } = decode(snapshot);
    expect(rows.find((row) => row.id === 'transcript:actual-乙')?.text).toContain('42毫秒');
    expect(rows).toEqual(before);
    context.answer(snapshot, 'AI曾建议MySQL，不能当作候选人的技术选择。');
  }
  transcript(
    context,
    'latest-correction',
    '纠正：项目A后来改用SQLite，延迟降至18毫秒；此前PostgreSQL属于旧方案。',
    'microphone',
  );
  const { rows } = decode(context.prepare('corrected', '项目A当前数据库是什么？'));
  const actual = rows.filter((row) => row.kind === 'interviewee');
  expect(actual.at(-1)?.text).toContain('SQLite');
  expect(actual.at(-1)?.text).toContain('18毫秒');
  expect(actual.map((row) => row.text).join('\n')).not.toContain('AI曾建议MySQL');
  expect(rows.filter((row) => row.kind === 'submitted_question').at(-1)?.previousQuestionId).toBe(
    'follow-1',
  );
});

it('多组长历史逐条发送保留窗口全部原文，触及边界时仅省略更早条目', () => {
  const context = history();
  for (let index = 0; index < 80; index++) {
    round(context, '长场' + String.fromCharCode(0x4e10 + index), index % 2 ? '项目A' : '项目B');
    const before = originals(context);
    const { data, rows } = decode(
      context.prepare('probe-' + index, index % 3 ? '项目A的接口如何处理？' : '它为什么这样设计？'),
    );
    expect(rows).toEqual(before);
    expect(data.omittedOlderEntries).toBeGreaterThanOrEqual(0);
    expect(before.length).toBeLessThanOrEqual(120);
    expect(Buffer.byteLength(JSON.stringify(before))).toBeLessThanOrEqual(64000);
  }
  expect(
    decode(context.prepare('bounded', '项目A为何如此设计？')).data.omittedOlderEntries,
  ).toBeGreaterThan(0);
});

it('本地上下文组装只测CPU时间，不把夹具时间当作模型首字时间', () => {
  const context = history();
  const question = '项目A的PostgreSQL为什么选择事务？';
  context.prepare('bench', question);
  const durations: number[] = [];
  for (let index = 0; index < 300; index++) {
    const before = originals(context);
    const started = performance.now();
    const snapshot = context.prepare('bench', question);
    durations.push(performance.now() - started);
    expect(decode(snapshot).rows).toEqual(before);
  }
  const p95 = (values: number[]) =>
    +values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)].toFixed(3);
  console.log(
    'OFFLINE_PREPARE_MS ' +
      JSON.stringify({
        prepareP95: p95(durations),
        samples: durations.length,
      }),
  );
  expect(p95(durations)).toBeLessThan(50);
});
