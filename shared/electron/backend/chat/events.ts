import type { ChatEvent } from '../../contracts/chat';

// Keep first-token feedback immediate, then merge text between visible updates.
// Ownership and cancellation are checked again when the deferred batch is sent.
export function batchChatEvents(
  send: (event: ChatEvent) => void,
  signal: AbortSignal,
  current: () => boolean,
) {
  let first = true;
  let finished = false;
  let pending: Extract<ChatEvent, { type: 'delta' }> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    clear();
    const event = pending;
    pending = undefined;
    if (event && !signal.aborted && current()) send(event);
  };
  const discard = () => {
    clear();
    pending = undefined;
  };
  signal.addEventListener('abort', discard, { once: true });
  return {
    emit(event: ChatEvent) {
      if (finished || signal.aborted || !current()) return;
      if (event.type !== 'delta') {
        flush();
        send(event);
      } else if (first || event.replace) {
        // A replacement starts a new draft, so queued text from the old draft is obsolete.
        discard();
        first = false;
        send(event);
      } else {
        if (pending) pending.text += event.text;
        else pending = { ...event };
        if (!timer) timer = setTimeout(flush, 40);
      }
    },
    finish() {
      if (finished) return;
      flush();
      finished = true;
      signal.removeEventListener('abort', discard);
    },
  };
}
