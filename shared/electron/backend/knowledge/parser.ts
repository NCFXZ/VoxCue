import type { KnowledgeItem } from '../../contracts/knowledge';
import { parseText, sha } from './chunks';
import type { DocumentInput, ParsedDocument } from './types';

// This module runs only in the knowledge utility process. Never accept a URL or path.
export async function parseDocument(input: DocumentInput): Promise<ParsedDocument> {
  const extension = input.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') {
    // Official worker supplies the DOM geometry types absent in Electron utilityProcess.
    const { getData } = require('pdf-parse/worker') as { getData(): string };
    const { PDFParse } = require('pdf-parse') as typeof import('pdf-parse');
    PDFParse.setWorker(getData());
    const parser = new PDFParse({ data: input.bytes, stopAtErrors: true, isEvalSupported: false });
    try {
      const result = await parser.getText({ pageJoiner: '' });
      const pages = result.pages.filter((page) => page.text.trim().length >= 8);
      if (!pages.length) throw Error('PDF 没有可提取文字，可能是扫描件；请先进行 OCR 后重新导入。');
      let offset = 0;
      const spans = pages.map((page) => {
        const text = page.text.replace(/\r\n/g, '\n').trimEnd(),
          count = text.split('\n').length;
        const span = { page: page.num, text, start: offset + 1, end: offset + count };
        offset += count + 1;
        return span;
      });
      const text = spans.map((span) => span.text).join('\n\n'),
        lines = text.split('\n');
      const parsed = parseText(text, input.documentId, input.name);
      const items = parsed.items.flatMap<KnowledgeItem>((item) => {
        const overlaps = spans.filter(
          (span) =>
            span.end >= (item.startLine ?? 1) && span.start <= (item.endLine ?? lines.length),
        );
        // QA may span pages. Recover it as one whole item with its original follow-up links.
        if (item.kind === 'qa' || item.content.includes('```') || item.content.includes('~~~'))
          return [{ ...item, page: overlaps[0]?.page, endPage: overlaps.at(-1)?.page }];
        return overlaps
          .map((span) => {
            const start = Math.max(span.start, item.startLine ?? 1),
              end = Math.min(span.end, item.endLine ?? lines.length),
              content = lines
                .slice(start - 1, end)
                .join('\n')
                .trim();
            return {
              ...item,
              itemId:
                input.documentId + ':' + sha(span.page + ':' + start + ':' + content).slice(0, 24),
              content,
              page: span.page,
              startLine: start,
              endLine: end,
            };
          })
          .filter((item) => item.content.length >= 8);
      });
      return { title: input.name, text, items };
    } catch (error) {
      if (error instanceof Error && error.message.includes('OCR')) throw error;
      throw Error('PDF 解析失败，可能已加密、损坏或格式不受支持；原件已保留。');
    } finally {
      await parser.destroy();
    }
  }
  if (extension === 'docx') {
    try {
      const { extractRawText } = await import('mammoth');
      const result = await extractRawText({ buffer: Buffer.from(input.bytes) });
      return parseText(result.value, input.documentId, input.name);
    } catch {
      throw Error('DOCX 解析失败，原件已保留；请另存为 PDF、Markdown 或 TXT 后重试。');
    }
  }
  if (extension !== 'md' && extension !== 'txt')
    throw Error('此格式仅保留原件，暂不支持索引；请转换为 PDF、DOCX、Markdown 或 TXT。');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    throw Error('文本不是有效的 UTF-8 编码，请以 UTF-8 另存后重试。');
  }
  return parseText(text, input.documentId, input.name);
}
