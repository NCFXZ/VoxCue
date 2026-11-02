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
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(uiMessages)
  .filter(([source]) => /\{\d+\}/.test(source) && /\p{Script=Han}/u.test(source))
  .sort(([a], [b]) => b.length - a.length)
  .map(([source, english]) => ({
    source,
    english,
    indices: [...source.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1])),
    pattern: new RegExp(
      '^' +
        source
          .split(/\{\d+\}/)
          .map(escapePattern)
          .join('([\\s\\S]*?)') +
        '$',
    ),
  }));

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
  for (const entry of patterns) {
    const match = entry.pattern.exec(source);
    if (match) {
      const values: string[] = [];
      entry.indices.forEach((index, capture) => {
        values[index] = match[capture + 1];
      });
      return interpolate(entry.english, values);
    }
  }
  return source;
}
