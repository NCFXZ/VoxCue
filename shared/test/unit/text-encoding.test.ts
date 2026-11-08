import { describe, it, expect } from 'vitest';
import { decodeKnowledgeText } from '../../electron/backend/knowledge/textEncoding';

const gb18030 = Buffer.from(
  'd6aacab6bfe2cec4b5b5b1a3b4e6cfeec4bfbeadc0faa3acb4abb8d0c6f7b7b4c0a1bfd8d6c6bbfad0b5b1dba3accafdbeddb4a6c0edbde1b9fbd3c3d3dac3e6cad4d7bcb1b8a1a3d5e2b8f6cfb5cdb3d6a7b3d6d6d0cec4bacdd3a2cec4d7cac1cfa1a3',
  'hex',
);
const big5 = Buffer.from(
  'aabec3d1ae77a4e5a5f3ab4fa673b14daed7b867befaa141b750b4fabeb9a65ef558b1b1a8eebef7b1f1a4e2c175a141b8eaaec6b342b27ab5b2aa47a5cea9f3adb1b8d5b7c7b3c6a143b36fadd3a874b2cea4e4b4a9a4a4a4e5bb50ad5ea4e5b8eaaec6a143',
  'hex',
);
const western = Buffer.from(
  '4c652072e973756de9207072e973656e746520756e6520657870e97269656e63652064e97461696c6ce9652c20756e65206de974686f6465207072e963697365206574206465732072e973756c746174732076e972696669e9732e204c92e97175697065207072e97061726520756e65207072e973656e746174696f6e20636c6169726520706f7572206c92656e7472657469656e2e20',
  'hex',
);

describe('知识库文本编码', () => {
  it('保留 UTF-8、ASCII 和 UTF-8 BOM 的中英文及 Markdown', () => {
    const text = '# 项目 sensor\n\nPID 控制，阈值 37。';
    expect(decodeKnowledgeText(Buffer.from(text))).toBe(text);
    expect(decodeKnowledgeText(Buffer.from('\ufeff' + text))).toBe(text);
    expect(decodeKnowledgeText(Buffer.from('## Project\n\nPID 37.'))).toBe('## Project\n\nPID 37.');
  });

  it('读取 UTF-16 两种字节序的 BOM 和清晰的无 BOM 文本', () => {
    const text = '# Project 项目\n\nThe sensor uses PID feedback 37.';
    const le = Buffer.from(text, 'utf16le'),
      be = Buffer.from(le).swap16();
    expect(decodeKnowledgeText(Buffer.concat([Buffer.from([0xff, 0xfe]), le]))).toBe(text);
    expect(decodeKnowledgeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(text);
    expect(decodeKnowledgeText(le)).toBe(text);
    expect(decodeKnowledgeText(be)).toBe(text);
  });

  it('识别 GB18030/GBK 与 Big5，并保留原字节', () => {
    const before = Buffer.from(gb18030);
    expect(decodeKnowledgeText(gb18030)).toBe(
      '知识库文档保存项目经历，传感器反馈控制机械臂，数据处理结果用于面试准备。这个系统支持中文和英文资料。',
    );
    expect(gb18030).toEqual(before);
    expect(decodeKnowledgeText(big5)).toBe(
      '知識庫文件保存專案經歷，感測器回饋控制機械手臂，資料處理結果用於面試準備。這個系統支援中文與英文資料。',
    );
    expect(
      decodeKnowledgeText(
        Buffer.concat([
          gb18030,
          Buffer.from('bbfac6f7c8cb209530cd3620d3ebcdbccff1209439f538', 'hex'),
        ]),
      ),
    ).toContain('机器人 🤖 与图像 🖼');
  });

  it('只在有足够证据时读取 Windows-1252 西文', () => {
    expect(decodeKnowledgeText(western)).toContain('résumé présente une expérience détaillée');
    expect(decodeKnowledgeText(western)).toContain('L’équipe');
    expect(() => decodeKnowledgeText(Buffer.from([0x81, 0x40]))).toThrow('无法识别文本编码');
    // These bytes are valid in both GBK and Big5, with different resulting text.
    expect(() => decodeKnowledgeText(Buffer.from('c4e3bac3cac0bde7', 'hex'))).toThrow(
      '无法识别文本编码',
    );
  });

  it('拒绝二进制、截断 Unicode、UTF-32 和控制字符，不以其他编码掩盖损坏', () => {
    for (const bytes of [
      Buffer.from([0xff, 0xfe]),
      Buffer.from([0xef, 0xbb, 0xbf, 0xc3]),
      Buffer.from([0xff, 0xfe, 0x41]),
      Buffer.from([0xff, 0xfe, 0, 0, 0x41, 0, 0, 0]),
      Buffer.from([0xc3]),
      Buffer.from('hello\u0000world'),
      Buffer.from('hello\u0001world'),
      Buffer.alloc(50),
    ])
      expect(() => decodeKnowledgeText(bytes)).toThrow();
  });

  it('完整解码检查样本以后的坏字节，并限制解析文字大小', () => {
    const valid = Buffer.concat(Array.from({ length: 1000 }, () => gb18030));
    expect(decodeKnowledgeText(valid)).toContain('知识库文档');
    expect(() => decodeKnowledgeText(Buffer.concat([valid, Buffer.from([0x81])]))).toThrow(
      '无法识别文本编码',
    );
    expect(() => decodeKnowledgeText(Buffer.from('a'.repeat(8_000_001)))).toThrow('超过 8 MB');
  });
});
