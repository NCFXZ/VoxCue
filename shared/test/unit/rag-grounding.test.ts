import { describe, expect, it } from 'vitest';
import {
  GroundingIndex, cleanGroundingQuery, isGroundingFollowUp, selectHistory, unitVector,
} from '../../electron/backend/knowledge/grounding';
import {
  encodeRetrievalContext,
  readRetrievalContext,
} from '../../electron/contracts/retrievalContext';
import { InterviewContext } from '../../electron/application/interviewContext';
import { buildRagContext } from '../../electron/application/ragContext';
import type { KnowledgeHit, KnowledgeItem } from '../../electron/contracts/knowledge';

function vector(first: number, second = 0) {
  const v = Array<number>(384).fill(0);
  v[0] = first; v[1] = second;
  v[2] = Math.sqrt(Math.max(0, 1 - first * first - second * second));
  return unitVector(v);
}

describe('interview retrieval ranking', () => {
  it('cleans spoken fillers and repairs spaced English terms without modifying follow-up cues', () => {
    expect(cleanGroundingQuery('嗯，我想问一下，P I D 的 C 加加 实现')).toBe('PID 的 C++ 实现');
    expect(cleanGroundingQuery('这个东西')).toBe('这个东西');
    expect(cleanGroundingQuery('R O S 二的定位')).toBe('ROS2的定位');
    expect(isGroundingFollowUp('回到较早的恢复策略，这一步具体如何验证？')).toBe(true);
    expect(isGroundingFollowUp('边界，怎么测？')).toBe(true);
    expect(isGroundingFollowUp('请描述采样设备出现故障时的诊断流程')).toBe(false);
  });

  it('chooses one prior question, applying the 0.06 preference only without a return cue', () => {
    const current = { text: 'current', vector: vector(1) };
    const recent = [{ text: 'latest', vector: vector(0.90) }, { text: 'older', vector: vector(0.95) }];
    expect(selectHistory('那怎么验证？', current, recent)?.text).toBe('latest');
    expect(selectHistory('回到之前那个问题', current, recent)?.text).toBe('older');
    const tied = { ...recent[1], text: 'oldest' };
    expect(selectHistory('之前那个问题', current, [recent[1], tied])).toBe(recent[1]);
  });

  it('combines independent best dense and BM25 slices per root and adds exactly one full prior score', async () => {
    const slice = (root: string, id: string, text: string, v: Float32Array) => ({
      documentId: 'synthetic', rootItemId: root, itemId: id, chunkId: id + '-0', text, vector: v,
    });
    const rows = [
      slice('a', 'a', 'needle', vector(0.3, 0.1)),
      slice('a', 'child', 'body', vector(0.90, 0.3)),
      slice('b', 'b', 'previous', vector(0.93, 0.35)),
      slice('c', 'c', 'prior', vector(0.1, 0.99)),
    ];
    const read = async function* () { yield* rows; };
    const signal = new AbortController().signal;
    const index = await GroundingIndex.load(read, signal);
    const current = { text: 'needle needle', vector: vector(1) }, prior = { text: 'prior', vector: vector(0, 1) };
    const base = await index.rank(read, current, undefined, signal);
    expect(base.map(v => v.row.itemId)).toEqual(['child', 'b', 'c']);
    expect(base[0].cosine).toBeCloseTo(0.90, 6);
    expect(base[0].score).toBeCloseTo(0.95, 6);
    const combined = await index.rank(read, current, prior, signal);
    expect(combined.map(v => v.row.rootItemId)).toEqual(['b', 'a', 'c']);
    expect(combined.map(v => v.score)).toEqual([expect.closeTo(1.28, 6), expect.closeTo(1.25, 6), expect.closeTo(1.14, 6)]);
  });
});

