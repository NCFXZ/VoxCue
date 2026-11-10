import { expect, it, vi } from 'vitest';
import { revealExistingInterview } from '../../electron/interviewActivation';
import { WindowVisibility } from '../../electron/windowVisibility';

it('reveals the same hidden interview on repeated activation without replacing its content or panel preferences', async () => {
  const content = {
    sessionId: 'synthetic-session',
    transcripts: ['synthetic text'],
    collapsed: true,
    transcriptVisible: false,
    microphoneMuted: true,
  };
  const state = { visible: false, minimized: true, destroyed: false, opacity: 0.8 };
  const window = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    getOpacity: () => state.opacity,
    setOpacity: (value: number) => {
      state.opacity = value;
    },
    showInactive: vi.fn(() => {
      state.visible = true;
    }),
    hide: vi.fn(() => {
      state.visible = false;
    }),
    restore: vi.fn(() => {
      state.minimized = false;
    }),
    focus: vi.fn(),
    content,
  };
  const visibility = new WindowVisibility(window, () => true);
  const callbacks = new WeakMap<typeof window, (focus: boolean) => void>();
  const reveal = vi.fn((focus: boolean) => {
    if (state.minimized) window.restore();
    void visibility.set(true);
    if (focus) window.focus();
  });
  callbacks.set(window, reveal);
  expect(revealExistingInterview(window, callbacks)).toBe(true);
  expect(revealExistingInterview(window, callbacks)).toBe(true);
  expect(state).toMatchObject({ visible: true, minimized: false, opacity: 0.8 });
  expect(window.showInactive).toHaveBeenCalledOnce();
  expect(window.restore).toHaveBeenCalledOnce();
  expect(reveal.mock.calls).toEqual([[true], [true]]);
  expect(window.content).toBe(content);
  expect(content).toEqual({
    sessionId: 'synthetic-session',
    transcripts: ['synthetic text'],
    collapsed: true,
    transcriptVisible: false,
    microphoneMuted: true,
  });
  visibility.dispose();
});

it('delegates an initializing interview to its existing readiness gate instead of showing it directly', () => {
  const window = { isDestroyed: () => false, show: vi.fn(), focus: vi.fn() };
  const queuedReveal = vi.fn();
  const callbacks = new WeakMap([[window, queuedReveal]]);
  expect(revealExistingInterview(window, callbacks)).toBe(true);
  expect(queuedReveal).toHaveBeenCalledExactlyOnceWith(true);
  expect(window.show).not.toHaveBeenCalled();
  expect(window.focus).not.toHaveBeenCalled();
  // A live window without its reveal callback is still owned, so activation
  // must not treat it as permission to create a replacement interview.
  callbacks.delete(window);
  expect(revealExistingInterview(window, callbacks)).toBe(true);
});

it('ignores absent or destroyed interviews and never invokes a callback owned by another window', () => {
  const failed = { isDestroyed: () => true };
  const live = { isDestroyed: () => false };
  const oldReveal = vi.fn();
  const callbacks = new WeakMap([[failed, oldReveal]]);
  expect(revealExistingInterview(null, callbacks)).toBe(false);
  expect(revealExistingInterview(failed, callbacks)).toBe(false);
  expect(revealExistingInterview(live, callbacks)).toBe(true);
  expect(oldReveal).not.toHaveBeenCalled();
});
