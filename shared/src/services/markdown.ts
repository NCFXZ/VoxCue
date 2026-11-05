import type { ChatSource } from '../../electron/contracts/chat';

interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

function sourceURL(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    return url;
  } catch {
    return;
  }
}

export function sourceHost(url: string): string {
  return sourceURL(url)?.hostname ?? '';
}

export function indexChatSources(sources: readonly ChatSource[]): ReadonlyMap<string, ChatSource> {
  const index = new Map<string, ChatSource>();
  for (const source of sources) {
    const url = sourceURL(source.url);
    if (url && !index.has(url.href)) index.set(url.href, source);
  }
  return index;
}

export function citationSource(
  url: string,
  label: string,
  sources: ReadonlyMap<string, ChatSource>,
): ChatSource | undefined {
  if (!sources.size) return;
  const parsed = sourceURL(url);
  if (!parsed) return;
  const text = label.trim();
  const plain = text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1).trim() : text;
  const withoutWWW = (value: string) => value.toLowerCase().replace(/^www\./, '');
  if (withoutWWW(plain) !== withoutWWW(parsed.hostname)) return;
  return sources.get(parsed.href);
}

// Only remove punctuation immediately wrapping a verified domain citation.
// Stored Markdown, ordinary links and code keep their original text.
export function compactCitations(sources: ReadonlyMap<string, ChatSource>) {
  return (tree: Node) => {
    const visit = (parent: Node) => {
      if (!parent.children || ['code', 'inlineCode', 'html'].includes(parent.type)) return;
      for (const [index, child] of parent.children.entries()) {
        if (
          child.type === 'link' &&
          child.url &&
          child.children?.every((node) => node.type === 'text') &&
          citationSource(
            child.url,
            child.children.map((node) => node.value ?? '').join(''),
            sources,
          )
        ) {
          const before = parent.children[index - 1],
            after = parent.children[index + 1];
          if (before?.type === 'text' && after?.type === 'text') {
            for (const [open, close] of [
              ['(', ')'],
              ['（', '）'],
            ]) {
              if (before.value?.endsWith(open) && after.value?.startsWith(close)) {
                before.value = before.value.slice(0, -1);
                after.value = after.value.slice(1);
                break;
              }
            }
          }
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

// Repair paired strong markers left as text by CommonMark's punctuation rules.
// Work on parsed text only: fenced/inline code, escaped markers and HTML stay inert.
export function readableStrong() {
  return (tree: Node, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (parent: Node) => {
      if (!parent.children || ['code', 'inlineCode', 'html'].includes(parent.type)) return;
      parent.children = parent.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value) {
          visit(child);
          return [child];
        }
        const { start, end } = child.position ?? {};
        if (source.slice(start?.offset, end?.offset) !== child.value) return [child];
        const nodes: Node[] = [];
        let cursor = 0;
        for (const match of child.value.matchAll(
          /(?<!\*)\*\*(?![\s*])([^\n]*?\S[ \t]*)\*\*(?!\*)/g,
        )) {
          if (!/\p{Script=Han}/u.test(match[1])) continue;
          if (match.index > cursor)
            nodes.push({ type: 'text', value: child.value.slice(cursor, match.index) });
          nodes.push({ type: 'strong', children: [{ type: 'text', value: match[1] }] });
          cursor = match.index + match[0].length;
        }
        if (!cursor) return [child];
        if (cursor < child.value.length)
          nodes.push({ type: 'text', value: child.value.slice(cursor) });
        return nodes;
      });
    };
    visit(tree);
  };
}
