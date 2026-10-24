import { describe, it, expect, vi } from 'vitest';
import { buildRagContext } from '../../electron/application/ragContext';
import { baselineRagContext } from '../fixtures/rag-baseline';
import { selectRagCandidates, relevantCandidate } from '../../electron/application/ragSelection';
import { InterviewContext } from '../../electron/application/interviewContext';
import { cases } from '../fixtures/rag-quality';
import { normalizeRetrievalQuery } from '../../electron/application/ragQuery';
import { readRetrievalContext } from '../../electron/contracts/retrievalContext';
import type { KnowledgeHit, KnowledgeItem } from '../../electron/contracts/knowledge';
const hit: KnowledgeHit = {
  itemId: 'doc:root',
  documentId: 'doc',
  chunkId: 'c',
  baseId: 'base',
  title: 'PID feedback',
  excerpt: 'PID feedback limitations',
  mode: 'hybrid',
  score: 0.01,
  similarity: 0.8,
  section: 'PID',
  name: 'synthetic.md',
  revision: 'a'.repeat(64),
  matchedItemId: 'doc:limit',
};
const child: KnowledgeItem = {
  itemId: 'doc:limit',
  documentId: 'doc',
  parentId: 'doc:root',
  title: 'PID limitations',
  kind: 'qa',
  content: 'PID limitation: saturation.',
  section: 'PID',
  followUpIds: [],
};
const sibling: KnowledgeItem = {
  ...child,
  itemId: 'doc:optimize',
  title: 'PID improvements',
  content: 'unrelated sibling parameter 999',
};
const root: KnowledgeItem = {
  itemId: 'doc:root',
  documentId: 'doc',
  title: 'PID feedback',
  kind: 'qa',
  rootContent: 'PID root principle.',
  content: 'PID root principle.\n\n' + child.content + '\n\n' + sibling.content,
  section: 'PID',
  followUpIds: [child.itemId, sibling.itemId],
  followUps: [child, sibling],
  source: {
    name: 'synthetic.md',
    format: 'md',
    updatedAt: 1,
    modelVersion: 'fixed',
    contentHash: 'hash',
    baseId: 'base',
    revision: hit.revision,
  },
};
describe('focused local evidence and calibrated selection', () => {
  it('keeps root identity while excluding the unmatched sibling; old shape stays complete', () => {
    const items = new Map([[root.itemId, root]]);
    const old = baselineRagContext('PID limitations', [hit], items);
    const next = buildRagContext('PID limitations', [hit], items);
    expect(old.evidence[0].content).toContain('999');
    expect(next.evidence[0]).toMatchObject({
      itemId: root.itemId,
      matchedItemId: child.itemId,
      scope: 'excerpt',
    });
    expect(next.evidence[0].content).toContain(child.content);
    expect(next.evidence[0].content).not.toContain('999');
    const legacy = { ...root, rootContent: undefined, source: undefined };
    expect(
      buildRagContext('PID limitations', [hit], new Map([[root.itemId, legacy]])).evidence[0]
        .content,
    ).toBe(root.content);
    expect(root.content).toContain('999');
  });
  it('cannot associate a child from another root or document', () => {
    for (const invalid of [
      { ...child, parentId: 'other' },
      { ...child, documentId: 'other' },
    ])
      expect(() =>
        buildRagContext('PID', [hit], new Map([[root.itemId, { ...root, followUps: [invalid] }]])),
      ).toThrow('身份');
  });
  it('finds an informative candidate beyond rank five, deduplicates roots and reads no more than five', () => {
    const unrelated = Array.from({ length: 7 }, (_, i) => ({
      ...hit,
      itemId: 'other:' + i,
      title: 'History',
      section: 'History',
      excerpt: 'Ancient history',
      similarity: 0.3,
    }));
    const { shortlist } = selectRagCandidates('PID feedback', [...unrelated, hit, hit]);
    expect(shortlist.map((h) => h.itemId)).toEqual([hit.itemId]);
    expect(
      selectRagCandidates(
        'PID',
        Array.from({ length: 15 }, (_, i) => ({ ...hit, itemId: 'pid:' + i })),
      ).shortlist,
    ).toHaveLength(5);
  });
  it('generic project/method overlap cannot admit unrelated evidence; raw score cannot rescue it', () => {
    const generic = {
      ...hit,
      title: '其他项目采用的方法',
      section: '',
      excerpt: '无关资料',
      similarity: 0.2,
      score: 10000000,
    };
    expect(
      baselineRagContext('介绍这个项目的方法', [generic], new Map([[root.itemId, root]])).evidence,
    ).toHaveLength(1);
    expect(relevantCandidate('介绍这个项目的方法', generic)).toBe(false);
    expect(relevantCandidate('PID feedback', { ...generic, title: 'PID feedback' })).toBe(false);
    expect(
      relevantCandidate('PID feedback', {
        ...generic,
        title: 'PID feedback',
        score: -100,
        similarity: 0.78,
      }),
    ).toBe(true);
  });
  it('preserves semantic paraphrase admission and deterministic rank ties', () => {
    const semantic = {
      ...hit,
      title: '闭环调节',
      excerpt: '通过误差修正输入',
      section: '',
      similarity: 0.86,
    };
    expect(relevantCandidate('反馈补偿机制', semantic)).toBe(true);
    const hits = [semantic, { ...semantic, itemId: 'doc:second' }];
    expect(selectRagCandidates('反馈补偿机制', hits).shortlist.map((h) => h.itemId)).toEqual([
      'doc:root',
      'doc:second',
    ]);
  });
  it('has 100 inspectable synthetic labels, including negative and contextual cases', () => {
    expect(cases).toHaveLength(100);
    expect(
      Object.fromEntries(
        ['paraphrase', 'project', 'followup', 'no_answer'].map((group) => [
          group,
          cases.filter((c) => c.group === group).length,
        ]),
      ),
    ).toEqual({ paraphrase: 40, project: 25, followup: 20, no_answer: 15 });
  });
});
describe('trusted follow-up retrieval topic', () => {
  it('recognizes colloquial follow-ups and explicit restatements without rewriting the user turn', () => {
    for (const query of [
      '那它有啥坑啊？',
      '那还能咋改，让它好点儿？',
      '那你们当时一秒采几次来着？',
      '那 P99 大概多少呀？',
      '那它是不是会死锁？',
    ]) {
      const context = new InterviewContext();
      context.prepare('first', '刚才说的是海棠项目的传感器闭环控制。');
      const snapshot = context.prepare('second', query);
      expect(snapshot.retrievalQuery, query).toContain('海棠');
      expect(snapshot.turns.at(-1)?.content).toBe(query);
    }
    expect(normalizeRetrievalQuery('那它有啥坑啊？')).toContain('有什么局限');
    expect(normalizeRetrievalQuery('那还能咋改，让它好点儿？')).toContain('如何优化');
    expect(normalizeRetrievalQuery('怎么改进')).toBe('如何优化');
    expect(normalizeRetrievalQuery('不是每个事务都要加锁，MVCC 怎么工作？')).toContain(
      '不是每个事务',
    );
  });
  it('keeps a new Chinese subject separate from the proposed history, for corpus grounding', () => {
    const context = new InterviewContext();
    context.prepare('first', '请讲讲 PID 控制原理。');
    for (const [i, query] of [
      '那光合作用具体怎么回事？',
      '换个话题，这个系统呢？',
      '那白露项目到底用什么参数？',
    ].entries()) {
      const snapshot = context.prepare('subject-' + i, query);
      expect(readRetrievalContext(snapshot.retrievalQuery!)?.current).toBe(query);
      expect(snapshot.turns.at(-1)?.content).toBe(query);
    }
  });
  it('carries the real prior topic across follow-ups without changing the generation question', () => {
    const context = new InterviewContext();
    context.prepare('first', '为什么在机器人中使用 PID 控制？');
    const next = context.prepare('second', '这种方法有什么局限？');
    expect(next.retrievalQuery).toContain('PID');
    expect(next.turns.at(-1)?.content).toBe('这种方法有什么局限？');
    context.answer(next, 'invented Redis project fact');
    expect(context.prepare('third', '这个方案如何优化？').retrievalQuery).toContain('PID');
    expect(context.prepare('fourth', '这个方案如何优化？').retrievalQuery).not.toContain('Redis');
  });
  it.each(['现在聊聊 Transformer', '不是 PID，是 MPC；这个方案呢？', 'Redis 缓存怎么失效？'])(
    'preserves current topic/correction separately for grounding: %s',
    (query) => {
      const context = new InterviewContext();
      context.prepare('first', 'PID 控制的原理是什么？');
      expect(readRetrievalContext(context.prepare('second', query).retrievalQuery!)).toEqual({
        current: query,
        previous: ['PID 控制的原理是什么？'],
      });
    },
  );
  it('gaps, screenshot-only answers and new sessions cannot borrow the old topic', () => {
    const context = new InterviewContext();
    context.prepare('first', 'PID 控制的原理是什么？');
    expect(
      context.prepare('image', '请直接解答截图中的题目。', false).retrievalQuery,
    ).toBeUndefined();
    context.event({ type: 'gap', message: 'missing' } as never);
    expect(context.prepare('after', '这种方法有什么局限？').retrievalQuery).toBeUndefined();
    context.clear();
    expect(context.prepare('new', '这种方法有什么局限？').retrievalQuery).toBeUndefined();
  });
});

