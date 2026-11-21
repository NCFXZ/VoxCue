import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { temporaryDirectory } from '../temp';
import { KnowledgeService } from '../../electron/backend/knowledge/service';
import type { Embedder } from '../../electron/backend/knowledge/types';

const load = createRequire(import.meta.url);
const fixtures = load('../scripts/rag-fixtures.cjs');
const receipt = `receipt${randomUUID().replaceAll('-', '')}`;
const makeDoc = () => fixtures.doc(`临时装运单\rReceiving desk\r项目\x07签收编号\x07\rCrate\x07${receipt}\x07\r`);
const input = (bytes: Uint8Array, name = 'fixture.doc') => ({
  documentId: 'legacy-doc',
  baseId: 'legacy-base',
  name,
  bytes,
});

function directoryFixture(entries: number) {
  const original: Buffer = makeDoc();
  const firstExtra = original.length / 512 - 1;
  const extra = Math.ceil(entries / 4) - 1;
  const bytes = Buffer.alloc(original.length + extra * 512);
  original.copy(bytes);
  const fat = bytes.subarray(1024, 1536);
  fat.writeInt32LE(extra ? firstExtra : -2, 0);
  for (let index = 0; index < extra; index++)
    fat.writeInt32LE(index + 1 === extra ? -2 : firstExtra + index + 1, (firstExtra + index) * 4);
  const entry = (index: number) => {
    const sector = index < 4 ? 0 : firstExtra + Math.floor(index / 4) - 1;
    const offset = (sector + 1) * 512 + (index % 4) * 128;
    return bytes.subarray(offset, offset + 128);
  };
  const storage = (index: number) => {
    const data = entry(index);
    const name = Buffer.from(`Storage${index}\0`, 'utf16le');
    name.copy(data);
    data.writeUInt16LE(name.length, 64);
    data[66] = 1;
    data[67] = 1;
    for (const offset of [68, 72, 76]) data.writeInt32LE(-1, offset);
    data.writeInt32LE(-2, 116);
    return data;
  };
  return { bytes, entry, storage };
}

async function parser() {
  const directory = await temporaryDirectory('legacy-doc');
  const backend = path.join(directory, 'backend/knowledge');
  await mkdir(backend, { recursive: true });
  await mkdir(path.join(directory, 'contracts'));
  // Run actual CommonJS workers without requiring a stale workspace build.
  for (const name of [
    'backend/knowledge/parser',
    'backend/knowledge/chunks',
    'backend/knowledge/legacyDoc',
    'backend/knowledge/legacyDocWorker',
    'backend/knowledge/textEncoding',
    'backend/knowledge/docxArchive',
    'contracts/knowledge',
  ]) {
    const source = await readFile(new URL(`../../electron/${name}.ts`, import.meta.url), 'utf8');
    await writeFile(
      path.join(directory, name + '.js'),
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText,
    );
  }
  return {
    directory,
    parse: load(path.join(backend, 'parser.js'))
      .parseDocument as typeof import('../../electron/backend/knowledge/parser').parseDocument,
  };
}

