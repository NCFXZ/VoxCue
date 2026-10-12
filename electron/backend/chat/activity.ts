import type { ChatActivity } from '../../contracts/chat';
// Expose public progress metadata, never reasoning text or tool arguments.
export function responseActivity(event: any): ChatActivity | undefined {
  if (['response.queued', 'response.created'].includes(event.type)) return { phase: 'waiting' };
  if (event.type === 'response.in_progress') return { phase: 'processing' };
  if (event.type?.startsWith('response.reasoning_')) return { phase: 'thinking' };
  if (
    ['response.web_search_call.in_progress', 'response.web_search_call.searching'].includes(
      event.type,
    )
  )
    return { phase: 'searching' };
  if (event.type === 'response.web_search_call.completed') return { phase: 'processing' };
  if (['response.output_item.added', 'response.output_item.done'].includes(event.type)) {
    const item = event.item;
    if (item?.type === 'reasoning') return { phase: 'thinking' };
    if (item?.type === 'web_search_call') {
      const action = item.action;
      if (action?.type === 'search')
        return {
          phase: 'searching',
          detail: typeof action.query === 'string' ? action.query.slice(0, 160) : undefined,
        };
      if (action?.type === 'open_page' || action?.type === 'find_in_page') {
        try {
          const url = new URL(action.url);
          if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
            return { phase: 'reading', detail: `${url.hostname}${url.pathname}`.slice(0, 160) };
        } catch {
          /* Invalid metadata must not break the response. */
        }
      }
      return { phase: 'searching' };
    }
  }
  if (['response.output_text.delta', 'response.refusal.delta'].includes(event.type))
    return { phase: 'writing' };
}
