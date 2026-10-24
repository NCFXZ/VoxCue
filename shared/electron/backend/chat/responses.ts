import { readEvents } from './sse';
import { ChatServiceError, networkFailure } from './errors';

// Error bodies are untrusted streams too: headers alone do not finish a request.
export async function readErrorResponse(
  response: Response,
  signal: AbortSignal,
  idleTimeoutMs = 300000,
): Promise<unknown> {
  signal.throwIfAborted();
  if (!response.body) return null;
  const idle = new AbortController();
  const deadline = AbortSignal.any([signal, idle.signal]);
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  deadline.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        idle.abort(
          new ChatServiceError({
            code: 'response_idle_timeout',
            message: '模型服务错误响应长时间没有新数据，已停止等待，请重试。',
          }),
        ),
      idleTimeoutMs,
    );
  };
  let bytes = 0,
    text = '';
  const decoder = new TextDecoder();
  touch();
  try {
    while (true) {
      deadline.throwIfAborted();
      const item = await reader.read();
      deadline.throwIfAborted();
      if (item.done) break;
      touch();
      bytes += item.value.byteLength;
      if (bytes > 65536) throw new Error('模型服务错误响应过大，已停止接收，请重试。');
      text += decoder.decode(item.value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch (error) {
    deadline.throwIfAborted();
    throw networkFailure(error);
  } finally {
    clearTimeout(timer);
    deadline.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

// Bound waiting for HTTP headers, not the total duration of an active response.
export async function requestResponse(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs = 300000,
) {
  const waiting = new AbortController();
  const timer = setTimeout(
    () =>
      waiting.abort(
        new ChatServiceError({
          code: 'response_headers_timeout',
          message: '等待模型服务响应超时，请稍后重试。',
        }),
      ),
    timeoutMs,
  );
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.any([signal, waiting.signal]) });
  } catch (error) {
    signal.throwIfAborted();
    waiting.signal.throwIfAborted();
    throw networkFailure(error);
  } finally {
    clearTimeout(timer);
  }
}

// Some transports buffer a completed Responses object or omit the SSE MIME type.
// Inspect a bounded prefix, never discard a valid answer based on headers alone.
export async function* responseEvents(
  response: Response,
  signal: AbortSignal,
  idleTimeoutMs = 300000,
) {
  const idle = new AbortController();
  signal = AbortSignal.any([signal, idle.signal]);
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        idle.abort(
          new ChatServiceError({
            code: 'response_idle_timeout',
            message: '模型服务长时间没有新数据，已停止等待并保留收到的内容。请重试回答。',
          }),
        ),
      idleTimeoutMs,
    );
  };
  if (!response.body)
    throw new ChatServiceError({ code: 'empty_response', message: '服务返回空响应，请重试。' });
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
    while (
      prefix.trimStart().length < 16 &&
      !/^(?:[{<]|data:|event:|:)/.test(prefix.trimStart()) &&
      bytes < 4096
    ) {
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
      for (const [output_index, output] of value.output.entries()) {
        yield { type: 'response.output_item.added', output_index, item: output };
        for (const content of output.content ?? []) {
          if (content.type === 'output_text' && typeof content.text === 'string')
            yield {
              type: 'response.output_text.delta',
              delta: content.text,
              output_index,
            };
          if (content.type === 'refusal' && typeof content.refusal === 'string')
            yield { type: 'response.refusal.delta', delta: content.refusal };
        }
        yield { type: 'response.output_item.done', output_index, item: output };
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
  } catch (error) {
    signal.throwIfAborted();
    throw networkFailure(error);
  } finally {
    clearTimeout(timer!);
    signal.removeEventListener('abort', cancel);
    if (!handedOff) {
      cancel();
      reader.releaseLock();
    }
  }
}
