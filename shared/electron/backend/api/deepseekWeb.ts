import type { ChatActivity, ChatSource } from '../../contracts/chat';
import { record } from '../chat/models';
import { sourceKey, validSource } from '../chat/validation';
import { responseActivity } from '../chat/activity';

type WebAction = 'web_search' | 'open_page' | 'find_in_page';
type Status = NonNullable<ChatActivity['status']>;

function webAction(call: Record<string, unknown>): WebAction | undefined {
  const action = record(call.action)?.type;
  if (call.type !== 'deepseek_web_search') return;
  if (action === 'search') return 'web_search';
  if (action === 'open_page' || action === 'find_in_page') return action;
}

export class DeepSeekWebResults {
  readonly sources = new Map<string, ChatSource>();
  private calls = new Map<string, { action: WebAction; status: Status; detail?: string; url?: string }>();
  private searchFinished = false;

  get completedSearch() {
    return this.searchFinished;
  }

  ingest(value: unknown, publishActivity: (activity: ChatActivity) => void): boolean {
    const choice = record(value);
    if (!choice) return false;
    const previousSize = this.sources.size;
    const progress = record(choice.server_tool_event);
    if (progress?.type === 'call_started' || progress?.type === 'call_completed')
      this.receiveCall(progress.call, progress.type === 'call_started', publishActivity);

    const delta = record(choice.delta);
    if (Array.isArray(delta?.server_tool_calls)) {
      for (const step of delta.server_tool_calls) {
        const calls = record(step)?.calls;
        if (Array.isArray(calls))
          for (const call of calls) this.receiveCall(call, false, publishActivity);
      }
    }
    if (Array.isArray(delta?.annotations)) {
      for (const entry of delta.annotations) {
        const annotation = record(entry);
        if (annotation?.type === 'url_citation') this.addSource(annotation.url_citation);
      }
    }
    return this.sources.size !== previousSize;
  }

  private receiveCall(value: unknown, started: boolean, publishActivity: (activity: ChatActivity) => void) {
    const call = record(value);
    if (!call || typeof call.id !== 'string' || !/^[\w-]{1,160}$/.test(call.id)) return;
    const prior = this.calls.get(call.id);
    const action = call.action === undefined ? prior?.action : webAction(call);
    if (!action || (prior && prior.action !== action)) return;
    const status = started ? 'in_progress' : call.status;
    if (status !== 'in_progress' && status !== 'completed' && status !== 'failed') return;
    if (prior && prior.status !== 'in_progress' && prior.status !== status) return;

    const metadata = responseActivity({
      type: status === 'in_progress' ? 'response.output_item.added' : 'response.output_item.done',
      item: { ...call, type: 'web_search_call', action: record(call.action) ?? { type: action }, status },
    });
    const detail = metadata?.detail || prior?.detail;
    const url = metadata?.url || prior?.url;
    if ((prior?.status !== status || prior?.detail !== detail || prior?.url !== url) &&
      (prior || this.calls.size < 100)) {
      this.calls.set(call.id, { action, status, detail, url });
      publishActivity({
        id: `deepseek-${call.id}`,
        kind: action,
        phase: action === 'web_search' ? 'searching' : 'reading',
        status,
        ...(detail ? { detail } : {}),
        ...(url ? { url } : {}),
      });
    }
    if (status !== 'completed') return;
    if (action === 'web_search') this.searchFinished = true;
    if (Array.isArray(call.sources)) {
      for (const source of call.sources)
        if (record(source)?.type === 'url') this.addSource(source);
    }
    this.addSource(call.page);
  }

  private addSource(value: unknown) {
    if (this.sources.size >= 300) return;
    const source = validSource(value);
    const key = source && sourceKey(source.url);
    if (source && key && !this.sources.has(key)) this.sources.set(key, source);
  }
}
