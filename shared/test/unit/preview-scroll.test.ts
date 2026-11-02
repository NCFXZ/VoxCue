import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPreviewScroll } from '../../src/components/ui/preview-scroll';

class ScrollNode extends EventTarget {
  clientHeight = 600;
  scrollHeight = 2400;
  scrollTop = 0;
  firstElementChild = { clientHeight: 600 };
  properties = new Map<string, string>();
  style = {
    setProperty: (key: string, value: string) => this.properties.set(key, value),
    removeProperty: (key: string) => this.properties.delete(key),
  };
  fire(type: string, fields = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), fields);
    this.dispatchEvent(event);
    return event;
  }
  wheel(deltaY: number, fields = {}) {
    return this.fire('wheel', { deltaY, deltaX: 0, deltaMode: 0, ctrlKey: false, ...fields });
  }
  bottom() {
    this.scrollTop = this.scrollHeight - this.clientHeight;
    this.fire('scroll');
  }
}

let node: ScrollNode;
let media: EventTarget & { matches: boolean };
let doc: EventTarget & { hidden: boolean };
let intersect: (visible: boolean) => void;
let dispose: () => void;
let fold: number;
let hidden: boolean;
let toggle: EventTarget;
let controls: EventTarget;
let effects: {
  fold: ReturnType<typeof vi.fn>;
  reveal: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    Number(setTimeout(() => callback(performance.now()), 16)),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  media = Object.assign(new EventTarget(), { matches: false });
  doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: object[]) => void) {
        intersect = (visible) =>
          callback([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  node = new ScrollNode();
  fold = 0;
  hidden = true;
  effects = {
    fold: vi.fn((progress: number) => {
      fold = progress;
    }),
    reveal: vi.fn(() => {
      hidden = false;
      node.scrollHeight += node.clientHeight;
    }),
    reset: vi.fn(() => {
      hidden = true;
      fold = 0;
      node.scrollTop = 0;
      node.scrollHeight = 2400;
    }),
  };
  toggle = new EventTarget();
  controls = new EventTarget();
  dispose = installPreviewScroll(
    node as unknown as HTMLElement,
    effects,
    toggle as HTMLButtonElement,
    controls as HTMLElement,
  );
});
afterEach(() => {
  dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('waits for visibility, then starts and stops gently at half photo/half text once', () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    Number(setTimeout(() => callback(performance.now()), 10)),
  );
  vi.advanceTimersByTime(2000);
  expect(node.scrollTop).toBe(0);
  intersect(true);
  vi.advanceTimersByTime(1000);
  expect(node.scrollTop).toBe(0);
  const samples = [node.scrollTop];
  for (let frame = 0; frame < 100; frame++) {
    vi.advanceTimersByTime(10);
    samples.push(node.scrollTop);
  }
  expect(samples[8]).toBeGreaterThan(0);
  expect(samples[8]).toBeLessThan(300 * 0.01);
  expect(300 - samples[92]).toBeLessThan(300 * 0.01);
  for (let frame = 0; frame <= 100; frame++) {
    expect(samples[frame] + samples[100 - frame]).toBeCloseTo(300, 8);
    if (frame < 100)
      expect(samples[frame + 1] - samples[frame]).toBeCloseTo(
        samples[100 - frame] - samples[99 - frame],
        8,
      );
  }
  expect(samples.every((top, i) => !i || top >= samples[i - 1])).toBe(true);
  expect(node.scrollTop).toBe(300);
  intersect(false);
  intersect(true);
  vi.advanceTimersByTime(3000);
  expect(node.scrollTop).toBe(300);
});

it.each([400, 1300])('manual input at %ims stops the hint without a late write', (when) => {
  intersect(true);
  vi.advanceTimersByTime(when);
  expect(node.wheel(80).defaultPrevented).toBe(false);
  node.scrollTop += 80;
  node.fire('scroll');
  const manual = node.scrollTop;
  vi.advanceTimersByTime(3000);
  expect(node.scrollTop).toBe(manual);
});

it.each(['pointerdown', 'keydown'])(
  'using preview controls with %s cancels the opening hint',
  (type) => {
    intersect(true);
    vi.advanceTimersByTime(400);
    controls.dispatchEvent(new Event(type));
    vi.advanceTimersByTime(3000);
    expect(node.scrollTop).toBe(0);
    expect(hidden).toBe(true);
  },
);

it('keeps the picture hidden below the threshold and reverses an interrupted fold', () => {
  intersect(true);
  node.bottom();
  expect(node.wheel(80).defaultPrevented).toBe(true);
  const first = fold;
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(1);
  const offset = Number.parseFloat(node.properties.get('--preview-overscroll')!);
  expect(offset).toBeLessThan(0);
  expect(offset).toBeGreaterThan(-96);
  expect(node.scrollTop).toBe(1800);
  expect(hidden).toBe(true);
  node.wheel(-25);
  expect(fold).toBeGreaterThan(0);
  expect(fold).toBeLessThan(first);
  vi.advanceTimersByTime(250);
  expect(fold).toBeLessThan(first);
  vi.advanceTimersByTime(1500);
  expect(fold).toBe(0);
  expect(node.properties.size).toBe(0);
  expect(effects.reveal).not.toHaveBeenCalled();
});

it('plays the first reveal to completion despite input, then follows normal scrolling', () => {
  intersect(true);
  node.bottom();
  node.wheel(100);
  expect(hidden).toBe(true);
  for (let step = 0; step < 7; step++) {
    vi.advanceTimersByTime(160);
    node.wheel(160);
    if (step < 6) expect(hidden).toBe(true);
  }
  expect(hidden).toBe(false);
  expect(fold).toBe(1);
  toggle.dispatchEvent(new Event('click'));
  expect(fold).toBe(1);
  expect(effects.reveal).toHaveBeenCalledTimes(1);
  expect(node.scrollTop).toBeGreaterThan(1800);
  expect(node.scrollTop).toBeLessThan(2400);
  const handoff = node.scrollTop;
  vi.advanceTimersByTime(120);
  expect(node.scrollTop).toBeGreaterThan(handoff);
  expect(node.scrollTop).toBeLessThan(2400);
  expect(fold).toBe(1);
  expect(node.wheel(-90).defaultPrevented).toBe(true);
  expect(node.fire('keydown', { key: 'Home' }).defaultPrevented).toBe(true);
  expect(node.fire('keydown', { key: 'Escape' }).defaultPrevented).toBe(false);
  expect(node.fire('pointerdown').defaultPrevented).toBe(true);
  const scripted = node.scrollTop;
  node.scrollTop = 0;
  node.fire('scroll');
  expect(node.scrollTop).toBe(scripted);
  vi.advanceTimersByTime(500);
  expect(node.scrollTop).toBe(2400);
  expect(node.wheel(-90).defaultPrevented).toBe(false);
  for (const [top, progress] of [
    [2399.6, 1],
    [2100, 0.5],
    [1800.4, 0],
    [1800, 0],
    [0, 0],
    [2160, 0.6],
    [2400, 1],
  ]) {
    node.scrollTop = top;
    node.fire('scroll');
    expect(fold).toBeCloseTo(progress);
    expect(hidden).toBe(false);
    node.fire('pointerdown');
    expect(fold).toBeCloseTo(progress);
  }
  vi.advanceTimersByTime(1500);
  expect(node.scrollTop).toBe(2400);
  expect(effects.reveal).toHaveBeenCalledTimes(1);
  node.bottom();
  expect(node.wheel(500).defaultPrevented).toBe(false);
  expect(node.properties.size).toBe(0);
  expect(fold).toBe(1);
  dispose();
  expect(hidden).toBe(true);
  expect(node.scrollTop).toBe(0);
  expect(fold).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(node.wheel(500).defaultPrevented).toBe(false);
});

it('toggles the capsule without scrolling or unlocking, and cancels the opening hint', () => {
  intersect(true);
  toggle.dispatchEvent(new Event('click'));
  expect(effects.fold).toHaveBeenLastCalledWith(1, false, true);
  vi.advanceTimersByTime(3000);
  expect(node.scrollTop).toBe(0);
  expect(hidden).toBe(true);
  toggle.dispatchEvent(new Event('click'));
  expect(effects.fold).toHaveBeenLastCalledWith(0, false, true);
  node.scrollTop = 300;
  toggle.dispatchEvent(new Event('click'));
  node.fire('scroll');
  expect(fold).toBe(1); // A queued event at the same position must not undo the click.
  dispose();
  effects.fold.mockClear();
  toggle.dispatchEvent(new Event('click'));
  expect(effects.fold).not.toHaveBeenCalled();
});

it.each([false, true])(
  'keeps manual expansion while scrolling away from and back to the picture (reduced motion: %s)',
  (reduce) => {
    media.matches = reduce;
    intersect(true);
    node.bottom();
    node.fire('keydown', { key: 'End' });
    vi.advanceTimersByTime(500);
    node.fire('scroll');
    expect(hidden).toBe(false);
    toggle.dispatchEvent(new Event('click'));
    expect(effects.fold).toHaveBeenLastCalledWith(0, reduce, true);
    expect(node.scrollTop).toBe(2400);
    for (const top of [2390, 2100, 1800, 100, 2100, 2400]) {
      node.scrollTop = top;
      node.fire('scroll');
      node.fire('pointerdown');
      expect(fold).toBe(0);
    }
    intersect(false);
    intersect(true);
    expect(fold).toBe(0);
    toggle.dispatchEvent(new Event('click'));
    node.bottom();
    expect(fold).toBe(1);
  },
);

it('keeps a manual collapse through scrolling, rebound, reveal and leaving view until expanded', () => {
  intersect(true);
  toggle.dispatchEvent(new Event('click'));
  node.scrollTop = 300;
  node.fire('scroll');
  node.fire('pointerdown');
  expect(fold).toBe(1);
  intersect(false);
  intersect(true);
  expect(fold).toBe(1);
  node.bottom();
  node.wheel(50);
  vi.advanceTimersByTime(2000);
  expect(hidden).toBe(true);
  expect(fold).toBe(1);
  node.fire('keydown', { key: 'End' });
  vi.advanceTimersByTime(500);
  expect(hidden).toBe(false);
  node.scrollTop = 300;
  node.fire('scroll');
  expect(fold).toBe(1);
  toggle.dispatchEvent(new Event('click'));
  expect(fold).toBe(0);
  node.scrollTop += 100;
  node.fire('scroll');
  expect(fold).toBe(0);
});

it('keeps the capsule folded during the first slide and settles at the bottom without delayed movement', () => {
  intersect(true);
  node.bottom();
  node.fire('keydown', { key: 'End' });
  expect(hidden).toBe(false);
  expect(node.scrollTop).toBe(1800);
  vi.advanceTimersByTime(16);
  expect(node.scrollTop).toBeGreaterThan(1800);
  expect(node.scrollTop).toBeLessThan(2400);
  expect(fold).toBe(1);
  vi.advanceTimersByTime(500);
  expect(node.scrollTop).toBe(2400);
  expect(fold).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(node.scrollTop).toBe(2400);
});

it('touch release restores a partial fold; a longer upward swipe reveals the page', () => {
  intersect(true);
  node.bottom();
  node.fire('touchstart', { touches: [{ clientY: 500 }] });
  expect(node.fire('touchmove', { touches: [{ clientY: 450 }] }).defaultPrevented).toBe(true);
  expect(fold).toBeGreaterThan(0);
  node.fire('touchend');
  vi.advanceTimersByTime(1500);
  expect(fold).toBe(0);
  expect(hidden).toBe(true);
  node.fire('touchstart', { touches: [{ clientY: 500 }] });
  node.fire('touchmove', { touches: [{ clientY: 380 }] });
  node.fire('touchmove', { touches: [{ clientY: 250 }] });
  expect(hidden).toBe(true);
  node.fire('touchmove', { touches: [{ clientY: 0 }] });
  expect(hidden).toBe(false);
  expect(node.fire('touchmove', { touches: [{ clientY: 200 }] }).defaultPrevented).toBe(true);
  node.bottom();
  vi.advanceTimersByTime(1000);
  expect(fold).toBe(1);
});

it.each(['offscreen', 'hidden', 'reduced', 'dispose'])(
  '%s still stops the first reveal and releases its scheduled work',
  (reason) => {
    intersect(true);
    node.bottom();
    node.fire('keydown', { key: 'End' });
    vi.advanceTimersByTime(80);
    if (reason === 'offscreen') intersect(false);
    else if (reason === 'hidden') {
      doc.hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
    } else if (reason === 'reduced') {
      media.matches = true;
      media.dispatchEvent(new Event('change'));
    } else dispose();
    const stopped = node.scrollTop;
    vi.advanceTimersByTime(1000);
    expect(node.scrollTop).toBe(stopped);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('large wheel impulses cannot skip the pull, and released attempts do not accumulate', () => {
  intersect(true);
  node.bottom();
  for (let attempt = 0; attempt < 4; attempt++) {
    node.wheel(10000, { deltaMode: attempt % 3 });
    expect(hidden).toBe(true);
    expect(fold).toBeLessThan(0.3);
    vi.advanceTimersByTime(1500);
    expect(fold).toBe(0);
  }
  expect(effects.reveal).not.toHaveBeenCalled();
});

it.each([8, 16, 32])(
  'dense pixel input every %ims needs sustained effort instead of event-count credit',
  (interval) => {
    intersect(true);
    node.bottom();
    for (let elapsed = interval; elapsed <= 400; elapsed += interval) {
      vi.advanceTimersByTime(interval);
      node.wheel(160);
      expect(hidden).toBe(true);
    }
    expect(fold).toBeLessThan(0.5);
    for (let elapsed = 0; elapsed < 1600 && hidden; elapsed += interval) {
      vi.advanceTimersByTime(interval);
      node.wheel(160);
    }
    expect(hidden).toBe(false);
    vi.advanceTimersByTime(500);
    expect(node.scrollTop).toBe(2400);
  },
);

it('a decaying pixel-scroll tail rebounds without revealing the picture', () => {
  intersect(true);
  node.bottom();
  for (const delta of [120, 100, 80, 60, 40, 30, 20, 12, 8, 6, 4, 3, 2, 1, 0.5]) {
    vi.advanceTimersByTime(16);
    node.wheel(delta);
    expect(hidden).toBe(true);
  }
  vi.advanceTimersByTime(1500);
  expect(hidden).toBe(true);
  expect(fold).toBe(0);
  expect(effects.reveal).not.toHaveBeenCalled();
});

it('cleans up finite fold positions when the unlocked preview is detached during settings exit', () => {
  intersect(true);
  node.bottom();
  node.fire('keydown', { key: 'End' });
  expect(hidden).toBe(false);
  node.clientHeight = node.scrollHeight = node.scrollTop = 0;
  dispose();
  expect(effects.fold.mock.calls.every(([progress]) => Number.isFinite(progress))).toBe(true);
  expect(effects.reset).toHaveBeenCalled();
  expect(hidden).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('reduced motion skips movement while retaining wheel and keyboard access to the picture', () => {
  media.matches = true;
  intersect(true);
  vi.advanceTimersByTime(3000);
  expect(node.scrollTop).toBe(0);
  node.bottom();
  node.wheel(60);
  expect(node.properties.size).toBe(0);
  expect(effects.fold).toHaveBeenLastCalledWith(expect.any(Number), true, false);
  expect(node.fire('keydown', { key: 'End' }).defaultPrevented).toBe(true);
  expect(hidden).toBe(false);
  expect(node.scrollTop).toBe(2400);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['offscreen', 'hidden', 'reduced', 'pointer', 'keyboard', 'touchcancel'])(
  '%s cancels transient motion and leaves no queued writes',
  (reason) => {
    intersect(true);
    node.bottom();
    node.wheel(80);
    if (reason === 'offscreen') intersect(false);
    else if (reason === 'hidden') {
      doc.hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
    } else if (reason === 'reduced') {
      media.matches = true;
      media.dispatchEvent(new Event('change'));
    } else if (reason === 'pointer') node.fire('pointerdown');
    else if (reason === 'keyboard') node.fire('keydown', { key: 'Home' });
    else node.fire('touchcancel');
    expect(node.properties.size).toBe(0);
    expect(fold).toBe(0);
    vi.advanceTimersByTime(3000);
    expect(hidden).toBe(true);
    expect(node.scrollTop).toBe(1800);
    expect(vi.getTimerCount()).toBe(0);
  },
);
