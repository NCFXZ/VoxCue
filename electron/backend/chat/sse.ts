// SSE chunks may split UTF-8 characters, lines, or JSON. Never assume one chunk is one event.
export async function* readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    data: string[] = [];
  function line(value: string) {
    if (value.endsWith('\r')) value = value.slice(0, -1);
    if (!value) {
      const payload = data.join('\n');
      data = [];
      return payload || null;
    }
    if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    return null;
  }
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length + data.join('').length > 8 * 1024 * 1024) throw new Error('响应事件过大。');
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const payload = line(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (payload && payload !== '[DONE]') yield JSON.parse(payload) as Record<string, any>;
      }
      if (done) {
        if (buffer) line(buffer);
        const payload = line('');
        if (payload && payload !== '[DONE]') yield JSON.parse(payload) as Record<string, any>;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
