interface Node {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
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
