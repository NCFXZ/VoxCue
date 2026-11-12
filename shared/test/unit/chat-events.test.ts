import { afterEach, expect, it, vi } from 'vitest';
import { batchChatEvents } from '../../electron/backend/chat/events';

afterEach(() => vi.useRealTimers());

it('shows the first delta immediately and batches subsequent text without losing ordering', async () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const events = batchChatEvents(send, new AbortController().signal, () => true);
  events.emit({ id: 'request', type: 'delta', text: 'First' });
  for (let i = 0; i < 100; i++) events.emit({ id: 'request', type: 'delta', text: String(i) });
  expect(send).toHaveBeenCalledExactlyOnceWith({ id: 'request', type: 'delta', text: 'First' });
  await vi.advanceTimersByTimeAsync(40);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].text).toBe(
    Array.from({ length: 100 }, (_, i) => String(i)).join(''),
  );
  events.emit({ id: 'request', type: 'delta', text: 'Before sources' });
  events.emit({ id: 'request', type: 'sources', sources: [] });
  expect(send.mock.calls.slice(-2).map(([event]) => event.type)).toEqual(['delta', 'sources']);
  events.emit({ id: 'request', type: 'delta', text: 'Final text' });
  events.finish();
  expect(send).toHaveBeenLastCalledWith({ id: 'request', type: 'delta', text: 'Final text' });
  events.emit({ id: 'request', type: 'delta', text: 'Late after completion' });
  await vi.advanceTimersByTimeAsync(100);
  expect(send).toHaveBeenCalledTimes(5);
});

it.each(['cancel', 'replace'] as const)('drops queued text after ownership %s', async (kind) => {
  vi.useFakeTimers();
  const send = vi.fn();
  const controller = new AbortController();
  let current = true;
  const events = batchChatEvents(send, controller.signal, () => current);
  events.emit({ id: 'old', type: 'delta', text: 'Visible' });
  events.emit({ id: 'old', type: 'delta', text: 'Stale queued text' });
  if (kind === 'cancel') controller.abort();
  else current = false;
  await vi.advanceTimersByTimeAsync(100);
  events.finish();
  events.emit({ id: 'old', type: 'delta', text: 'Late provider event' });
  expect(send).toHaveBeenCalledOnce();
});
