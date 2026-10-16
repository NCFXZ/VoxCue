export interface ReasoningSection {
  title?: string;
  body: string;
}

// Use headings supplied in the public summary, including its usual bold headings.
// Text without a heading stays visible; code fences never become disclosure titles.
export function reasoningSections(text: string): ReasoningSection[] {
  const sections: ReasoningSection[] = [];
  let current: ReasoningSection = { body: '' };
  let fence: string | undefined;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const finish = () => {
    current.body = current.body.trim();
    if (current.title || current.body) sections.push(current);
  };
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      current.body += `${line}\n`;
      continue;
    }
    const heading =
      !fence && (index === 0 || !lines[index - 1].trim())
        ? (line.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/)?.[1] ??
          line
            .match(/^\s*(?:\*\*(.+?)\*\*|__(.+?)__)\s*$/)
            ?.slice(1)
            .find(Boolean))
        : undefined;
    if (heading?.trim()) {
      finish();
      current = { title: heading.trim(), body: '' };
    } else current.body += `${line}\n`;
  }
  finish();
  return sections;
}
