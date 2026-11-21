import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { validateDocxArchive } from '../../electron/backend/knowledge/docxArchive';
import { parseDocument } from '../../electron/backend/knowledge/parser';

const load = createRequire(import.meta.url);
const JSZip = load('jszip');
const fixtures = load('../scripts/rag-fixtures.cjs');
const input = (bytes: Uint8Array) => ({
  documentId: 'docx',
  baseId: 'base',
  name: 'fixture.docx',
  bytes,
});
async function archive(items: [string, string][], compression = 'DEFLATE', streamFiles = false) {
  const zip = new JSZip();
  for (const [name, text] of items) zip.file(name, text);
  return zip.generateAsync({ type: 'nodebuffer', compression, streamFiles }) as Promise<Buffer>;
}
const directory = (bytes: Buffer) => bytes.readUInt32LE(bytes.length - 6);

describe('DOCX ZIP 实际解压限额', () => {
  it('普通 Word 文档继续由 Mammoth 提取，原字节不变', async () => {
    const title = `装运单 ${randomUUID()}`;
    const bytes: Buffer = await fixtures.docx([title]);
    const before = Buffer.from(bytes);
    validateDocxArchive(bytes);
    expect((await parseDocument(input(bytes))).text).toContain(title);
    expect(bytes).toEqual(before);
  });

  it.each(['STORE', 'DEFLATE'])(
    '接受 %s、空文件/目录及流式 data descriptor',
    async (compression) => {
      for (const streamFiles of [false, true]) {
        const bytes = await archive(
          [
            ['word/text.xml', 'synthetic'],
            ['word/empty.xml', ''],
          ],
          compression,
          streamFiles,
        );
        expect(() => validateDocxArchive(bytes)).not.toThrow();
      }
    },
  );

  it('伪造小声明仍受 zlib 实际输出硬限额，不能等全量解压后才拒绝', async () => {
    const bytes = await archive([['payload', 'x'.repeat(4096)]]);
    const central = directory(bytes);
    bytes.writeUInt32LE(1, 22);
    bytes.writeUInt32LE(1, central + 24);
    expect(bytes.length).toBeLessThan(1024);
    let failure: unknown;
    try {
      validateDocxArchive(bytes);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'ERR_BUFFER_TOO_LARGE' });
    await expect(parseDocument(input(bytes))).rejects.toThrow('DOCX 解析失败。');
  });

  it('累计预算按实际输出计数，超额声明及条目数量在分配前拒绝', async () => {
    const small = await archive([
      ['one', 'a'.repeat(30)],
      ['two', 'b'.repeat(30)],
    ]);
    expect(() => validateDocxArchive(small, 64)).not.toThrow();
    const excess = await archive([
      ['one', 'a'.repeat(30)],
      ['two', 'b'.repeat(30)],
      ['three', 'c'.repeat(30)],
    ]);
    expect(() => validateDocxArchive(excess, 64)).toThrow('Invalid DOCX archive');
    const declared = await archive([['payload', 'synthetic']]);
    declared.writeUInt32LE(32 * 1024 * 1024 + 1, directory(declared) + 24);
    expect(() => validateDocxArchive(declared)).toThrow('Invalid DOCX archive');
    const many = Buffer.from(small);
    many.writeUInt16LE(4097, many.length - 14);
    many.writeUInt16LE(4097, many.length - 12);
    expect(() => validateDocxArchive(many)).toThrow('Invalid DOCX archive');
  });

  it('拒绝 CRC、截断、越界、加密、ZIP64 和不一致 local/central 元数据', async () => {
    const original = await archive([['payload', 'synthetic']]);
    const central = directory(original);
    const damaged: Buffer[] = [original.subarray(0, original.length - 1)];
    for (const change of [
      (bytes: Buffer) => {
        bytes.writeUInt32LE(0, 14);
        bytes.writeUInt32LE(0, central + 16);
      },
      (bytes: Buffer) => {
        bytes.writeUInt32LE(central, central + 42);
      },
      (bytes: Buffer) => {
        bytes.writeUInt16LE(1, 6);
        bytes.writeUInt16LE(1, central + 8);
      },
      (bytes: Buffer) => {
        bytes.writeUInt32LE(0xffffffff, central + 24);
      },
      (bytes: Buffer) => {
        bytes.writeUInt16LE(0, central + 10);
      },
      (bytes: Buffer) => {
        bytes.writeUInt16LE(0xffff, 28);
      },
    ]) {
      const bytes = Buffer.from(original);
      change(bytes);
      damaged.push(bytes);
    }
    for (const bytes of damaged) {
      expect(() => validateDocxArchive(bytes)).toThrow();
      await expect(parseDocument(input(bytes))).rejects.toThrow('DOCX 解析失败。');
    }
  });
});