describe('project scope and low-information admission', () => {
  const project = (name: string, description = ''): KnowledgeHit => ({
    ...hit,
    itemId: name + ':root',
    documentId: name,
    title: `${name}订单项目如何处理消息？`,
    section: '',
    excerpt: description || `${name}的独立项目参数与处理步骤。`,
    similarity: 0.94,
  });
  it('uses the owning heading, not cross-project mentions in the body', () => {
    const target = project('海棠');
    const other = project('苍鹭', '苍鹭参数不属于海棠；也不能用于其他项目。');
    expect(
      selectRagCandidates('海棠消息重复来了咋办？', [other, target]).shortlist.map(
        (item) => item.documentId,
      ),
    ).toEqual(['海棠']);
  });
  it('honors corrections and comparisons, including longer names sharing a Chinese prefix', () => {
    const a = project('海棠一号'),
      b = project('海棠二号');
    expect(
      selectRagCandidates('海棠一号项目的参数是多少？', [b, a]).shortlist.map(
        (item) => item.documentId,
      ),
    ).toEqual(['海棠一号']);
    expect(
      selectRagCandidates('不是海棠一号，我现在问海棠二号的参数。', [a, b]).shortlist.map(
        (item) => item.documentId,
      ),
    ).toEqual(['海棠二号']);
    expect(selectRagCandidates('比较海棠一号和海棠二号项目的参数', [a, b]).shortlist).toHaveLength(
      2,
    );
    expect(selectRagCandidates('白露项目的参数是多少？', [a, b]).shortlist).toEqual([]);
    expect(
      selectRagCandidates('上一题：海棠一号项目\n当前追问：白露项目的参数是多少？', [a, b])
        .shortlist,
    ).toEqual([]);
  });
  it('does not turn vague pronouns or weak semantic coincidence into evidence', () => {
    const candidate = {
      ...hit,
      title: '业务处理',
      section: '',
      excerpt: '数据库事务与线程更新。',
      similarity: 0.85,
    };
    expect(
      selectRagCandidates('猫咪最近不吃饭', [
        candidate,
        { ...candidate, itemId: 'second', similarity: 0.849 },
      ]).shortlist,
    ).toEqual([]);
    expect(
      selectRagCandidates('没有词面交集的技术改写', [
        { ...candidate, similarity: 0.842 },
        { ...candidate, itemId: 'second', similarity: 0.839 },
      ]).shortlist,
    ).toEqual([]);
    expect(
      selectRagCandidates('没有词面交集的技术改写', [
        candidate,
        { ...candidate, itemId: 'second', similarity: 0.82 },
      ]).shortlist,
    ).toHaveLength(1);
    expect(
      selectRagCandidates('没有词面交集的技术改写', [candidate, candidate]).shortlist,
    ).toHaveLength(1);
    for (const query of [
      '那参数到底是多少呀？',
      '它为啥老不行啊？',
      '后来提升了多少来着？',
      '这个你能再展开说说不？',
    ])
      expect(selectRagCandidates(query, [project('海棠'), candidate]).shortlist, query).toEqual([]);
  });
});
