import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { temporaryDirectory } from '../temp';
import path from 'node:path';
import * as lance from '@lancedb/lancedb';
import { KnowledgeService } from '../../../shared/electron/backend/knowledge/service';
import { parseText, searchUnits } from '../../../shared/electron/backend/knowledge/chunks';
import type { Embedder } from '../../../shared/electron/backend/knowledge/types';
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
