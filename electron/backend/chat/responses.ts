import { readEvents } from './sse';

// Some transports buffer a completed Responses object or omit the SSE MIME type.
// Inspect a bounded prefix, never discard a valid answer based on headers alone.
export async function* responseEvents(
  response: Response,
  signal: AbortSignal,
  idleTimeoutMs = 60000,
) {
  const idle = new AbortController();
  signal = AbortSignal.any([signal, idle.signal]);
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        idle.abort(
          new Error('响应长时间没有新数据，已停止等待并保留正文。资料尚未保存，请检查网络后重试。'),
        ),
      idleTimeoutMs,
    );
  };
  if (!response.body) throw new Error('服务返回空响应，请重试。');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  touch();
  const chunks: Uint8Array[] = [];
  let prefix = '',
    bytes = 0,
    handedOff = false;
  const decoder = new TextDecoder();
  try {
    while (prefix.trimStart().length < 16 && !/^(?:[{<]|data:|event:|:)/.test(prefix.trimStart()) && bytes < 4096) {
      signal.throwIfAborted();
      const item = await reader.read();
      touch();
      signal.throwIfAborted();
      if (item.done) break;
      chunks.push(item.value);
      bytes += item.value.length;
      prefix += decoder.decode(item.value, { stream: true });
    }
    const first = prefix.trimStart();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (chunks.length) {
          controller.enqueue(chunks.shift()!);
          return;
        }
        try {
          const item = await reader.read();
          touch();
          signal.throwIfAborted();
          if (item.done) controller.close();
          else controller.enqueue(item.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        return reader.cancel();
      },
    });
    if (
      /^(?:data:|event:|:)/.test(first) ||
      response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
    ) {
      handedOff = true;
      try {
        yield* readEvents(body, signal);
      } finally {
        reader.releaseLock();
      }
      return;
    }
    if (first.startsWith('{')) {
      const jsonReader = body.getReader();
      let text = '',
        size = 0;
      const jsonDecoder = new TextDecoder();
      try {
        while (true) {
          signal.throwIfAborted();
          const item = await jsonReader.read();
          signal.throwIfAborted();
          if (item.done) break;
          size += item.value.length;
          if (size > 8 * 1024 * 1024) throw new Error('响应内容过大。');
          text += jsonDecoder.decode(item.value, { stream: true });
        }
        text += jsonDecoder.decode();
      } finally {
        void jsonReader.cancel().catch(() => {});
        jsonReader.releaseLock();
      }
      let value: any;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error('服务返回的 JSON 不完整，请重试。');
      }
      if (value.error) {
        yield { type: 'error', ...value };
        return;
      }
      if (
        value.object !== 'response' ||
        typeof value.id !== 'string' ||
        !['completed', 'failed', 'incomplete'].includes(value.status) ||
        !Array.isArray(value.output)
      )
        throw new Error('服务返回了非预期的 JSON，未收到有效回答。');
      for (const output of value.output)
        for (const content of output.content ?? []) {
          if (content.type === 'output_text' && typeof content.text === 'string')
            yield { type: 'response.output_text.delta', delta: content.text };
          if (content.type === 'refusal' && typeof content.refusal === 'string')
            yield { type: 'response.refusal.delta', delta: content.refusal };
        }
      yield { type: `response.${value.status}`, response: value };
      return;
    }
    const type = (response.headers.get('content-type') ?? 'missing')
      .split(';')[0]
      .replace(/[^\w/+.-]/g, '')
      .slice(0, 80);
    throw new Error(
      `未收到有效回答（HTTP ${response.status}，格式 ${type}）。请检查网络代理或稍后重试。`,
    );
  } finally {
    clearTimeout(timer!);
    signal.removeEventListener('abort', cancel);
    if (!handedOff) {
      cancel();
      reader.releaseLock();
    }
  }
}
