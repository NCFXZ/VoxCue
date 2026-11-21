// Session-owned data, decoded in main before the current question and history
// are passed separately to retrieval. Ordinary user turns are never decoded.
const prefix = 'VoxCue retrieval context v2\n';
export const MAX_RETRIEVAL_HISTORY = 3;
export const MAX_RETRIEVAL_HISTORY_CHARS = 200;
export const MAX_EVIDENCE_ROOTS = 6;
export function encodeRetrievalContext(current: string, previous: string[]) {
  if (current.length > 6000 || !previous.length) return undefined;
  const bounded = previous.slice(-MAX_RETRIEVAL_HISTORY).map((v) => v.trim().slice(0, MAX_RETRIEVAL_HISTORY_CHARS));
  return prefix + JSON.stringify({ current, previous: bounded });
}
export function readRetrievalContext(value: string) {
  if (!value.startsWith(prefix)) return undefined;
  try {
    const data = JSON.parse(value.slice(prefix.length));
    if (
      data &&
      typeof data.current === 'string' &&
      data.current.length <= 6000 &&
      Array.isArray(data.previous) &&
      data.previous.length <= MAX_RETRIEVAL_HISTORY &&
      data.previous.every((v: unknown) => typeof v === 'string' && !!v.trim() && v.length <= MAX_RETRIEVAL_HISTORY_CHARS)
    )
      return data as { current: string; previous: string[] };
  } catch {
    /* Do not turn malformed data into trusted history. */
  }
  return undefined;
}
