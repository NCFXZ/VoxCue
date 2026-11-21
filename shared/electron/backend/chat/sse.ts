// SSE chunks may split UTF-8 characters, lines, or JSON. Never assume one chunk is one event.
export async function* readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  const parse = (payload: string) => {
    try {
      return JSON.parse(payload) as Record<string, any>;
    } catch {
      // Parser diagnostics can quote remote text, including account/input data.
      throw new Error('服务返回的 JSON 不完整，请重试。');
    }
  };
  const limit = 8 * 1024 * 1024;
  let partialLine = '';
  let data: string[] = [];
  let dataLength = 0;
  let precedingCR = false;
  function line(value: string) {
    if (!value) {
      const payload = data.join('\n');
      data = [];
      dataLength = 0;
      return payload || null;
    }
    if (value.startsWith('data:')) {
      const text = value.slice(5).replace(/^ /, '');
      dataLength += text.length + (data.length ? 1 : 0);
      data.push(text);
    }
    return null;
  }
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      let chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (chunk) {
        if (precedingCR && chunk.startsWith('\n')) chunk = chunk.slice(1);
        precedingCR = chunk.endsWith('\r');
        chunk = chunk.replace(/\r\n?/g, '\n');
        for (let start = 0; start < chunk.length;) {
          const end = chunk.indexOf('\n', start);
          const part = chunk.slice(start, end < 0 ? chunk.length : end);
          if (dataLength + partialLine.length + part.length > limit) throw new Error('响应事件过大。');
          partialLine += part;
          if (end < 0) break;
          const payload = line(partialLine);
          partialLine = '';
          if (payload === '[DONE]') return;
          if (payload) yield parse(payload);
          start = end + 1;
        }
      }
      if (done) {
        if (partialLine) line(partialLine);
        const payload = line('');
        if (payload === '[DONE]') return;
        if (payload) yield parse(payload);
        break;
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    // Transport cleanup must not delay a terminal response or cancellation.
    cancel();
    reader.releaseLock();
  }
}
