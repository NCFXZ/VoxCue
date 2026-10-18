import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Keep action widths continuous when a label or download state changes. */
export function ActionTransition({ children }: { children: ReactNode }) {
  const container = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ element: HTMLElement; width: number; animation?: Animation }>(null);
  useLayoutEffect(() => {
    const element = container.current?.firstElementChild as HTMLElement | undefined;
    if (!element) return;
    const old = previous.current;
    const from = old?.element === element ? element.getBoundingClientRect().width : old?.width;
    const ongoing = old?.animation?.playState === 'running';
    const elapsed = old?.animation?.currentTime;
    const started = old?.animation?.startTime;
    const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    old?.animation?.cancel();
    const width = element.getBoundingClientRect().width;
    // Progress events rerender this action frequently. Preserve elapsed time when
    // its natural width is unchanged, so the original transition can finish.
    if (motion && ongoing && old?.element === element && Math.abs(old.width - width) <= 0.5) {
      old.animation!.play();
      if (started !== null && started !== undefined) old.animation!.startTime = started;
      else old.animation!.currentTime = elapsed ?? 0;
      return;
    }
    const animation =
      from !== undefined && Math.abs(from - width) > 0.5 && motion
        ? element.animate(
            [
              { width: `${from}px`, minWidth: '0' },
              { width: `${width}px`, minWidth: '0' },
            ],
            { duration: 220, easing: 'ease-out' },
          )
        : undefined;
    previous.current = { element, width, animation };
  });
  useLayoutEffect(() => () => previous.current?.animation?.cancel(), []);
  return (
    <span ref={container} className="action-transition">
      {children}
    </span>
  );
}
