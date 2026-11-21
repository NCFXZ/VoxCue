import { uiMessages } from './uiMessages';

export type UILanguage = 'zh-CN' | 'en';
export const isUILanguage = (value: unknown): value is UILanguage =>
  value === 'zh-CN' || value === 'en';

export function systemUILanguage(preferred: string | undefined): UILanguage {
  try {
    const locale = new Intl.Locale(preferred ?? '').maximize();
    return locale.language === 'zh' && locale.script === 'Hans' ? 'zh-CN' : 'en';
  } catch {
    return 'en';
  }
}

const interpolate = (text: string, values: readonly unknown[]) =>
  text.replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : match,
  );
const patterns = Object.entries(uiMessages)
  .filter(([source]) => /\{\d+\}/.test(source) && /\p{Script=Han}/u.test(source))
  .sort(([a], [b]) => b.length - a.length)
  .map(([source, english]) => ({
    source,
    english,
    indices: [...source.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1])),
    parts: source.split(/\{\d+\}/),
  }));

function captureValues(source: string, parts: string[]): string[] | undefined {
  const prefix = parts[0],
    suffix = parts.at(-1)!;
  if (
    !source.startsWith(prefix) ||
    !source.endsWith(suffix) ||
    source.length < prefix.length + suffix.length
  )
    return;
  const captures: string[] = [];
  const end = source.length - suffix.length;
  let offset = prefix.length;
  for (let i = 1; i < parts.length; i++) {
    const next = i === parts.length - 1 ? end : source.indexOf(parts[i], offset);
    if (
      next < offset ||
      next + parts[i].length > source.length ||
      (i < parts.length - 1 && next + parts[i].length > end)
    )
      return;
    captures.push(source.slice(offset, next));
    offset = next + parts[i].length;
  }
  return captures;
}

/** Only call for application-owned UI copy, never for user/model content. */
export function translateUI(
  source: string,
  language: UILanguage,
  values?: readonly unknown[],
): string {
  if (language === 'zh-CN') return values ? interpolate(source, values) : source;
  if (Object.hasOwn(uiMessages, source))
    return values ? interpolate(uiMessages[source], values) : uiMessages[source];
  const trimmed = source.trim();
  if (trimmed !== source && trimmed)
    return (
      source.slice(0, source.indexOf(trimmed)) +
      translateUI(trimmed, language, values) +
      source.slice(source.indexOf(trimmed) + trimmed.length)
    );
  if (values) return interpolate(source, values);
  // Status and error messages received from services retain their original data.
  // Explicit template/value calls above can contain arbitrarily long user data;
  // reverse matching is limited to bounded, application-owned UI messages.
  if (source.length > 16 * 1024 || !/\p{Script=Han}/u.test(source)) return source;
  // A response can carry several independent application notices. Only split
  // a block when every line is known copy, preserving arbitrary provider text.
  if (source.includes('\n')) {
    const lines = source.split('\n');
    if (lines.every(line => Object.hasOwn(uiMessages, line)))
      return lines.map(line => uiMessages[line]).join('\n');
  }
  for (const entry of patterns) {
    const captures = captureValues(source, entry.parts);
    if (captures) {
      const values: string[] = [];
      entry.indices.forEach((index, capture) => {
        values[index] = captures[capture];
      });
      return interpolate(entry.english, values);
    }
  }
  return source;
}
