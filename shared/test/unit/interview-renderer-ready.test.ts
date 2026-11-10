import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const cleanups = vi.hoisted(() => [] as Array<() => void>);
vi.mock('react', () => ({
  useLayoutEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  },
}));
import { useInterviewRendererReady } from '../../src/components/useInterviewRendererReady';

let frame: FrameRequestCallback | undefined;
let ready: ReturnType<typeof vi.fn>;
beforeEach(() => {
  frame = undefined;
  ready = vi.fn(async () => {});
  vi.stubGlobal('window', { desktop: { interviewRendererReady: ready } });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});
const surface = (width = 800, height = 600) => ({
  current: {
    getBoundingClientRect: vi.fn(() => ({ width, height })),
  } as unknown as HTMLElement,
});

it('waits for authoritative content and reads committed layout before signaling native visibility', () => {
  const node = surface();
  useInterviewRendererReady(undefined, node, vi.fn());
  expect(frame).toBeUndefined();
  useInterviewRendererReady(1, node, vi.fn());
  expect(ready).not.toHaveBeenCalled();
  expect(node.current.getBoundingClientRect).not.toHaveBeenCalled();
  frame!(0);
  expect(node.current.getBoundingClientRect).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledExactlyOnceWith(1);
  expect(node.current.getBoundingClientRect).toHaveBeenCalledBefore(ready);
});
it('does not signal an empty surface or an unmounted scheduled frame', () => {
  useInterviewRendererReady(1, surface(0), vi.fn());
  frame!(0);
  expect(ready).not.toHaveBeenCalled();
  useInterviewRendererReady(1, surface(), vi.fn());
  cleanups.splice(0).forEach((cleanup) => cleanup());
  frame!(0);
  expect(ready).not.toHaveBeenCalled();
});
it.each([undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'does not acknowledge an absent or invalid navigation revision: %s',
  (revision) => {
    useInterviewRendererReady(revision, surface(), vi.fn());
    expect(frame).toBeUndefined();
    expect(ready).not.toHaveBeenCalled();
  },
);
it('binds each readiness ACK to its committed snapshot and ignores an older navigation failure', async () => {
  let reject!: (error: Error) => void;
  ready.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, no) => {
        reject = no;
      }),
  );
  const error = vi.fn(),
    node = surface();
  useInterviewRendererReady(7, node, error);
  frame!(0);
  cleanups.splice(0).forEach((cleanup) => cleanup());
  useInterviewRendererReady(8, node, error);
  frame!(0);
  expect(ready.mock.calls).toEqual([[7], [8]]);
  reject(Error('Synthetic stale navigation'));
  await Promise.resolve();
  expect(error).not.toHaveBeenCalled();
});
it('reports a current failure but suppresses a late reply after cleanup', async () => {
  let reject!: (reason: Error) => void;
  ready.mockImplementation(
    () =>
      new Promise<void>((_resolve, no) => {
        reject = no;
      }),
  );
  const error = vi.fn();
  useInterviewRendererReady(1, surface(), error);
  frame!(0);
  reject(Error('Synthetic native readiness failure'));
  await Promise.resolve();
  expect(error).toHaveBeenCalledOnce();
  error.mockClear();
  useInterviewRendererReady(2, surface(), error);
  frame!(0);
  cleanups.splice(0).forEach((cleanup) => cleanup());
  reject(Error('Synthetic late readiness failure'));
  await Promise.resolve();
  expect(error).not.toHaveBeenCalled();
});
