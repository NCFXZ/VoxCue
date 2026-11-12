/** Bound response allocation even when Content-Length is missing or dishonest. */
export async function boundedJson(response: Response, maximum = 16384): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Missing response');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) throw Error('Oversized response');
      parts.push(part.value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  } finally {
    // A broken transport's cleanup must not hold a bounded response open.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
