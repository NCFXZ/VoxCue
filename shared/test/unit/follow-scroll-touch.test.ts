import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { KeyboardEvent, TouchEvent, UIEvent, WheelEvent } from 'react';
const effects = vi.hoisted(() => [] as Array<() => void>);
vi.mock('react', () => ({
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
  useLayoutEffect: (effect: () => void) => effects.push(effect),
}));
import { useFollowScroll } from '../../src/components/useFollowScroll';

class ScrollNode {
  clientHeight = 300;
  scrollHeight = 900;
  lastElementChild = {} as Element;
  private top = 0;
  get scrollTop() { return this.top; }
  set scrollTop(value: number) { this.top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); }
  focus = vi.fn();
}
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0, now = 0;
const paint = () => {
  now += 16;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback(now));
};
const touch = (...positions: number[]) => ({ touches: positions.map((clientY) => ({ clientY })) }) as TouchEvent;
const setup = (rememberPosition = false) => {
  const scroll = useFollowScroll(['first'], 'session', { rememberPosition });
  const node = new ScrollNode();
  scroll.scrollProps.ref.current = node as unknown as HTMLDivElement;
  effects.splice(0).forEach((effect) => effect());
  const scrollFrame = (top: number) => {
    node.scrollTop = top;
    scroll.scrollProps.onScroll({ currentTarget: node } as unknown as UIEvent<HTMLDivElement>);
  };
  const advance = () => {
    const before = node.scrollTop;
    paint();
    if (before !== node.scrollTop) scrollFrame(node.scrollTop);
  };
  const settle = () => {
    for (let i = 0; frames.size && i < 120; i++) advance();
    expect(frames.size).toBe(0);
  };
  return { scroll, node, scrollFrame, advance, settle };
};
beforeEach(() => {
  effects.splice(0);
  frames.clear();
  frameId = 0;
  now = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());

it('pauses following before a touch scroll and resumes only after returning to latest', () => {
  const { scroll, node, advance, settle } = setup();
  expect(node.scrollTop).toBe(600);
  scroll.scrollProps.onTouchStart(touch(100));
  for (const y of [102, 104, 106]) scroll.scrollProps.onTouchMove(touch(y));
  node.scrollHeight = 1000;
  scroll.syncLayout();
  expect(node.scrollTop).toBe(600);
  scroll.scrollToLatest();
  advance();
  expect(node.scrollTop).toBeGreaterThan(600);
  expect(node.scrollTop).toBeLessThan(700);
  settle();
  expect(node.scrollTop).toBe(700);
  node.scrollHeight = 1100;
  scroll.syncLayout();
  settle();
  expect(node.scrollTop).toBe(800);
});

it('does not mistake pinch zoom or a completed touch for reading old content', () => {
  const { scroll, node, settle } = setup();
  scroll.scrollProps.onTouchStart(touch(100));
  scroll.scrollProps.onTouchMove(touch(140, 200));
  scroll.scrollProps.onTouchMove(touch(160));
  node.scrollHeight = 1000;
  scroll.syncLayout();
  settle();
  expect(node.scrollTop).toBe(700);
  scroll.scrollProps.onTouchStart(touch(100));
  scroll.scrollProps.onTouchEnd();
  scroll.scrollProps.onTouchMove(touch(160));
  node.scrollHeight = 1100;
  scroll.syncLayout();
  settle();
  expect(node.scrollTop).toBe(800);
});

it('keeps the existing desktop wheel behavior after adding touch support', () => {
  const { scroll, node, settle } = setup();
  scroll.scrollProps.onWheel({ deltaY: -10 } as WheelEvent);
  node.scrollHeight = 1000;
  scroll.syncLayout();
  settle();
  expect(node.scrollTop).toBe(600);
});

it('provides an explicit pause for device scroll commands without synthesizing user events', () => {
  const { scroll, node, settle } = setup();
  scroll.pauseFollowing();
  node.scrollHeight = 1000;
  scroll.syncLayout();
  expect(node.scrollTop).toBe(600);
  scroll.scrollToLatest();
  expect(node.scrollTop).toBe(600);
  settle();
  expect(node.scrollTop).toBe(700);
});

it('scrolls from the reading position and catches up smoothly when the stream grows', () => {
  const { scroll, node, scrollFrame, advance, settle } = setup();
  scrollFrame(120);
  scroll.scrollToLatest();
  expect(node.scrollTop).toBe(120);
  expect(node.focus).toHaveBeenCalledWith({ preventScroll: true });

  advance();
  const beforeGrowth = node.scrollTop;
  expect(beforeGrowth).toBeGreaterThan(120);
  expect(beforeGrowth).toBeLessThan(600);
  node.scrollHeight += 180;
  scroll.syncLayout();
  scroll.syncLayout();
  expect(node.scrollTop).toBe(beforeGrowth);
  expect(frames.size).toBe(1);
  // Each new line moves the target of the same animation, without settling at an old bottom.
  for (let i = 0; i < 20; i++) {
    const previous = node.scrollTop;
    node.scrollHeight += 5;
    advance();
    expect(node.scrollTop).toBeGreaterThan(previous);
    expect(node.scrollTop).toBeLessThan(node.scrollHeight - node.clientHeight);
  }

  settle();
  expect(node.scrollTop).toBe(880);
});

it.each(['wheel', 'PageUp'])('allows %s to interrupt a return while new content arrives', input => {
  const { scroll, node, scrollFrame, advance, settle } = setup();
  scrollFrame(120);
  scroll.scrollToLatest();
  advance();
  const pausedAt = node.scrollTop;
  if (input === 'wheel') scroll.scrollProps.onWheel({ deltaY: -10 } as WheelEvent);
  else scroll.scrollProps.onKeyDown({ key: 'PageUp' } as KeyboardEvent);
  expect(frames.size).toBe(0);
  node.scrollHeight += 180;
  scroll.syncLayout();
  settle();
  expect(node.scrollTop).toBe(pausedAt);
});

it('keeps a small upward scroll paused across a hidden view and resumes when the reader returns', () => {
  const { scroll, node, scrollFrame, settle } = setup(true);
  scroll.scrollProps.onWheel({ deltaY: -8 } as WheelEvent);
  scrollFrame(592);
  node.clientHeight = 0;
  node.scrollTop = 0;
  scroll.syncLayout();
  node.scrollHeight += 180;
  node.clientHeight = 300;
  scroll.syncLayout();
  expect(node.scrollTop).toBe(592);
  expect(frames.size).toBe(0);
  scrollFrame(592); // Delayed scroll from restoring the saved conversation.
  scroll.syncLayout();
  expect(frames.size).toBe(0);
  scrollFrame(780);
  node.scrollHeight += 40;
  scroll.syncLayout();
  settle();
  expect(node.scrollTop).toBe(820);
});

it('follows a late Markdown layout and viewport resize without another stream update', () => {
  let notify!: () => void;
  const observe = vi.fn(), unobserve = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notify = callback; }
    observe = observe;
    unobserve = unobserve;
    disconnect = vi.fn();
  });
  const { scroll, node, advance, settle } = setup();
  const first = node.lastElementChild;
  expect(observe).toHaveBeenCalledWith(node);
  expect(observe).toHaveBeenCalledWith(first);
  node.lastElementChild = {} as Element;
  scroll.syncLayout();
  expect(unobserve).toHaveBeenCalledWith(first);
  expect(observe).toHaveBeenCalledWith(node.lastElementChild);
  node.scrollHeight += 120;
  notify();
  advance();
  expect(node.scrollTop).toBeGreaterThan(600);
  expect(node.scrollTop).toBeLessThan(720);
  node.clientHeight -= 60;
  notify();
  settle();
  expect(node.scrollTop).toBe(780);
});

it('honors reduced motion and continues to follow the newest content', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }));
  const { scroll, node, scrollFrame } = setup();
  scrollFrame(120);
  scroll.scrollToLatest();
  expect(node.scrollTop).toBe(600);
  expect(frames.size).toBe(0);
  node.scrollHeight += 40;
  scroll.syncLayout();
  expect(node.scrollTop).toBe(640);
});
