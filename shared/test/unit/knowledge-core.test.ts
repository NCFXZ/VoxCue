import { describe, it, expect, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { temporaryDirectory } from '../temp';
import path from 'node:path';
import * as lance from '@lancedb/lancedb';
import { KnowledgeService } from '../../../shared/electron/backend/knowledge/service';
import { parseText, searchUnits } from '../../../shared/electron/backend/knowledge/chunks';
import type { Embedder } from '../../../shared/electron/backend/knowledge/types';
import { encodeRetrievalContext } from '../../electron/contracts/retrievalContext';
const signal = () => new AbortController().signal;
// Test-only synthetic vectors isolate storage, cancellation and content relationships.
const embedder = (): Embedder => ({
  initialize: async () => {},
  count: (text) => text.length,
  encode: async (texts) =>
    texts.map((text) =>
      Array.from({ length: 384 }, (_, i) =>
        i === 0
          ? /PID|alpha/.test(text)
            ? 1
            : 0.01
          : i === 1
            ? /Qt|beta/.test(text)
              ? 1
              : 0.01
            : 0,
      ),
    ),
  close: async () => {},
});
const input = (id: string, text: string) => ({
  documentId: id,
  baseId: 'base-a',
  name: id + '.md',
  bytes: new TextEncoder().encode(text),
});
async function directory() {
  return temporaryDirectory('rag-core');
}
describe('LanceDB 正式知识核心（真实 DB、合成测试向量）', () => {
  it('大量标题保持层级、代码块边界及父子检索关系', () => {
    const count = 2000;
    const source = Array.from({ length: count }, (_, index) =>
      `# Section ${index}\n\n## Q${index}. Question?\n\nAnswer ${index}.\n\n### 追问 1：Boundary ${index}?\n\nFollow-up ${index}.\n\n\`\`\`md\n# Not a heading\n\`\`\``,
    ).join('\n\n');
    const parsed = parseText(source, 'synthetic', 'questions.md');
    const qa = parsed.items.filter((item) => item.kind === 'qa');
    expect(qa).toHaveLength(count * 2);
    for (const index of [0, 1, count / 2, count - 1]) {
      const root = qa[index * 2], child = qa[index * 2 + 1];
      expect(root.section).toBe(`Section ${index} / Q${index}. Question?`);
      expect(root.parentId).toBeUndefined();
      expect(root.followUpIds).toEqual([child.itemId]);
      expect(child.parentId).toBe(root.itemId);
      expect(child.section).toBe(`Section ${index} / Q${index}. Question? / 追问 1：Boundary ${index}?`);
      expect(child.content).toContain('```md\n# Not a heading\n```');
    }
    const units = searchUnits(parsed.items, embedder());
    for (const index of [0, count / 2, count - 1]) {
      const root = qa[index * 2], child = qa[index * 2 + 1];
      const unit = units.find((value) => value.itemId === child.itemId)!;
      expect(unit.rootItemId).toBe(root.itemId);
      expect(unit.text).toContain('问题：Question?\n追问：');
    }
  });
  it('替换和删除释放旧文档内存缓存，保留磁盘恢复原件及其他文档', async () => {
    const root = await directory();
    const core = new KnowledgeService(root, embedder());
    const cached = core as unknown as { revisions: Map<string, unknown>; grounding?: unknown };
    try {
      await core.indexDocument(input('alpha', '## Q1. PID old?\n\nalpha original body.'), signal());
      await core.indexDocument(input('beta', '## Q1. Qt stable?\n\nbeta retained body.'), signal());
      const original = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
      const recovery = path.join(root, 'revisions', original.documents.alpha.revision);
      const originalBytes = await readFile(recovery);
      await core.search('PID old', 5, 'keyword', signal());
      await core.search('Qt stable', 5, 'keyword', signal());
      expect(cached.revisions.size).toBe(2);
      for (let revision = 0; revision < 3; revision++) {
        await core.indexDocument(input('alpha', `## Q1. PID new?\n\nalpha replacement ${revision}.`), signal());
        const hits = await core.search('PID new', 5, 'keyword', signal());
        expect((await core.getItem(hits[0].itemId))?.content).toContain(`replacement ${revision}`);
        expect(cached.revisions.size).toBe(2);
      }
      await core.search('PID new', 5, 'hybrid', signal(), 'base-a', { rawLimit: 20, grounded: true });
      expect(cached.grounding).toBeDefined();
      await core.removeDocument('alpha', signal());
      expect(cached.revisions.size).toBe(1);
      expect(cached.grounding).toBeUndefined();
      expect(await core.search('PID new', 5, 'keyword', signal())).toEqual([]);
      const beta = await core.search('Qt stable', 5, 'keyword', signal());
      expect((await core.getItem(beta[0].itemId))?.content).toContain('retained body');
      expect(await readFile(recovery)).toEqual(originalBytes);
    } finally {
      await core.close();
    }
  });
  it('prioritizes current identity, reserves comparison sources and rejects an absent project', async () => {
    const core = new KnowledgeService(await directory(), embedder());
    try {
      await core.indexDocument(
        input(
          'dominant',
          Array.from(
            { length: 40 },
            (_, i) =>
              `## Q${i + 1}. 松鹤项目第${i + 1}路方案？\n\n松鹤项目第${i + 1}路保留独立批次记录。`,
          ).join('\n\n'),
        ),
        signal(),
      );
      await core.indexDocument(
        input('second', '## Q1. 青栎项目如何恢复？\n\n青栎项目恢复先核对摘要。'),
        signal(),
      );
      await core.indexDocument(
        input(
          'current',
          '## Q1. VectorRouter如何分流？\n\nVectorRouter按分区分流。\n\n## Q2. VectorRouter如何确认？\n\nVectorRouter维护确认窗口。',
        ),
        signal(),
      );
      const version = await core.version('base-a', signal());
      const comparison = await core.search(
        '松鹤项目参数怎么取，青栎项目恢复怎么做？',
        12,
        'hybrid',
        signal(),
        'base-a',
        { rawLimit: 60, grounded: true },
      );
      expect(new Set(comparison.slice(0, 5).map((h) => h.documentId))).toEqual(
        new Set(['dominant', 'second']),
      );
      const previous = ['松鹤项目第1路方案如何处理？'];
      const current = await core.search(
        encodeRetrievalContext('VectorRouter如何分流？', previous)!,
        12,
        'hybrid',
        signal(),
        'base-a',
        { rawLimit: 60, grounded: true, history: previous },
      );
      expect(current.length).toBeGreaterThan(0);
      expect(current.every((hit) => hit.documentId === 'current')).toBe(true);
      const absent = await core.search(
        encodeRetrievalContext('不是松鹤，改问AuroraDesk项目的指标。', previous)!,
        12,
        'hybrid',
        signal(),
        'base-a',
        { rawLimit: 60, grounded: true, history: previous },
      );
      expect(absent).toEqual([]);
      expect(await core.version('base-a', signal())).toBe(version);
    } finally {
      await core.close();
    }
  });
  it('committed versions and matched children remain scoped across update, disable and restart', async () => {
    const root = await directory(),
      traces: any[] = [];
    let core = new KnowledgeService(root, embedder(), undefined, undefined, (trace) =>
      traces.push(trace),
    );
    try {
      await core.indexDocument(
        input(
          'alpha',
          '## Q001. PID principle?\n\nPID root.\n\n### 追问 1：PID saturation?\n\nSaturation limit.\n\n### 追问 2：PID optimize?\n\nFilter derivative.',
        ),
        signal(),
      );
      const version = await core.version('base-a', signal());
      const hits = await core.search('PID saturation', 12, 'hybrid', signal(), 'base-a', {
        rawLimit: 60,
      });
      expect(hits[0].matchedItemId).toBeTruthy();
      expect(hits[0].revision).toMatch(/^[a-f0-9]{64}$/);
      const expected = { baseId: 'base-a', documentId: 'alpha', revision: hits[0].revision! };
      const item = await core.getItem(hits[0].itemId, signal(), expected);
      expect(item?.rootContent).toContain('PID root');
      expect(item?.content).toContain('Filter derivative');
      expect(
        await core.getItem(hits[0].itemId, signal(), { ...expected, baseId: 'base-b' }),
      ).toBeNull();
      expect(traces[0]).toMatchObject({ distinctRoots: 1, hits: [hits[0].itemId] });
      expect(JSON.stringify(traces[0])).not.toContain('Saturation limit');
      await core.close();
      core = new KnowledgeService(root, embedder());
      expect(await core.version('base-a', signal())).toBe(version);
      await core.indexDocument(input('alpha', '## Q001. PID new revision?\n\nNew body.'), signal());
      expect(await core.version('base-a', signal())).not.toBe(version);
      expect(await core.getItem(hits[0].itemId, signal(), expected)).toBeNull();
      const updated = await core.version('base-a', signal());
      await core.invalidateDocument('alpha', signal());
      expect(await core.version('base-a', signal())).not.toBe(updated);
    } finally {
      await core.close();
    }
  });
  it('topic token checks do not add query encodes; oversize hints fall back within 512 tokens', async () => {
    const encoder = embedder();
    encoder.encode = vi.fn(encoder.encode);
    const core = new KnowledgeService(await directory(), encoder);
    try {
      const long = 'x'.repeat(900);
      expect(await core.prepareQuery(long, 'PID current', signal())).toBe('PID current');
      expect(
        (await core.prepareQuery(long, 'PID ' + long + ' correction', signal())).length,
      ).toBeLessThanOrEqual(512);
      expect(encoder.encode).not.toHaveBeenCalled();
    } finally {
      await core.close();
    }
  });
  it.each([null, [], { schemaVersion: 99, documents: {} }])(
    '参数和损坏配置 %j 保留不可回退的错误码',
    async (catalog) => {
      const root = await directory();
      const core = new KnowledgeService(root, embedder());
      try {
        await expect(
          core.search('PID', 5, 'hybrid', signal(), 'constructor'),
        ).rejects.toMatchObject({
          code: 'invalid_request',
        });
      } finally {
        await core.close();
      }
      await writeFile(path.join(root, 'catalog.json'), JSON.stringify(catalog));
      const incompatible = new KnowledgeService(root, embedder());
      try {
        await expect(incompatible.search('PID', 5, 'hybrid', signal())).rejects.toMatchObject({
          code: 'configuration',
        });
      } finally {
        await incompatible.close();
      }
    },
  );
  it('离线重复查询每次重新编码并执行真实数据库检索', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    try {
      await core.indexDocument(
        input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数37。'),
        signal(),
      );
      const cold: number[] = [],
        warm: number[] = [];
      for (let index = 0; index < 20; index++) {
        const start = performance.now();
        await core.search('PID query ' + index, 5, 'hybrid', signal());
        cold.push(performance.now() - start);
      }
      const expected = await core.search('PID sensor', 5, 'hybrid', signal());
      const table = (core as unknown as { table: lance.Table }).table;
      const searches = vi.spyOn(table, 'vectorSearch');
      const before = encode.mock.calls.filter((call) => call[1] === 'query').length;
      for (let index = 0; index < 100; index++) {
        const start = performance.now();
        const hits = await core.search('PID sensor', 5, 'hybrid', signal());
        warm.push(performance.now() - start);
        expect(hits).toEqual(expected);
      }
      expect(encode.mock.calls.filter((call) => call[1] === 'query')).toHaveLength(before + 100);
      expect(searches).toHaveBeenCalledTimes(100);
      const p95 = (values: number[]) =>
        +values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)].toFixed(3);
      console.log(
        'OFFLINE_RETRIEVAL_MS ' +
          JSON.stringify({
            coldP95: p95(cold),
            warmP95: p95(warm),
            repeatedQueries: warm.length,
            additionalEncodes: 100,
            syntheticVectors: true,
          }),
      );
    } finally {
      await core.close();
    }
  });
  it('相同查询每次检索，参数、知识库隔离，调用方修改不污染后续结果', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const queryCount = () => encode.mock.calls.filter((call) => call[1] === 'query').length;
    try {
      await core.indexDocument(
        input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数37。'),
        signal(),
      );
      await core.indexDocument(
        { ...input('beta', '## Q001. PID sensor?\n\nbeta PID 参数42。'), baseId: 'base-b' },
        signal(),
      );
      const [first, concurrent] = await Promise.all([
        core.search('PID sensor', 5, 'hybrid', signal(), 'base-a'),
        core.search('PID sensor', 5, 'hybrid', signal(), 'base-a'),
      ]);
      expect(queryCount()).toBe(2);
      expect(first).toEqual(concurrent);
      first[0].title = '被调用方改写';
      concurrent.length = 0;
      expect(
        (await core.search('PID sensor', 5, 'hybrid', signal(), 'base-a'))[0].title,
      ).not.toContain('改写');
      expect(queryCount()).toBe(3);
      expect((await core.search('PID sensor', 5, 'hybrid', signal(), 'base-b'))[0].documentId).toBe(
        'beta',
      );
      await core.search('PID sensor', 1, 'hybrid', signal(), 'base-a');
      await core.search('PID sensor', 5, 'vector', signal(), 'base-a');
      await core.search('PID sensor ', 5, 'hybrid', signal(), 'base-a');
      expect(queryCount()).toBe(7);
      const keyword = await core.search('PID', 5, 'keyword', signal(), 'base-a');
      expect(keyword[0].mode).toBe('keyword');
      const table = (core as unknown as { table: lance.Table }).table;
      const keywordSearches = vi.spyOn(table, 'query');
      expect(await core.search('PID', 5, 'keyword', signal(), 'base-a')).toEqual(keyword);
      expect(await core.search('PID', 5, 'keyword', signal(), 'base-a')).toEqual(keyword);
      expect(keywordSearches).toHaveBeenCalledTimes(2);
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(
        core.search('PID sensor', 5, 'hybrid', cancelled.signal, 'base-a'),
      ).rejects.toThrow();
      await expect(core.search('PID sensor', 5, 'hybrid', signal(), "bad'base")).rejects.toThrow();
      expect(queryCount()).toBe(7);
    } finally {
      await core.close();
    }
  });
  it('资料更新、停用、重新索引、删除和模型卸载保持正确，失败或取消后重新检索', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const search = () => core.search('PID sensor', 5, 'hybrid', signal());
    const original = input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数37。');
    try {
      await core.indexDocument(original, signal());
      const before = await search();
      await core.updateDocument(
        input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数42。'),
        signal(),
      );
      const updated = await search();
      expect(updated[0].excerpt).toContain('参数42');
      expect(await core.getItem(before[0].itemId)).toBeNull();
      expect((await core.getItem(updated[0].itemId))!.content).toContain('参数42');
      await core.invalidateDocument('alpha', signal());
      expect(await search()).toEqual([]);
      await core.indexDocument(original, signal());
      expect((await search())[0].excerpt).toContain('参数37');
      const queries = () => encode.mock.calls.filter((call) => call[1] === 'query').length;
      const prior = queries();
      await core.unloadModel();
      expect(await search()).toHaveLength(1);
      expect(queries()).toBe(prior + 1);
      encode.mockRejectedValueOnce(Error('合成检索失败'));
      await expect(core.search('PID sensor retry', 5, 'hybrid', signal())).rejects.toThrow(
        '合成检索失败',
      );
      const afterFailure = queries();
      await core.search('PID sensor retry', 5, 'hybrid', signal());
      expect(queries()).toBe(afterFailure + 1);
      const aborted = new AbortController();
      const originalEncode = vectors.encode;
      vectors.encode = async (...args) => {
        const result = await originalEncode(...args);
        aborted.abort();
        return result;
      };
      await expect(
        core.search('PID sensor cancelled', 5, 'hybrid', aborted.signal),
      ).rejects.toThrow();
      vectors.encode = originalEncode;
      const afterAbort = queries();
      await core.search('PID sensor cancelled', 5, 'hybrid', signal());
      expect(queries()).toBe(afterAbort + 1);
      await core.removeDocument('alpha', signal());
      expect(await search()).toEqual([]);
      await core.close();
      await expect(search()).rejects.toThrow('已关闭');
    } finally {
      await core.close();
    }
  });
  it('连续重复检索始终重新执行，每个知识核心实例保持独立', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const other = new KnowledgeService(await directory(), embedder());
    try {
      await core.indexDocument(
        input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数37。'),
        signal(),
      );
      await other.indexDocument(
        input('beta', '## Q001. PID sensor?\n\nbeta PID 参数42。'),
        signal(),
      );
      await core.search('PID sensor', 5, 'vector', signal());
      expect((await other.search('PID sensor', 5, 'vector', signal()))[0].documentId).toBe('beta');
      for (let index = 0; index < 64; index++)
        await core.search('PID cache ' + index, 5, 'vector', signal());
      const before = encode.mock.calls.filter((call) => call[1] === 'query').length;
      await core.search('PID sensor', 5, 'vector', signal());
      expect(encode.mock.calls.filter((call) => call[1] === 'query')).toHaveLength(before + 1);
    } finally {
      await core.close();
      await other.close();
    }
  });
  it('口语查询每次原样检索，不把语气词、否定或纠正合并成旧问题', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    try {
      await core.indexDocument(input('alpha', '# PID\n\nalpha PID 使用条件。'), signal());
      const queries = [
        'PID sensor',
        '嗯PID sensor',
        'PID sensor呢',
        '不是PID sensor',
        '呃刚说岔了PID sensor',
      ];
      for (const query of queries) await core.search(query, 5, 'vector', signal());
      expect(
        encode.mock.calls.filter((call) => call[1] === 'query').map((call) => call[0][0]),
      ).toEqual(queries);
      const before = encode.mock.calls.length;
      for (const query of queries) await core.search(query, 5, 'vector', signal());
      expect(encode.mock.calls).toHaveLength(before + queries.length);
      expect(
        encode.mock.calls.filter((call) => call[1] === 'query').map((call) => call[0][0]),
      ).toEqual([...queries, ...queries]);
    } finally {
      await core.close();
    }
  });
  it('长口语查询重复执行，不因查询新旧而跳过检索', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const query = (index: number) => 'PID ' + '哈'.repeat(5900) + index;
    const queryCount = () => encode.mock.calls.filter((call) => call[1] === 'query').length;
    try {
      await core.indexDocument(input('alpha', '# PID\n\nalpha PID 使用条件。'), signal());
      for (let index = 0; index < 40; index++)
        await core.search(query(index), 5, 'vector', signal());
      const before = queryCount();
      await core.search(query(39), 5, 'vector', signal());
      expect(queryCount()).toBe(before + 1);
      await core.search(query(0), 5, 'vector', signal());
      expect(queryCount()).toBe(before + 2);
      expect(encode.mock.calls.at(-1)?.[0]).toEqual([query(0)]);
    } finally {
      await core.close();
    }
  });
  it('并发更新与查询按顺序读取当前提交，失败更新保留可用旧结果', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const search = () => core.search('PID sensor', 5, 'vector', signal());
    try {
      await core.indexDocument(input('alpha', '# PID\n\nalpha PID 参数37。'), signal());
      await search();
      const [before, , after] = await Promise.all([
        search(),
        core.updateDocument(input('alpha', '# PID\n\nalpha PID 参数42。'), signal()),
        search(),
      ]);
      expect(before[0].excerpt).toContain('参数37');
      expect(after[0].excerpt).toContain('参数42');
      encode.mockRejectedValueOnce(Error('合成索引失败'));
      await expect(
        core.updateDocument(input('alpha', '# PID\n\nalpha PID 参数99。'), signal()),
      ).rejects.toThrow('合成索引失败');
      expect((await search())[0].excerpt).toContain('参数42');
      expect((await core.getItem(after[0].itemId))?.content).toContain('参数42');
    } finally {
      await core.close();
    }
  });
  it('卸载模型保留资料原件、索引与打开的文档列表', async () => {
    const dir = await directory(),
      vectors = embedder();
    let releases = 0;
    vectors.close = async () => {
      releases++;
    };
    const core = new KnowledgeService(dir, vectors);
    try {
      await core.indexDocument(input('alpha', '# PID\n\nOriginal document.'), signal());
      const catalog = await readFile(path.join(dir, 'catalog.json'));
      const documents = await core.listDocuments();
      await core.unloadModel();
      expect(releases).toBe(1);
      expect(await readFile(path.join(dir, 'catalog.json'))).toEqual(catalog);
      expect(await core.listDocuments()).toEqual(documents);
      expect((await core.search('PID', 5, 'hybrid', signal()))[0].documentId).toBe('alpha');
    } finally {
      await core.close();
    }
  });
  it('中英混合三模式、完整追问、重复导入、更新、删除及重启', async () => {
    const dir = await directory();
    let core = new KnowledgeService(dir, embedder());
    const a = input(
      'alpha',
      '# Alpha\n\n## Q001. How does PID 控制 sensor 提离?\n\nlegacyalpha uses PID for lift-off.\n\n### 追问 1：怎样限幅？\n\n限制输出并保留完整尾段。',
    );
    try {
      const first = await core.indexDocument(a, signal());
      expect((await core.indexDocument(a, signal())).updatedAt).toBe(first.updatedAt);
      await core.indexDocument(
        input('beta', '# Qt\n\n## Q001. Qt thread 怎么运行？\n\nbeta queued signal.'),
        signal(),
      );
      for (const mode of ['keyword', 'vector', 'hybrid'] as const) {
        const hits = await core.search('PID sensor 提离', 5, mode, signal());
        expect(hits[0].documentId).toBe('alpha');
        expect((await core.getItem(hits[0].itemId))!.content).toContain('完整尾段');
      }
      await core.close();
      core = new KnowledgeService(dir, embedder());
      expect((await core.listDocuments()).length).toBe(2);
      await core.updateDocument(
        input(
          'alpha',
          '# Alpha\n\n## Q001. PID sensor 如何调整？\n\nnewalpha PID controls lift-off.',
        ),
        signal(),
      );
      expect(await core.search('legacyalpha', 5, 'keyword', signal())).toEqual([]);
      expect((await core.search('newalpha', 5, 'keyword', signal()))[0].documentId).toBe('alpha');
      await core.removeDocument('alpha', signal());
      expect(await core.search('newalpha', 5, 'keyword', signal())).toEqual([]);
      expect((await core.listDocuments()).map((d) => d.documentId)).toEqual(['beta']);
    } finally {
      await core.close();
    }
  });
  it('未提交的数据版本不污染恢复；下次写入从已提交快照恢复', async () => {
    const dir = await directory();
    let core = new KnowledgeService(dir, embedder());
    await core.indexDocument(
      input('alpha', '# Alpha\n\n## Q001. PID sensor?\n\nlegacyalpha PID.'),
      signal(),
    );
    await core.close();
    const catalog = JSON.parse(await readFile(path.join(dir, 'catalog.json'), 'utf8'));
    const db = await lance.connect(path.join(dir, 'lance')),
      table = await db.openTable(catalog.tableName);
    await table.delete("documentId = 'alpha'");
    table.close();
    db.close();
    core = new KnowledgeService(dir, embedder());
    try {
      expect((await core.search('legacyalpha', 5, 'keyword', signal())).length).toBeGreaterThan(0);
      await core.indexDocument(
        input('beta', '# beta\n\n## Q001. Qt thread?\n\nbeta Qt signal.'),
        signal(),
      );
      expect((await core.search('legacyalpha', 5, 'keyword', signal()))[0].documentId).toBe(
        'alpha',
      );
    } finally {
      await core.close();
    }
  });
  it('失败与取消不覆盖旧文档，非法 ID 不进入 SQL', async () => {
    const dir = await directory(),
      core = new KnowledgeService(dir, embedder());
    try {
      await core.indexDocument(
        input('alpha', '# Alpha\n\n## Q001. PID sensor?\n\nlegacyalpha PID.'),
        signal(),
      );
      const abort = new AbortController();
      abort.abort();
      await expect(core.updateDocument(input('alpha', 'replaced'), abort.signal)).rejects.toThrow();
      await expect(core.indexDocument(input("x' OR 1=1", 'malicious'), signal())).rejects.toThrow(
        '无效',
      );
      expect((await core.search('legacyalpha', 5, 'keyword', signal()))[0].documentId).toBe(
        'alpha',
      );
    } finally {
      await core.close();
    }
  });
  it('长答案检索分片覆盖尾部、每片满足上限，完整答案只保存一份', () => {
    const body = '尾部重要参数 '.repeat(300),
      parsed = parseText('## Q001. 如何控制？\n\n' + body, 'a', 'a.md');
    const units = searchUnits(parsed.items, embedder());
    expect(units.length).toBeGreaterThan(1);
    expect(units.every((u) => u.text.length <= 512)).toBe(true);
    expect(units.map((u) => u.text.replace(/^问题：[^\n]*\n/, '')).join('')).toBe(body.trim());
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].answer).toBe(body.trim());
  });
  it('损坏 catalog 明确失败并保留文件', async () => {
    const dir = await directory(),
      file = path.join(dir, 'catalog.json');
    await writeFile(file, 'broken');
    const core = new KnowledgeService(dir, embedder());
    try {
      await expect(core.initialize()).rejects.toThrow('损坏');
      expect(await readFile(file, 'utf8')).toBe('broken');
    } finally {
      await core.close();
    }
  });
  it('替换前停用旧索引；失败、取消和重启均不得继续返回旧资料', async () => {
    const dir = await directory();
    let core = new KnowledgeService(dir, embedder());
    const a = input('alpha', '## Q001. PID sensor?\n\nlegacyalpha PID parameters.');
    await core.indexDocument(a, signal());
    const id = (await core.search('legacyalpha', 5, 'keyword', signal()))[0].itemId;
    await core.invalidateDocument('alpha', signal());
    expect(await core.search('legacyalpha', 5, 'keyword', signal())).toEqual([]);
    expect(await core.getItem(id)).toBeNull();
    await core.close();
    core = new KnowledgeService(dir, embedder());
    try {
      expect(await core.search('legacyalpha', 5, 'keyword', signal())).toEqual([]);
      expect((await core.listDocuments())[0].available).toBe(false);
      await core.indexDocument(
        input('alpha', '## Q001. PID sensor?\n\nnewalpha PID parameters.'),
        signal(),
      );
      expect(await core.search('legacyalpha', 5, 'keyword', signal())).toEqual([]);
      expect((await core.search('newalpha', 5, 'keyword', signal()))[0].documentId).toBe('alpha');
    } finally {
      await core.close();
    }
  });
  it('纯文本 Q&A 建立追问关系，普通段落保持代码块完整与来源层级', () => {
    const qa = parseText(
      'Q1. PID 如何调节？\n\n完整答案。\n\n追问 1：如何限幅？\n\n限幅为 2。',
      'qa',
      'qa.txt',
    );
    expect(qa.items[0].followUpIds).toEqual([qa.items[1].itemId]);
    expect(qa.items[1].parentId).toBe(qa.items[0].itemId);
    const code = '```ts\n' + 'const value = 37;\n\n'.repeat(100) + '```';
    const ordinary = parseText(
      '# Parent\n\n## First\n\n' +
        '第一段文字。'.repeat(300) +
        '\n\n' +
        code +
        '\n\n## Second\n\n第二段解释。',
      'doc',
      'doc.md',
    );
    expect(ordinary.items.filter((i) => i.content.includes('```'))).toHaveLength(1);
    expect(ordinary.items.find((i) => i.content.includes('```'))!.content).toContain(code);
    expect(ordinary.items.at(-1)!.section).toBe('Parent / Second');
  });
});
