import { useCallback, useLayoutEffect, useRef, useState } from 'react';

// A material portal can replace the editor without changing its value. Follow
// the mounted element and its owning window, rather than a stale parent ref.
export function useTextareaSize(value: string, minRows = 2, maxRows = 11) {
  const [element, setElement] = useState<HTMLTextAreaElement | null>(null);
  const ref = useCallback((node: HTMLTextAreaElement | null) => setElement(node), []);
  const measureCurrent = useRef<() => void>(undefined);
  useLayoutEffect(() => {
    if (!element) return;
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    const preference = view.matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined;
    const stop = () => {
      animation?.cancel();
      animation = undefined;
    };
    let measured: { text: string; width: number; line: number; max: number } | undefined;
    const measure = () => {
      if (!element.getClientRects().length) return;
      const style = view.getComputedStyle(element);
      const line = parseFloat(style.lineHeight);
      if (!Number.isFinite(line)) return;
      const text = element.value;
      const width = element.clientWidth;
      const max = Math.min(line * maxRows, parseFloat(style.maxHeight) || Infinity);
      if (measured?.text === text && measured.width === width && measured.line === line && measured.max === max)
        return;
      measured = { text, width, line, max };
      const from = parseFloat(style.height);
      const previousTarget = element.style.height;
      // A temporarily small viewport exposes the natural text height even while
      // a resize is playing. Restore it synchronously before the next paint.
      element.style.setProperty('height', '0px', 'important');
      const height = Math.min(max, Math.max(line * minRows, element.scrollHeight));
      const target = `${height}px`;
      element.style.setProperty('height', target);
      if (target === previousTarget) return;
      stop();
      if (!previousTarget || preference.matches || Math.abs(from - height) < 0.5) return;
      const motion = style.getPropertyValue('--panel-motion-duration').trim();
      const duration = parseFloat(motion) * (motion.endsWith('ms') ? 1 : 1000);
      if (!(duration > 0)) return;
      animation = element.animate([{ height: `${from}px` }, { height: target }], {
        duration,
        easing: style.getPropertyValue('--panel-motion-easing').trim(),
        fill: 'backwards',
      });
    };
    const observer = new ResizeObserver(measure);
    const reduce = () => { if (preference.matches) stop(); };
    measureCurrent.current = measure;
    observer.observe(element);
    preference.addEventListener('change', reduce);
    element.addEventListener('input', measure);
    view.addEventListener('resize', measure);
    measure();
    return () => {
      measureCurrent.current = undefined;
      stop();
      observer.disconnect();
      preference.removeEventListener('change', reduce);
      element.removeEventListener('input', measure);
      view.removeEventListener('resize', measure);
    };
  }, [element, minRows, maxRows]);
  useLayoutEffect(() => measureCurrent.current?.(), [value]);
  return ref;
}
