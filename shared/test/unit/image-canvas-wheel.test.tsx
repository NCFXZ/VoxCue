import { expect, it, vi } from 'vitest';
import type { ReactElement, RefObject } from 'react';
import { initialImageTransform, type ImageTransform } from '../../src/services/imageViewport';
import { InterviewImageCanvas } from '../../src/components/InterviewImageCanvas';

const hooks = vi.hoisted(() => ({
  effects: [] as (() => () => void)[],
  views: [] as ImageTransform[],
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => hooks.effects.push(effect),
  useState: (initial: unknown) => [initial, (next: ImageTransform) => {
    if (next && typeof next.scale === 'number') hooks.views.push(next);
  }],
}));

it('zooms at the mouse pointer and preserves continuous pan, momentum, pinch and reset', () => {
  const surface = Object.assign(new EventTarget(), {
    clientWidth: 400, clientHeight: 400,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
  });
  vi.stubGlobal('window', { devicePixelRatio: 1.5, desktop: { platform: 'windows' } });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  type CanvasNode = ReactElement<{ref: RefObject<unknown>; children: CanvasNode; onDoubleClick(): void}>;
  const canvas = InterviewImageCanvas({ src: 'fixture', alt: 'fixture', onError: vi.fn() }) as CanvasNode;
  canvas.props.ref.current = surface;
  canvas.props.children.props.children.props.ref.current = { naturalWidth: 400, naturalHeight: 400 };
  const close = hooks.effects.pop()!();
  const wheel = (time: number, deltaY: number, wheelDeltaY: number, extra = {}) => {
    const event = Object.assign(new Event('wheel', { cancelable: true }), {
      deltaMode: 0, deltaX: 0, deltaY, wheelDeltaY, ctrlKey: false, clientX: 240, clientY: 200, ...extra,
    });
    Object.defineProperty(event, 'timeStamp', { value: time });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    return hooks.views.at(-1)!;
  };
  try {
    const zoomed = wheel(0, -100, 120);
    expect(zoomed.scale).toBeGreaterThan(1);
    expect((40 - zoomed.x) / zoomed.scale).toBeCloseTo(40);
    expect(wheel(15, 100, -120)).toEqual(initialImageTransform);
    const scaled = wheel(250, -72, 80);
    expect(scaled.scale).toBeGreaterThan(1);
    const pan = wheel(280, 8, -8, { deltaX: 3 });
    expect(pan.scale).toBe(scaled.scale);
    expect([pan.x, pan.y]).not.toEqual([scaled.x, scaled.y]);
    expect(wheel(295, 40, -120).scale).toBe(scaled.scale);
    expect(wheel(600, 40, -120, { momentum: true }).scale).toBe(scaled.scale);
    expect(wheel(610, -8, 8, { ctrlKey: true }).scale).toBeGreaterThan(scaled.scale);
    canvas.props.onDoubleClick();
    expect(hooks.views.at(-1)).toEqual(initialImageTransform);
    expect(wheel(1000, -16, 16).scale).toBe(1);
    expect(wheel(1020, -2, 0, { deltaMode: 1 }).scale).toBeGreaterThan(1);
    canvas.props.onDoubleClick();
    expect(wheel(1250, -25, 30).scale).toBeGreaterThan(1);
  } finally {
    close();
    vi.unstubAllGlobals();
    hooks.views.length = 0;
  }
});
