import { record } from '../chat/models';
import { ResponseText } from '../chat/responseText';
import { responseEvents } from '../chat/responses';
import { validSource } from '../chat/validation';

export const deepSeekProSearchModel = 'deepseek-v4-pro';
const supportedEfforts = new Set(['low', 'high', 'max']);
const compatibleFields = new Set(['model', 'messages', 'stream', 'stream_options', 'thinking', 'reasoning_effort', 'response_format']);

export function prepareDeepSeekResponsesRequest(body: string | Blob) {
  if (typeof body !== 'string') return;
  const request = record(JSON.parse(body));
  if (request?.model !== deepSeekProSearchModel || request.stream !== true ||
      !Array.isArray(request.messages) || Object.keys(request).some(key => !compatibleFields.has(key))) return;
  if (request.stream_options !== undefined) {
    const options = record(request.stream_options);
    if (options?.include_usage !== true || Object.keys(options).length !== 1) return;
  }
  const format = record(request.response_format);
  if (request.response_format !== undefined && (format?.type !== 'json_object' || Object.keys(format).length !== 1)) return;

  const thinking = record(request.thinking);
  const effort = request.reasoning_effort;
  let reasoning: { effort: string } | undefined;
  if (thinking?.type === 'enabled' && typeof effort === 'string' && supportedEfforts.has(effort)) {
    reasoning = { effort };
  } else if (thinking?.type === 'disabled' && effort === undefined) {
    reasoning = { effort: 'none' };
  } else if (request.thinking !== undefined || effort !== undefined) {
    return;
  }
  if (thinking && Object.keys(thinking).length !== 1) return;

  let instructions: string | undefined;
  const input: { type: 'message'; role: 'user' | 'assistant'; content: string }[] = [];
  for (const entry of request.messages) {
    const message = record(entry);
    if (typeof message?.content !== 'string' ||
        Object.keys(message).some(key => key !== 'role' && key !== 'content')) return;
    if (message.role === 'system' && instructions === undefined && !input.length) {
      instructions = message.content;
    } else if (message.role === 'user' || message.role === 'assistant') {
      input.push({ type: 'message', role: message.role, content: message.content });
    } else {
      return;
    }
  }
  if (input.at(-1)?.role !== 'user') return;

  return {
    url: 'https://api.deepseek.com/responses',
    body: JSON.stringify({
      model: deepSeekProSearchModel,
      instructions,
      input,
      reasoning,
      stream: true,
      ...(format ? { text: { format } } : {}),
      tools: [{ type: 'web_search' }],
    }),
  };
}

function webCitation(value: unknown) {
  if (record(value)?.type !== 'url_citation') return;
  const source = validSource(value);
  if (source) return { type: 'url_citation', url_citation: source };
}

type WebAction = 'search' | 'open_page' | 'find_in_page';

function webAction(value: unknown): WebAction | undefined {
  const type = record(value)?.type;
  if (type === 'search' || type === 'open_page' || type === 'find_in_page') return type;
}

