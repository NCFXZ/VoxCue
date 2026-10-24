import { describe, expect, it } from 'vitest';
import {
  GroundingProfile,
  interleaveSources,
  type GroundDocument,
} from '../../electron/backend/knowledge/grounding';
import {
  encodeRetrievalContext,
  readRetrievalContext,
} from '../../electron/contracts/retrievalContext';
import { InterviewContext } from '../../electron/application/interviewContext';
import { buildRagContext } from '../../electron/application/ragContext';
import type { KnowledgeHit, KnowledgeItem } from '../../electron/contracts/knowledge';

const document = (id: string, headings: string[]): GroundDocument => ({
  id,
  title: id + '.md',
  items: headings.map((title, i) => ({
    itemId: id + ':' + i,
    documentId: id,
    title,
    section: '',
    kind: 'qa',
    content: title + '\n' + title,
    followUpIds: [],
  })),
});
describe('corpus-owned retrieval scopes', () => {
  it('uses document identity across free heading prose and does not learn names from cross mentions', () => {
    const profile = new GroundingProfile(
      [
        document('first', ['请介绍白瓷项目的方案？', '在白瓷项目里得到什么结果？']),
        {
          ...document('second', ['玄鹭项目怎么做？', '能说说玄鹭项目的验证吗？']),
          items: document('second', ['玄鹭项目怎么做？', '能说说玄鹭项目的验证吗？']).items.map(
            (i) => ({ ...i, content: i.content + '结果不属于白瓷。' }),
          ),
        },
        document('technical', ['JWT签名验证是什么？', '如何验证JWT退出？']),
        document('other', ['布隆过滤器如何工作？', '如何验证布隆过滤器？']),
      ],
      [],
    );
    expect(profile.mentions('白瓷后续如何处理？')).toEqual(['first']);
    expect(profile.mentions('比较白瓷跟玄鹭')).toEqual(['first', 'second']);
    expect(profile.mentions('怎么验证一下？')).toEqual([]);
    expect(profile.isProject('technical')).toBe(false);
  });
  it('keeps close names distinct instead of borrowing a shared prefix', () => {
    const profile = new GroundingProfile(
      [
        document('a', ['海棠北项目方案？', '海棠北项目结果？']),
        document('b', ['海棠南项目方案？', '海棠南项目结果？']),
      ],
      [],
    );
    expect(profile.mentions('海棠北有多少人？')).toEqual(['a']);
    expect(profile.mentions('海棠另一个版本')).toEqual([]);
  });
  it('isolates named projects that share one physical source document', () => {
    const mixed = document('mixed', ['海棠北项目如何上传？', '海棠南项目如何上传？']);
    mixed.items[0].content = '## 海棠北项目如何上传？\n海棠北采用断点续传。';
    mixed.items[1].content = '## 海棠南项目如何上传？\n海棠南采用完整上传。';
    const profile = new GroundingProfile(
      [mixed, document('reference', ['如何验证上传？', '上传的校验方法？'])],
      [],
    );
    expect(profile.restrictRoots('海棠北怎么恢复？', [], ['mixed'])).toEqual(['mixed:0']);
    expect(profile.restrictRoots('那恢复呢？', ['海棠南项目如何上传？'], ['mixed'])).toEqual([
      'mixed:1',
    ]);
    expect(profile.restrictRoots('比较海棠北和海棠南', [], ['mixed'])).toEqual([
      'mixed:0',
      'mixed:1',
    ]);
    expect(profile.restrictRoots('海棠别的项目呢？', [], ['mixed'])).toEqual([]);
  });
  it('does not let a project consume the identity of a shared technical subject', () => {
    const tech = document('technical', ['PID控制如何工作？', 'PID控制有什么局限？']);
    const project = document('project', ['白瓷项目如何使用PID？', '白瓷项目PID结果如何？']);
    const profile = new GroundingProfile([tech, project], []);
    expect(profile.mentions('PID的实现')).toEqual(['technical']);
    expect(profile.mentions('白瓷项目呢？')).toEqual(['project']);
  });
  it('keeps a heading-owned identifier when another body merely mentions it', () => {
    const owner = document('owner', ['DeltaChannel如何传输？', '重连确认有哪些状态？']);
    const other = document('other', ['NebulaStore如何落盘？', 'NebulaStore如何恢复？']);
    other.items[0].content += '\n也可给DeltaChannel提供数据。';
    const profile = new GroundingProfile([owner, other], []);
    expect(profile.subjects('DeltaChannel现在怎么处理？')).toEqual(['owner']);
    expect(profile.subjects('DeltaChannel如何传输，NebulaStore如何恢复？')).toEqual([
      'owner',
      'other',
    ]);
  });
  it('retains both requested project clauses and the latest correction subject', () => {
    const profile = new GroundingProfile(
      [
        document('a', ['枫蓝项目怎么部署？', '枫蓝项目如何恢复？']),
        document('b', ['玄涧项目怎么部署？', '玄涧项目如何恢复？']),
      ],
      [],
    );
    expect(profile.subjects('枫蓝如何部署，玄涧如何恢复？')).toEqual(['a', 'b']);
    expect(profile.subjects('先放下枫蓝，玄涧接着介绍。')).toEqual(['b']);
    expect(profile.unknownProject('不是枫蓝，现在问OrionEdge项目。')).toBe(true);
    expect(profile.unknownProject('枫蓝讲过了，瑛琬项目呢？')).toBe(true);
    expect(profile.unknownProject('枫蓝项目如何恢复？')).toBe(false);
    expect(profile.unknownProject('这个项目如何恢复？')).toBe(false);
    expect(profile.unknownProject('依据枫蓝的资料，给出该项目的参数。')).toBe(false);
  });
  it('checks a current subject against headings rather than generic answer prose', () => {
    const profile = new GroundingProfile(
      [
        document('a', ['几何压缩如何编码？', '几何压缩怎么恢复？']),
        document('b', ['顺序分片如何传输？', '顺序分片怎么确认？']),
      ],
      [],
    );
    expect(profile.identifies('现在讨论几何压缩的边界', 'a')).toBe(true);
    expect(profile.identifies('那后面呢，再详细一点', 'a')).toBe(false);
  });
  it('reserves early candidate slots for every source under a dominant source', () => {
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => ({ source: 'a', value: i })),
      { source: 'b', value: 100 },
      { source: 'c', value: 200 },
      { source: 'b', value: 101 },
    ];
    const selected = interleaveSources(rows, (r) => r.source);
    expect(selected.slice(0, 3).map((r) => r.source)).toEqual(['a', 'b', 'c']);
    expect(selected.filter((r) => r.source === 'a').map((r) => r.value)).toEqual(
      Array.from({ length: 60 }, (_, i) => i),
    );
    expect(new Set(selected).size).toBe(rows.length);
    expect(interleaveSources([], String)).toEqual([]);
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
    expect(decoded?.previous).toEqual(['请讲讲分片重传和文件校验。', '一半没了怎么办？']);
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
    expect(value.length).toBeLessThanOrEqual(1000);
    expect(readRetrievalContext(value)?.previous.length).toBeLessThanOrEqual(6);
    expect(readRetrievalContext('ordinary question')).toBeUndefined();
    expect(
      readRetrievalContext('VoxCue retrieval context v2\n{"current":"q","previous":[1]}'),
    ).toBeUndefined();
    expect(encodeRetrievalContext('字'.repeat(701), ['主题'])).toBeUndefined();
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
