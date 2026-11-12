import { createHash } from 'node:crypto';
import type { KnowledgeItem } from '../../contracts/knowledge';
import type { Embedder, ParsedDocument } from './types';
export const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function parseText(
  text: string,
  documentId: string,
  title: string,
  page?: number,
): ParsedDocument {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const headers: { line: number; level: number; title: string; question: boolean }[] = [];
  let fence = '';
  for (let i = 0; i < lines.length; i++) {
    const f = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = '';
      continue;
    }
    if (fence) continue;
    const h = /^(#{1,6})\s+(.+)/.exec(lines[i]);
    if (h)
      headers.push({
        line: i,
        level: h[1].length,
        title: h[2],
        question: /\bQ\d|[?？]|自我介绍|请介绍|请详细|追问\s*\d/u.test(h[2]),
      });
    else if (
      lines[i].length <= 300 &&
      /^\s*(?:Q\d[\w.-]*[.：:]?\s+|(?:问题|问|Q)[：:]\s*|追问(?:\s*\d+)?[：:]\s*)/u.test(lines[i])
    )
      headers.push({
        line: i,
        level: /^\s*追问/.test(lines[i]) ? 6 : 2,
        title: lines[i].trim(),
        question: true,
      });
  }
  const questionHeaders = headers.filter((h) => h.question);
  const minimum = questionHeaders.reduce((level, h) => Math.min(level, h.level), 6);
  const boundaries = headers.filter((h) => h.level <= minimum || h.question);
  const starts = [...new Set([0, ...boundaries.map((h) => h.line), lines.length])];
  const items: KnowledgeItem[] = [];
  const headerAt = new Map(headers.map((h) => [h.line, h]));
  const stack: typeof headers = [];
  let nextHeader = 0;
  const sectionAt = (line: number) => {
    // Content blocks are visited in document order; advance the hierarchy once.
    while (nextHeader < headers.length && headers[nextHeader].line <= line) {
      const h = headers[nextHeader++];
      while (stack.length && stack.at(-1)!.level >= h.level) stack.pop();
      stack.push(h);
    }
    return stack.map((h) => h.title).join(' / ');
  };
  let parent: KnowledgeItem | undefined;
  for (let i = 0; i < starts.length - 1; i++) {
    const start = starts[i],
      end = starts[i + 1],
      h = headerAt.get(start);
    // Group complete natural paragraphs. Fenced code remains a complete content item.
    if (!h?.question) {
      if (h && h.level <= minimum) parent = undefined;
      let block = start,
        fenceMark = '',
        length = 0;
      for (let line = start; line <= end; line++) {
        const current = lines[line] ?? '',
          f = /^\s*(`{3,}|~{3,})/.exec(current);
        if (f) {
          if (!fenceMark) fenceMark = f[1][0];
          else if (f[1][0] === fenceMark) fenceMark = '';
        }
        length += current.length + 1;
        if (line === end || (!fenceMark && !current.trim() && length >= 1200)) {
          const content = lines.slice(block, line).join('\n').trim();
          if (content.length >= 8)
            items.push({
              itemId:
                documentId + ':' + sha((page ?? 0) + ':' + block + ':' + content).slice(0, 24),
              documentId,
              kind: 'text',
              title: h?.title ?? title,
              content,
              followUpIds: [],
              section: sectionAt(block),
              ...(page ? { page } : {}),
              startLine: block + 1,
              endLine: line,
            });
          block = line + 1;
          length = 0;
        }
      }
      continue;
    }
    const content = lines
      .slice(start, end)
      .filter((l) => !/^\s*-\s*\[.*\]\(#/.test(l))
      .join('\n')
      .replace(/<a\s+[^>]*>\s*<\/a>/gi, '')
      .trim();
    if (!content || content.length < 8) continue;
    const itemId = `${documentId}:${sha(`${page ?? 0}:${start}:${content}`).slice(0, 24)}`;
    const qa = !!h?.question;
    const item: KnowledgeItem = {
      itemId,
      documentId,
      kind: qa ? 'qa' : 'text',
      title: h?.title ?? title,
      content,
      followUpIds: [],
      section: sectionAt(start),
      ...(page ? { page } : {}),
      startLine: start + 1,
      endLine: end,
    };
    if (qa) {
      item.question = h!.title.replace(/^(?:Q[\d.]+(?:-[A-Z])?[.：:]?\s*|★\s*\d+[.、]\s*)/u, '');
      item.answer = lines
        .slice(start + 1, end)
        .join('\n')
        .trim();
      if (h!.level > minimum && parent) {
        item.parentId = parent.itemId;
        parent.followUpIds.push(itemId);
      } else parent = item;
    } else if (h && h.level <= minimum) parent = undefined;
    items.push(item);
  }
  if (!items.length) throw Error('文档没有可索引的文字。');
  return { title, items, text };
}
export interface SearchUnit {
  chunkId: string;
  itemId: string;
  rootItemId: string;
  text: string;
  hash: string;
}
// Full answers are stored once in item metadata. Every auxiliary search unit links back.
export function searchUnits(
  items: KnowledgeItem[],
  embedder: Embedder,
  signal?: AbortSignal,
): SearchUnit[] {
  const units: SearchUnit[] = [];
  const parents = new Map<string, KnowledgeItem>();
  for (const item of items)
    if (!parents.has(item.itemId)) parents.set(item.itemId, item);
  for (const item of items) {
    const parent = item.parentId ? parents.get(item.parentId) : undefined;
    const prefix =
      item.kind === 'qa'
        ? parent
          ? `问题：${parent.question}\n追问：${item.question}\n`
          : `问题：${item.question}\n`
        : `${item.title}\n`;
    const body = item.kind === 'qa' ? item.answer! : item.content;
    if (embedder.count(prefix, 'passage') > 480)
      throw Error('问题标题过长，请缩短后重试。');
    let offset = 0,
      index = 0;
    while (offset < body.length || (!body.length && index === 0)) {
      signal?.throwIfAborted();
      if (units.length >= 20000) throw Error('文档检索片段过多，请拆分文档。');
      let low = 0,
        high = Math.min(body.length - offset, 4096);
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (embedder.count(prefix + body.slice(offset, offset + mid), 'passage') <= 512) low = mid;
        else high = mid - 1;
      }
      if (low > 1 && /[\uD800-\uDBFF]/.test(body[offset + low - 1])) low--;
      if (low === 0 && body.length) throw Error('无法切分检索文本。');
      const text = prefix + body.slice(offset, offset + low),
        hash = sha(text);
      units.push({
        chunkId: `${item.itemId}:${index++}`,
        itemId: item.itemId,
        rootItemId: item.parentId ?? item.itemId,
        text,
        hash,
      });
      offset += low;
      if (!body.length) break;
    }
  }
  if (units.length > 20000) throw Error('文档检索片段过多，请拆分文档。');
  return units;
}