function* outputEvents(value: unknown, started = false, knownAction?: WebAction) {
  const item = record(value);
  if (item?.type === 'web_search_call') {
    if (typeof item.id !== 'string' || !/^[\w-]{1,160}$/.test(item.id)) return;
    const action = record(item.action);
    const type = item.action === undefined ? knownAction : webAction(action);
    if (!type) return;
    const status = started ? 'in_progress' : item.status;
    if (status !== 'completed' && status !== 'failed' && status !== 'in_progress') return;
    const sources = [];
    if (status === 'completed' && Array.isArray(action?.sources)) {
      for (const value of action.sources) {
        if (record(value)?.type !== 'url') continue;
        const source = validSource(value);
        if (source) sources.push({ ...source, type: 'url' });
        if (sources.length === 300) break;
      }
    }
    const page = status === 'completed' ? validSource(item.page) ?? undefined : undefined;
    const actionUrl = type !== 'search' ? validSource({ url: action?.url }) : undefined;
    yield { choices: [{ server_tool_event: {
      type: status === 'in_progress' ? 'call_started' : 'call_completed',
      call: { id: item.id, type: 'deepseek_web_search', action: {
        type,
        ...(type === 'search' && Array.isArray(action?.queries) ? {
          queries: action.queries.filter((query: unknown) => typeof query === 'string')
            .slice(0, 16).map((query: string) => query.slice(0, 512)),
        } : {}),
        ...(actionUrl ? { url: actionUrl.url } : {}),
        ...(type === 'find_in_page' && typeof action?.pattern === 'string' ? { pattern: action.pattern.slice(0, 512) } : {}),
      }, status, sources, page },
    } }] };
  } else if (!started && item?.type === 'message' && item.phase !== 'commentary' && Array.isArray(item.content)) {
    for (const value of item.content) {
      const part = record(value);
      if (part?.type !== 'output_text' || !Array.isArray(part.annotations)) continue;
      const annotations = part.annotations.flatMap(entry => webCitation(entry) ?? []);
      if (annotations.length) yield { choices: [{ delta: { annotations } }] };
    }
  }
}

function responseIndex(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 1000) return value;
}

interface ResponseItem {
  id: unknown;
  type: unknown;
  phase: unknown;
  content: unknown[];
  webAction?: WebAction;
}

function textItem(value: unknown): ResponseItem | undefined {
  const item = record(value);
  if (!item) return;
  return {
    id: item.id,
    type: item.type,
    phase: item.phase,
    content: item.type === 'message' && Array.isArray(item.content) ? item.content : [],
    ...(item.type === 'web_search_call' ? { webAction: webAction(item.action) } : {}),
  };
}

function previousWebAction(item: ResponseItem | undefined, previous: ResponseItem | undefined): WebAction | undefined {
  if (item?.type === 'web_search_call' && typeof item.id === 'string' && item.id === previous?.id)
    return previous.webAction;
}