describe('旧版 DOC 真实二进制解析与索引', () => {
  it('保留中英文段落、表格文字并进入真实 LanceDB 关键词检索', async () => {
    const { directory, parse } = await parser();
    const bytes = makeDoc();
    const parsed = await parse(input(bytes, 'fixture.DOC'));
    expect(parsed.text).toContain('临时装运单\nReceiving desk');
    expect(parsed.text).toContain('项目\t签收编号');
    expect(parsed.text).toContain(`Crate\t${receipt}`);
    const embedder: Embedder = {
      initialize: async () => {},
      count: (text) => text.length,
      encode: async (texts) =>
        texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))),
      close: async () => {},
    };
    const core = new KnowledgeService(path.join(directory, 'index'), embedder, () => {}, parse);
    const signal = new AbortController().signal;
    try {
      const indexed = await core.indexDocument(input(bytes), signal);
      expect(indexed.chunkCount).toBeGreaterThan(0);
      const hits = await core.search(receipt, 5, 'keyword', signal, 'legacy-base');
      expect(hits[0].documentId).toBe('legacy-doc');
      expect((await core.getItem(hits[0].itemId))?.content).toContain(receipt);
    } finally {
      await core.close();
    }
  });

  it('读取压缩英文片段与 1Table，不把 DOCX 改后缀当作 DOC', async () => {
    const { parse } = await parser();
    const parsed = await parse(
      input(
        fixtures.doc(`Dispatch note ${receipt}.\r`, {
          compressed: true,
          tableStream: '1Table',
        }),
      ),
    );
    expect(parsed.text).toContain(`Dispatch note ${receipt}.`);
    await expect(parse(input(await fixtures.docx([receipt])))).rejects.toThrow('DOC 解析失败');
  });

  it('拒绝加密、损坏、伪装、空文字和诱导超大分配的文件，输入原件不变', async () => {
    const { parse } = await parser();
    const encrypted = makeDoc();
    encrypted.writeUInt16LE(encrypted.readUInt16LE(1546) | 0x0100, 1546);
    const oversized = makeDoc();
    oversized.writeUInt32LE(0xffffffff, 44);
    const outOfBounds = makeDoc();
    outOfBounds.writeUInt32LE(999999, 76);
    const miniCycle = makeDoc();
    miniCycle.writeInt32LE(10, 60);
    miniCycle.writeUInt32LE(1, 64);
    miniCycle.writeInt32LE(-2, 1024 + 10 * 4);
    miniCycle.writeInt32LE(1, 5632);
    miniCycle.writeInt32LE(0, 5636);
    const unsupportedSymbol = fixtures.doc(receipt, { compressed: true });
    unsupportedSymbol[3072] = 0x80;
    for (const bytes of [
      encrypted,
      oversized,
      outOfBounds,
      miniCycle,
      unsupportedSymbol,
      makeDoc().subarray(0, 1000),
      fixtures.doc(' \r\t'),
      Buffer.from('{\\rtf1 fake document}'),
      Buffer.from('<html>fake document</html>'),
    ]) {
      const before = Buffer.from(bytes);
      await expect(parse(input(bytes))).rejects.toThrow('DOC 解析失败');
      expect(bytes).toEqual(before);
    }
    expect((await parse(input(makeDoc()))).text).toContain(receipt);
  });

  it('循环 FAT 链被隔离终止，后续解析仍可用', async () => {
    const { parse } = await parser();
    const bytes = makeDoc();
    bytes.writeInt32LE(3, 1032);
    bytes.writeInt32LE(2, 1036);
    await expect(parse(input(bytes))).rejects.toThrow('DOC 解析失败');
    expect((await parse(input(makeDoc()))).text).toContain(receipt);
  }, 20_000);

  it('取消立即退休真实 DOC Worker，下一次解析仍可完成', async () => {
    const { parse } = await parser();
    const controller = new AbortController();
    const pending = parse(input(makeDoc()), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect((await parse(input(makeDoc()))).text).toContain(receipt);
  });

  it('目录 DAG、循环、越界、过深和伪长名称在依赖遍历前被拒绝', async () => {
    const { parse } = await parser();
    const dag = directoryFixture(32);
    dag.entry(1).writeInt32LE(3, 72);
    for (let index = 3; index < 29; index++) {
      const storage = dag.storage(index);
      if (index < 28) {
        storage.writeInt32LE(index + 1, 68);
        storage.writeInt32LE(index + 1, 72);
      }
    }
    const siblingCycle = directoryFixture(4);
    siblingCycle.entry(2).writeInt32LE(1, 68);
    const storageCycle = directoryFixture(4);
    storageCycle.entry(1).writeInt32LE(3, 72);
    storageCycle.storage(3).writeInt32LE(3, 76);
    const outOfBounds = directoryFixture(4);
    outOfBounds.entry(1).writeInt32LE(4, 72);
    const emptyChild = directoryFixture(4);
    emptyChild.entry(1).writeInt32LE(3, 72);
    const deep = directoryFixture(136);
    deep.entry(1).writeInt32LE(3, 72);
    for (let index = 3; index < 134; index++) {
      const storage = deep.storage(index);
      if (index < 133) storage.writeInt32LE(index + 1, 76);
    }
    const longName = directoryFixture(4);
    longName.entry(3).writeUInt16LE(0x7ffe, 64);
    for (const fixture of [
      dag,
      siblingCycle,
      storageCycle,
      outOfBounds,
      emptyChild,
      deep,
      longName,
    ])
      await expect(parse(input(fixture.bytes))).rejects.toThrow('DOC 解析失败');

    const valid = directoryFixture(16);
    valid.entry(1).writeInt32LE(3, 72);
    for (let index = 3; index < 12; index++) {
      const storage = valid.storage(index);
      if (index < 11) storage.writeInt32LE(index + 1, 76);
    }
    expect((await parse(input(valid.bytes))).text).toContain(receipt);
  }, 20_000);
});
