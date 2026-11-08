import type { KnowledgeItem } from '../../contracts/knowledge';
import { isKnowledgeFileName } from '../../contracts/knowledge';
import { parseText, sha } from './chunks';
import type { DocumentInput, ParsedDocument } from './types';
import { extractLegacyDoc } from './legacyDoc';
import { decodeKnowledgeText } from './textEncoding';
import { validateDocxArchive } from './docxArchive';

const pdfNoText = 'PDF 未提取到文字。';

// This module runs only in the knowledge utility process. Never accept a URL or path.
export async function parseDocument(
  input: DocumentInput,
  signal?: AbortSignal,
): Promise<ParsedDocument> {
  signal?.throwIfAborted();
  if (!isKnowledgeFileName(input.name)) throw Error('仅支持 PDF、Word、TXT 和 Markdown。');
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
      if (!pages.length) throw Error(pdfNoText);
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
      if (error instanceof Error && error.message === pdfNoText) throw error;
      throw Error('PDF 解析失败。');
    } finally {
      await parser.destroy();
    }
  }
  if (extension === 'doc') {
    try {
      return parseText(await extractLegacyDoc(input.bytes, signal), input.documentId, input.name);
    } catch {
      signal?.throwIfAborted();
      throw Error('DOC 解析失败。');
    }
  }
  if (extension === 'docx') {
    try {
      const { extractRawText } = await import('mammoth');
      const bytes = Buffer.from(input.bytes);
      validateDocxArchive(bytes);
      const result = await extractRawText({ buffer: bytes });
      return parseText(result.value, input.documentId, input.name);
    } catch {
      throw Error('DOCX 解析失败。');
    }
  }
  return parseText(decodeKnowledgeText(input.bytes), input.documentId, input.name);
}
