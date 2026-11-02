// Convert the delimiters commonly returned by models before CommonMark consumes
// their backslashes. Code, escaped delimiters and link destinations stay literal.
export function normalizeMath(content: string): string {
  let output = '';
  let index = 0;
  let fence: { character: string; length: number } | undefined;
  const exhausted = new Set<string>();
  const closing = (delimiter: string, start: number) => {
    if (exhausted.has(delimiter)) return -1;
    for (
      let end = content.indexOf(delimiter, start);
      end >= 0;
      end = content.indexOf(delimiter, end + 1)
    ) {
      let slashes = 0;
      for (let i = end - 1; i >= 0 && content[i] === '\\'; i--) slashes++;
      if (slashes % 2 === 0) return end;
    }
    exhausted.add(delimiter);
    return -1;
  };
  while (index < content.length) {
    if (index === 0 || content[index - 1] === '\n') {
      const end = content.indexOf('\n', index);
      const line = content.slice(index, end < 0 ? undefined : end + 1);
      const marker = line.match(/^\s*(?:>\s*)*(`{3,}|~{3,})/);
      if (fence || marker || /^(?: {4}|\t)/.test(line)) {
        if (fence) {
          if (
            marker?.[1][0] === fence.character &&
            marker[1].length >= fence.length &&
            !line.slice(marker[0].length).trim()
          )
            fence = undefined;
        } else if (marker) fence = { character: marker[1][0], length: marker[1].length };
        output += line;
        index += line.length;
        continue;
      }
    }
    const rest = content.slice(index);
    if (content[index] === '`') {
      const ticks = rest.match(/^`+/)![0];
      let end = content.indexOf(ticks, index + ticks.length);
      while (end >= 0 && (content[end - 1] === '`' || content[end + ticks.length] === '`'))
        end = content.indexOf(ticks, end + ticks.length);
      const next = end < 0 ? index + ticks.length : end + ticks.length;
      output += content.slice(index, next);
      index = next;
      continue;
    }
    if (rest.startsWith('](')) {
      let next = index + 2,
        depth = 1;
      while (next < content.length && depth) {
        if (content[next] === '\\') next++;
        else if (content[next] === '(') depth++;
        else if (content[next] === ')') depth--;
        next++;
      }
      output += content.slice(index, next);
      index = next;
      continue;
    }
    const delimiter = rest.startsWith('\\(')
      ? '\\)'
      : rest.startsWith('\\[')
        ? '\\]'
        : rest.startsWith('$$')
          ? '$$'
          : content[index] === '$'
            ? '$'
            : undefined;
    if (delimiter) {
      const length = delimiter.length;
      const end = closing(delimiter, index + length);
      if (end >= 0) {
        const value = content.slice(index + length, end);
        if (delimiter === '$') output += content.slice(index, end + length);
        else if (delimiter === '\\)') output += `$${value}$`;
        else {
          const before = content.slice(content.lastIndexOf('\n', index - 1) + 1, index);
          const indent = before.match(/^(\s*)(?:[-*+] |\d+[.)] )?$/)?.[0].replace(/\S/g, ' ') ?? '';
          output += `\n${indent}$$\n${indent}${value.trim()}\n${indent}$$\n${indent}`;
        }
        index = end + length;
        continue;
      }
    }
    // Consume escaped characters as a pair, so \\( is not a math opener.
    const length = content[index] === '\\' && index + 1 < content.length ? 2 : 1;
    output += content.slice(index, index + length);
    index += length;
  }
  return output;
}

interface HtmlNode {
  properties?: { className?: string[]; title?: string };
  children?: HtmlNode[];
}

// A partial streaming formula is readable text, with no error hover popup.
export function mathPresentation() {
  return function visit(node: HtmlNode) {
    if (node.properties?.className?.includes('katex-error')) delete node.properties.title;
    node.children?.forEach(visit);
  };
}
