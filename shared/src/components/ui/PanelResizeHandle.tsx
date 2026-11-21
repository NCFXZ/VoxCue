import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

type PanelResizeProps = {
  layoutRef: RefObject<HTMLDivElement | null>;
  label: string;
  controls: string;
  draggingClassName: string;
  onResize(width: number): void;
  onReset(): void;
};

export function PanelResizeHandle({
  layoutRef, label, controls, draggingClassName, onResize, onReset,
}: PanelResizeProps) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number; grip: HTMLDivElement } | null>(null);
  const keyWidth = useRef<number | null>(null);
  const [range, setRange] = useState({ now: 380, min: 300, max: 640 });
  const stop = useCallback(() => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    layoutRef.current?.classList.remove(draggingClassName);
    if (active.grip.hasPointerCapture(active.id)) active.grip.releasePointerCapture(active.id);
  }, [layoutRef, draggingClassName]);
  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) stop();
  };

  useLayoutEffect(() => {
    const grip = handle.current!;
    const panel = grip.parentElement!;
    const layout = layoutRef.current!;
    let lastLayoutWidth = -1;
    const measure = () => {
      const layoutWidth = layout.clientWidth;
      if (layoutWidth !== lastLayoutWidth) keyWidth.current = null;
      lastLayoutWidth = layoutWidth;
      const reserve = parseFloat(getComputedStyle(layout).getPropertyValue('--panel-resize-reserve')) || 280;
      const now = Math.round(panel.getBoundingClientRect().width);
      const max = Math.max(300, Math.min(640, layoutWidth - reserve));
      const min = Math.min(300, now);
      const reachableMax = max === 300 && now < 300 ? now : Math.max(now, max);
      setRange(previous => previous.now === now && previous.min === min && previous.max === reachableMax
        ? previous : { now, min, max: reachableMax });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(layout);
    measure();
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('blur', stop);
      observer.disconnect();
      stop();
    };
  }, [layoutRef, stop]);

  const resize = (width: number) => {
    const next = Math.round(Math.max(300, Math.min(range.max, width)));
    onResize(next);
    return next;
  };
  const reset = () => {
    keyWidth.current = null;
    onReset();
  };
  return (
    <div
      ref={handle}
      className="panel-resize-handle"
      role="separator"
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuenow={range.now}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      onDoubleClick={reset}
      onKeyDown={event => {
        if (event.key === 'Home') {
          event.preventDefault();
          reset();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const current = keyWidth.current ?? event.currentTarget.parentElement!.getBoundingClientRect().width;
          keyWidth.current = resize(current + (event.key === 'ArrowLeft' ? 20 : -20));
        }
      }}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || drag.current) return;
        event.preventDefault();
        const grip = event.currentTarget;
        keyWidth.current = null;
        drag.current = {
          id: event.pointerId, x: event.clientX, width: grip.parentElement!.getBoundingClientRect().width, grip,
        };
        grip.setPointerCapture(event.pointerId);
        layoutRef.current!.classList.add(draggingClassName);
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (start?.id === event.pointerId) resize(start.width + start.x - event.clientX);
      }}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
    />
  );
}
