export interface ChatActivity {
  phase: 'waiting' | 'thinking' | 'searching' | 'reading' | 'writing' | 'processing' | 'organizing';
  detail?: string;
  id?: string;
  kind?:
    | 'web_search'
    | 'open_page'
    | 'find_in_page'
    | 'commentary'
    | 'knowledge'
    | 'reasoning'
    | 'status';
  status?: 'in_progress' | 'completed' | 'failed';
  url?: string;
}

// Keep only public, identified actions. A status-only event must not erase metadata
// that arrived with the same tool item, and late progress cannot reopen a finished action.
export function mergeActivityLog(
  history: ChatActivity[] = [],
  activity: ChatActivity,
): ChatActivity[] {
  if (!activity.id || !activity.kind || activity.id.length > 200) return history;
  const index = history.findIndex((item) => item.id === activity.id);
  const previous = index >= 0 ? history[index] : undefined;
  const next = {
    ...previous,
    ...activity,
    ...(previous && activity.phase === 'processing' && !activity.detail
      ? { kind: previous.kind, phase: previous.phase }
      : {}),
    ...(previous?.detail && !activity.detail ? { detail: previous.detail } : {}),
    ...(previous?.url && !activity.url ? { url: previous.url } : {}),
    ...(previous?.status === 'completed' && activity.status === 'in_progress'
      ? { status: 'completed' as const }
      : {}),
  };
  if (index >= 0) return history.map((item, position) => (position === index ? next : item));
  if (activity.kind === 'status') {
    // A late completion cannot restore a status already replaced by a newer one.
    if (activity.status === 'completed') return history;
    const lastState = history.map((item) => item.kind).lastIndexOf('status');
    if (
      lastState >= 0 &&
      !history.slice(lastState + 1).some((item) => item.kind === 'reasoning' && item.detail?.trim())
    )
      history = history.filter((_, position) => position !== lastState);
  }
  return history.length < 100 ? [...history, next] : history;
}
