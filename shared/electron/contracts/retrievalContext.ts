// Internal main/knowledge-process data, never parsed from an ordinary user turn.
const prefix = 'VoxCue retrieval context v2\n';
export function encodeRetrievalContext(current: string, previous: string[]) {
  if (current.length > 700 || !previous.length) return undefined;
  const bounded = previous.slice(-6).map((v) => v.trim().slice(0, 200));
  let value = prefix + JSON.stringify({ current, previous: bounded });
  while (value.length > 1000 && bounded.length) {
    bounded.splice(bounded.length > 1 ? 1 : 0, 1);
    value = prefix + JSON.stringify({ current, previous: bounded });
  }
  return bounded.length ? value : undefined;
}
export function readRetrievalContext(value: string) {
  if (!value.startsWith(prefix)) return undefined;
  try {
    const data = JSON.parse(value.slice(prefix.length));
    if (
      data &&
      typeof data.current === 'string' &&
      data.current.length <= 700 &&
      Array.isArray(data.previous) &&
      data.previous.length <= 6 &&
      data.previous.every((v: unknown) => typeof v === 'string' && v.length <= 200)
    )
      return data as { current: string; previous: string[] };
  } catch {
    /* Do not turn malformed data into trusted history. */
  }
  return undefined;
}