export async function* deepSeekResponsesEvents(response: Response, signal: AbortSignal) {
  const streamedText = new ResponseText();
  const streamedItems = new Map<number, ResponseItem & { done: boolean }>();
  const commentaryIds = new Set<string>();
  let refused = false;
  let inconsistent = false;
  for await (const value of responseEvents(response, signal)) {
    const event = record(value);
    if (!event || event.type === 'error' || event.error) {
      yield { type: 'error' };
      return;
    }

    const index = responseIndex(event.output_index);
    const previous = index === undefined ? undefined : streamedItems.get(index);
    const publicText = !previous || (previous.type === 'message' && previous.phase !== 'commentary');
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
      const item = textItem(event.item);
      const done = event.type === 'response.output_item.done';
      const commentary = item?.phase === 'commentary' || previous?.phase === 'commentary';
      const knownAction = previousWebAction(item, previous);
      if (commentary && typeof item?.id === 'string') commentaryIds.add(item.id);
      if (index !== undefined && item && (done || !previous?.done)) {
        if (previous?.id && item.id && previous.id !== item.id) inconsistent = true;
        const content = item.content.length ? item.content : previous?.content ?? [];
        streamedItems.set(index, { ...item, id: item.id ?? previous?.id,
          phase: commentary ? 'commentary' : item.phase ?? previous?.phase, content, done,
          ...(knownAction && record(event.item)?.action === undefined ? { webAction: knownAction } : {}),
        });
      }
      if (!commentary) yield* outputEvents(event.item, !done, knownAction);
    } else if (event.type === 'response.web_search_call.in_progress' || event.type === 'response.web_search_call.searching' ||
      event.type === 'response.web_search_call.completed') {
      // The standalone event carries identity and status only. Retain the known tool action.
      if (!previous || previous.done || previous.type !== 'web_search_call' || !previous.webAction ||
        previous.id !== event.item_id) continue;
      yield* outputEvents({
        id: previous.id,
        type: previous.type,
        action: { type: previous.webAction },
        status: event.type === 'response.web_search_call.completed' ? 'completed' : 'in_progress',
      });
    } else if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      if (publicText) {
        const itemId = typeof event.item_id === 'string' ? event.item_id : undefined;
        if (previous?.id && itemId && previous.id !== itemId) {
          inconsistent = true;
          continue;
        }
        if (index !== undefined && itemId && !previous)
          streamedItems.set(index, { id: itemId, type: 'message', phase: undefined, content: [], done: false });
        const tracked = previous || itemId ? index : undefined;
        streamedText.append(tracked, responseIndex(event.content_index), false, event.delta);
        yield { choices: [{ delta: { content: event.delta } }] };
      }
    } else if (event.type === 'response.output_text.done' && publicText && typeof event.text === 'string' && index !== undefined) {
      const part = responseIndex(event.content_index);
      const itemId = typeof event.item_id === 'string' ? event.item_id : undefined;
      if (part === undefined) continue;
      if (previous?.id && itemId && previous.id !== itemId) {
        inconsistent = true;
        continue;
      }
      const content = previous?.content.slice() ?? [];
      content[part] = { type: 'output_text', text: event.text };
      streamedItems.set(index, { id: previous?.id ?? itemId, type: 'message', phase: previous?.phase, content, done: true });
    } else if ((event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') && publicText) {
      refused = true;
    } else if (event.type === 'response.reasoning_text.delta' && typeof event.delta === 'string' && event.delta) {
      yield { choices: [{ delta: { reasoning_content: true } }] };
    } else if (event.type === 'response.output_text.annotation.added' && publicText) {
      const annotation = webCitation(event.annotation);
      if (annotation) yield { choices: [{ delta: { annotations: [annotation] } }] };
    } else if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
      const terminal = record(event.response);
      if (event.type !== `response.${terminal?.status}`) {
        yield { type: 'error' };
        return;
      }
      const id = typeof terminal?.id === 'string' ? terminal.id : undefined;
      const usage = record(terminal?.usage);
      const counts = usage && {
        prompt_tokens: usage.input_tokens,
        completion_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
      };
      if (event.type === 'response.failed') {
        yield { type: 'error', id, usage: counts };
        return;
      }
      const reason = record(terminal?.incomplete_details)?.reason;
      const terminalOutput = Array.isArray(terminal?.output) ? terminal.output : [];
      const items = terminalOutput.map((value, index) => {
        const item = textItem(value);
        const previous = streamedItems.get(index);
        if (item && ((typeof item.id === 'string' && commentaryIds.has(item.id)) ||
            (previous?.phase === 'commentary' && previous.id === item.id)))
          return { ...item, phase: 'commentary' };
        return item;
      });
      refused ||= items.some(item => item?.phase !== 'commentary' &&
        item?.content.some(part => record(part)?.type === 'refusal'));
      const finish = refused ? 'content_filter' : event.type === 'response.completed' ? 'stop'
        : reason === 'max_output_tokens' ? 'length'
        : reason === 'content_filter' ? 'content_filter' : 'incomplete';
      if (finish === 'stop') {
        try {
          const { replace, parts } = streamedText.reconcile(items, streamedItems);
          // This adapter can append deltas, but cannot retract a draft already sent.
          if (inconsistent || replace) {
            yield { type: 'error', id, usage: counts };
            return;
          }
          for (const part of parts) {
            if (!part.refusal && part.text) yield { choices: [{ delta: { content: part.text } }] };
          }
        } catch {
          yield { type: 'error', id, usage: counts };
          return;
        }
      }
      if (finish !== 'content_filter') {
        for (const [index, item] of terminalOutput.entries()) {
          if (items[index]?.phase !== 'commentary')
            yield* outputEvents(item, false, previousWebAction(items[index], streamedItems.get(index)));
        }
      }
      yield { id, choices: [{ finish_reason: finish }], usage: counts };
      return;
    }
  }
  signal.throwIfAborted();
}
