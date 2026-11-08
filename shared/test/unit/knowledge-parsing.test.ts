import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { parseDocument } from '../../../shared/electron/backend/knowledge/parser';
import { validateKnowledge } from '../../../shared/electron/application/knowledge';
const fixtures = createRequire(import.meta.url)('../scripts/rag-fixtures.cjs');
const input = (name: string, bytes: Uint8Array) => ({
  documentId: 'parse-a',
  baseId: 'base',
  name,
  bytes,
});
describe('本地解析与入口校验', () => {
  it('真实 Node PDF 解析保留页码及每页内容；损坏文件和未支持的 Office 明确失败', async () => {
    const parsed = await parseDocument(input('a.pdf', fixtures.pdf()));
    expect(parsed.items.map((item) => item.page)).toEqual([1, 2]);
    expect(parsed.text).toContain('37');
    const qa = await parseDocument(
      input(
        'qa.pdf',
        fixtures.pdf([
          'Q1. How is sensor lift-off controlled?',
          'The complete answer is PID with tail parameter 37.',
        ]),
      ),
    );
    expect(qa.items).toHaveLength(1);
    expect(qa.items[0]).toMatchObject({ kind: 'qa', page: 1, endPage: 2 });
    expect(qa.items[0].content).toContain('tail parameter 37');
    await expect(parseDocument(input('broken.pdf', Buffer.from('bad bytes')))).rejects.toThrow(
      'PDF 解析失败',
    );
    await expect(parseDocument(input('a.ppt', Buffer.from('original')))).rejects.toThrow(
      '仅支持 PDF、Word、TXT 和 Markdown。',
    );
  });
  it('DOCX 保留段落；非 UTF-8 文本不会静默乱码', async () => {
    expect((await parseDocument(input('a.docx', await fixtures.docx()))).text).toContain(
      '中文 DOCX sensor feedback.\n\nSecond paragraph',
    );
    await expect(parseDocument(input('a.txt', new Uint8Array([255, 254, 65])))).rejects.toThrow(
      'UTF-8',
    );
  });
  it('拒绝任意路径、SQL、伪造字段、字节越界和无效 mode', () => {
    for (const call of [
      { op: 'search', query: 'PID' },
      { op: 'cancel' },
      { op: 'import', requestId: 'r', name: 'a.md', bytes: new Uint8Array([1]) },
      { op: 'sql', query: 'select *' },
      { op: 'status', path: 'C:\\private' },
      {
        op: 'import',
        requestId: 'r',
        documentId: 'd',
        baseId: 'b',
        name: '../x.md',
        bytes: new Uint8Array([1]),
      },
      { op: 'search', requestId: 'r', query: 'a', topK: 21 },
      { op: 'settings', mode: 'invented' },
    ])
      expect(() => validateKnowledge(call)).toThrow();
    expect(
      validateKnowledge({
        op: 'search',
        requestId: 'r',
        query: 'PID sensor 控制',
        mode: 'hybrid',
        topK: 5,
      }),
    ).toMatchObject({ op: 'search' });
  });
});
