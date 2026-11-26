import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { continuedTiming, runningMotion } from './ui/motion-continuation';

/** Keep action widths continuous when a label or download state changes. */
export function ActionTransition({ children }: { children: ReactNode }) {
  const container = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ element: HTMLElement; width: number; from?: number; animation?: Animation }>(null);
  useLayoutEffect(() => {
    const element = container.current?.firstElementChild as HTMLElement | undefined;
    if (!element) return;
    const old = previous.current;
    const from = old?.element === element ? element.getBoundingClientRect().width : old?.width;
    const ongoing = old?.animation?.playState === 'running';
    const elapsed = old?.animation?.currentTime;
    const started = old?.animation?.startTime;
    const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Read the carried speed before cancelling, so a new width keeps moving.
    const running =
      old?.element === element && old.from !== undefined
        ? runningMotion(old.animation, [old.width - old.from])
        : undefined;
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
    let timing: { duration: number; easing: string } | undefined;
    if (from !== undefined && Math.abs(from - width) > 0.5 && motion) {
      const style = getComputedStyle(element);
      const duration = style.getPropertyValue('--button-morph-duration').trim();
      timing = continuedTiming({
        duration: Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000) || 220,
        easing:
          style.getPropertyValue('--button-morph-easing').trim() || 'cubic-bezier(0.2, 0, 0, 1)',
      }, running, [width - from]);
    }
    const animation =
      timing && from !== undefined
        ? element.animate(
            [
              { width: `${from}px`, minWidth: '0' },
              { width: `${width}px`, minWidth: '0' },
            ],
            timing,
          )
        : undefined;
    previous.current = { element, width, from, animation };
  });
  useLayoutEffect(() => () => previous.current?.animation?.cancel(), []);
  return (
    <span ref={container} className="action-transition">
      {children}
    </span>
  );
}
