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
    return { phase: 'searching', ...actionIdentity(event.item_id, 'web_search', 'in_progress') };
  if (event.type === 'response.web_search_call.completed')
    return { phase: 'processing', ...actionIdentity(event.item_id, 'web_search', 'completed') };
  if (['response.output_item.added', 'response.output_item.done'].includes(event.type)) {
    const item = event.item;
    if (item?.type === 'reasoning') return { phase: 'thinking' };
    if (item?.type === 'web_search_call') {
      const action = item.action;
      const status =
        item.status === 'failed'
          ? 'failed'
          : item.status === 'completed' || event.type.endsWith('.done')
            ? 'completed'
            : 'in_progress';
      const identity = actionIdentity(
        item.id,
        action?.type === 'open_page' || action?.type === 'find_in_page'
          ? action.type
          : 'web_search',
        status,
      );
      if (action?.type === 'search')
        return {
          phase: 'searching',
          ...identity,
          detail:
            (Array.isArray(action.queries) ? action.queries : [action.query])
              .filter((query: unknown) => typeof query === 'string')
              .slice(0, 16)
              .map((query: string) => query.slice(0, 512))
              .join(' · ')
              .slice(0, 4096) || undefined,
        };
      if (action?.type === 'open_page' || action?.type === 'find_in_page') {
        try {
          const url = new URL(action.url);
          if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
            return {
              phase: 'reading',
              ...identity,
              detail: `${url.hostname}${url.pathname}`.slice(0, 512),
              ...(identity.id ? { url: `${url.origin}${url.pathname}`.slice(0, 2048) } : {}),
            };
        } catch {
          /* Invalid metadata must not break the response. */
        }
      }
      return { phase: 'searching', ...identity };
    }
  }
  if (['response.output_text.delta', 'response.refusal.delta'].includes(event.type))
    return { phase: 'writing' };
}

function actionIdentity(
  id: unknown,
  kind: NonNullable<ChatActivity['kind']>,
  status: NonNullable<ChatActivity['status']>,
): Partial<ChatActivity> {
  return typeof id === 'string' && /^[\w-]{1,160}$/.test(id) ? { id, kind, status } : {};
}
