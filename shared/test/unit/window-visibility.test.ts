import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WindowVisibility } from '../../electron/windowVisibility';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());
function setup(visible = false, reduced = false) {
  const state = { visible, opacity: 0.7, destroyed: false };
  const window = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    getOpacity: () => state.opacity,
    setOpacity: vi.fn((value: number) => {
      state.opacity = value;
    }),
    showInactive: vi.fn(() => {
      state.visible = true;
    }),
    hide: vi.fn(() => {
      state.visible = false;
    }),
  };
  const failure = vi.fn();
  return {
    state,
    window,
    failure,
    visibility: new WindowVisibility(window, () => reduced, failure),
  };
}
it('fades both directions without moving/resizing and restores the original opacity after hiding', async () => {
  const f = setup();
  const shown = f.visibility.set(true);
  expect(f.state).toMatchObject({ visible: true, opacity: 0 });
  vi.advanceTimersByTime(80);
  expect(f.state.opacity).toBeGreaterThan(0);
  expect(f.state.opacity).toBeLessThan(0.7);
  vi.advanceTimersByTime(80);
  expect(await shown).toBe(true);
  expect(f.state.opacity).toBe(0.7);
  const hidden = f.visibility.set(false);
  expect(f.visibility.visible).toBe(false);
  expect(f.state.visible).toBe(true);
  vi.advanceTimersByTime(160);
  expect(await hidden).toBe(true);
  expect(f.state).toMatchObject({ visible: false, opacity: 0.7 });
  expect(f.window.hide).toHaveBeenCalledOnce();
});
it('reverses from the current opacity and only completes the latest visibility intent', async () => {
  const f = setup(true);
  const hidden = f.visibility.set(false);
  vi.advanceTimersByTime(64);
  const middle = f.state.opacity;
  const shown = f.visibility.set(true);
  expect(f.state.opacity).toBe(middle);
  expect(await hidden).toBe(false);
  vi.advanceTimersByTime(160);
  expect(await shown).toBe(true);
  expect(f.state).toMatchObject({ visible: true, opacity: 0.7 });
  expect(f.window.hide).not.toHaveBeenCalled();
});
it('shares an in-flight intent so close can wait for H to finish hiding', async () => {
  const f = setup(true);
  const first = f.visibility.set(false);
  expect(f.visibility.set(false)).toBe(first);
  vi.advanceTimersByTime(160);
  expect(await first).toBe(true);
});
it('honors reduced motion immediately and never leaves the original opacity changed', async () => {
  const f = setup(false, true);
  expect(await f.visibility.set(true)).toBe(true);
  expect(f.state).toMatchObject({ visible: true, opacity: 0.7 });
  expect(await f.visibility.set(false)).toBe(true);
  expect(f.state).toMatchObject({ visible: false, opacity: 0.7 });
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels pending callbacks on destruction/disposal and cannot reveal an old surface', async () => {
  const f = setup();
  const shown = f.visibility.set(true);
  f.state.destroyed = true;
  f.visibility.dispose();
  expect(await shown).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(await f.visibility.set(true)).toBe(false);
});
it.each([false, true])(
  'routes native opacity failures to controlled cleanup without an unhandled timer (delayed: %s)',
  async (delayed) => {
    const f = setup();
    if (!delayed)
      f.window.setOpacity.mockImplementationOnce(() => {
        throw Error('Native opacity failed');
      });
    const shown = f.visibility.set(true);
    if (delayed) {
      f.window.setOpacity.mockImplementationOnce(() => {
        throw Error('Native opacity failed');
      });
      vi.advanceTimersByTime(16);
    }
    expect(await shown).toBe(false);
    expect(f.failure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.state.opacity).toBe(0.7);
  },
);
