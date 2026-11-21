import { useCallback, useLayoutEffect, useState } from 'react';

// A material portal can replace the editor without changing its value. Follow
// the mounted element and its owning window, rather than a stale parent ref.
export function useTextareaSize(value: string, minRows = 2, maxRows = 11) {
  const [element, setElement] = useState<HTMLTextAreaElement | null>(null);
  const ref = useCallback((node: HTMLTextAreaElement | null) => setElement(node), []);
  useLayoutEffect(() => {
    if (!element) return;
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    const measure = () => {
      if (!element.getClientRects().length) return;
      const line = parseFloat(view.getComputedStyle(element).lineHeight);
      if (!Number.isFinite(line)) return;
      element.style.height = 'auto';
      element.style.overflowY = 'hidden';
      const height = Math.max(line * minRows, Math.min(element.scrollHeight, line * maxRows));
      element.style.height = `${height}px`;
      element.style.overflowY = element.scrollHeight > height + 1 ? 'auto' : 'hidden';
    };
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      measure();
    });
    observer.observe(element);
    // Measure the actual input before the next paint, including rapid newline
    // insertion and deletion. The layout effect also covers restored drafts.
    element.addEventListener('input', measure);
    view.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('input', measure);
      view.removeEventListener('resize', measure);
    };
  }, [element, value, minRows, maxRows]);
  return ref;
}