describe('trusted thread proposals', () => {
  it('preserves several colloquial follow-ups without inspecting their vocabulary', () => {
    const context = new InterviewContext();
    context.prepare('seed', '请讲讲分片重传和文件校验。');
    context.prepare('a', '一半没了怎么办？');
    const prior = context.prepare('b', '再往后呢？');
    context.answer(prior, '虚构的新项目，并非实际发言');
    const snapshot = context.prepare('c', '重来一回也不会乱么？');
    const decoded = readRetrievalContext(snapshot.retrievalQuery!);
    expect(decoded?.previous).toEqual(['请讲讲分片重传和文件校验。', '一半没了怎么办？', '再往后呢？']);
    expect(snapshot.turns.at(-1)?.content).toBe('重来一回也不会乱么？');
    expect(snapshot.retrievalQuery).not.toContain('虚构');
    context.event({ type: 'gap', source: 'system', message: 'missing' });
    expect(context.prepare('after', '重来一回也不会乱么？').retrievalQuery).toBeUndefined();
  });
  it('bounds transport context, rejects malformed proposals and leaves long generation questions alone', () => {
    const value = encodeRetrievalContext(
      '当前问题'.repeat(100),
      Array.from({ length: 10 }, (_, i) => i + '前文'.repeat(100)),
    )!;
    expect(readRetrievalContext(value)?.previous.map(text => text.length)).toEqual([200, 200, 200]);
    expect(readRetrievalContext(value)?.previous.map(text => text[0])).toEqual(['7', '8', '9']);
    expect(readRetrievalContext('ordinary question')).toBeUndefined();
    expect(
      readRetrievalContext('VoxCue retrieval context v2\n{"current":"q","previous":[1]}'),
    ).toBeUndefined();
    const long = '字'.repeat(6000);
    expect(readRetrievalContext(encodeRetrievalContext(long, ['主题'])!)).toEqual({ current: long, previous: ['主题'] });
    expect(encodeRetrievalContext(long + '字', ['主题'])).toBeUndefined();
  });
});
describe('bounded root dependency bundles', () => {
  const children: KnowledgeItem[] = ['risk', 'recovery', 'other-root'].map((id, i) => ({
    itemId: id,
    documentId: 'doc',
    parentId: i === 2 ? 'different' : 'root',
    title: id,
    section: '',
    kind: 'qa',
    content: id + ' factual content',
    followUpIds: [],
  }));
  const item: KnowledgeItem = {
    itemId: 'root',
    documentId: 'doc',
    title: 'root',
    section: '',
    kind: 'qa',
    content: 'root body',
    rootContent: 'root body',
    followUps: children,
    followUpIds: ['risk', 'recovery'],
    source: {
      name: 'doc',
      format: 'md',
      updatedAt: 1,
      contentHash: 'h',
      modelVersion: 'm',
      baseId: 'base',
      revision: 'rev',
    },
  };
  const hit: KnowledgeHit = {
    itemId: 'root',
    documentId: 'doc',
    chunkId: 'chunk',
    name: 'doc',
    baseId: 'base',
    revision: 'rev',
    title: 'root',
    section: '',
    mode: 'hybrid',
    excerpt: 'root',
    similarity: 0.9,
    score: 0.5,
    grounding: { contrast: 0.5, contextual: true },
    matchedItemIds: ['risk', 'recovery'],
  };
  it('includes the recovery dependency with the failure, without a child owned by another root', () => {
    const content = buildRagContext('current', [hit], new Map([['root', item]])).evidence[0]
      .content;
    expect(content).toContain('risk factual');
    expect(content).toContain('recovery factual');
    expect(content).not.toContain('other-root');
    expect(() =>
      buildRagContext(
        'current',
        [{ ...hit, matchedItemIds: ['other-root'] }],
        new Map([['root', item]]),
      ),
    ).toThrow('身份');
    expect(() =>
      buildRagContext(
        'current',
        [{ ...hit, matchedItemIds: ['risk', 'risk'] }],
        new Map([['root', item]]),
      ),
    ).toThrow('身份');
  });
});
