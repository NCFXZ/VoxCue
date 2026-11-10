import { beforeEach, expect, it, vi } from 'vitest';
import type { TouchEvent, WheelEvent } from 'react';
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
  private top = 0;
  get scrollTop() { return this.top; }
  set scrollTop(value: number) { this.top = Math.min(value, this.scrollHeight - this.clientHeight); }
  focus = vi.fn();
}
const touch = (...positions: number[]) => ({ touches: positions.map((clientY) => ({ clientY })) }) as TouchEvent;
const setup = () => {
  const scroll = useFollowScroll(['first'], 'session');
  const node = new ScrollNode();
  scroll.scrollProps.ref.current = node as unknown as HTMLDivElement;
  effects.splice(0).forEach((effect) => effect());
  return { scroll, node };
};
beforeEach(() => effects.splice(0));

it('pauses following before a touch scroll and resumes only after returning to latest', () => {
  const { scroll, node } = setup();
  expect(node.scrollTop).toBe(600);
  scroll.scrollProps.onTouchStart(touch(100));
  scroll.scrollProps.onTouchMove(touch(150));
  node.scrollHeight = 1000;
  scroll.syncLayout();
  expect(node.scrollTop).toBe(600);
  scroll.scrollToLatest();
  expect(node.scrollTop).toBe(700);
});

it('does not mistake pinch zoom or a completed touch for reading old content', () => {
  const { scroll, node } = setup();
  scroll.scrollProps.onTouchStart(touch(100));
  scroll.scrollProps.onTouchMove(touch(140, 200));
  scroll.scrollProps.onTouchMove(touch(160));
  node.scrollHeight = 1000;
  scroll.syncLayout();
  expect(node.scrollTop).toBe(700);
  scroll.scrollProps.onTouchStart(touch(100));
  scroll.scrollProps.onTouchEnd();
  scroll.scrollProps.onTouchMove(touch(160));
  node.scrollHeight = 1100;
  scroll.syncLayout();
  expect(node.scrollTop).toBe(800);
});

it('keeps the existing desktop wheel behavior after adding touch support', () => {
  const { scroll, node } = setup();
  scroll.scrollProps.onWheel({ deltaY: -10 } as WheelEvent);
  node.scrollHeight = 1000;
  scroll.syncLayout();
  expect(node.scrollTop).toBe(600);
});

it('provides an explicit pause for device scroll commands without synthesizing user events', () => {
  const { scroll, node } = setup();
  scroll.pauseFollowing();
  node.scrollHeight = 1000;
  scroll.syncLayout();
  expect(node.scrollTop).toBe(600);
  scroll.scrollToLatest();
  expect(node.scrollTop).toBe(700);
});
