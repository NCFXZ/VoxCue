import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

// Keep grip events in the page: native app-region dragging consumes the events
// needed to switch a transparent window out of mouse passthrough on macOS.
export function useInterviewWindowDrag(onError: () => void) {
  const active = useRef(false);
  const reportError = useRef(onError);
  reportError.current = onError;
  const start = useRef<(event: ReactPointerEvent<HTMLDivElement>) => void>(() => {});
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    let disposed = false;
    let held = false;
    let frame = 0;
    let moving = false;
    let dirty = false;
    let capture: { element: HTMLDivElement; id: number } | undefined;
    let commands = Promise.resolve();
    const send = (phase: 'start' | 'move' | 'end') => {
      commands = commands
        .then(() => desktop.moveInterviewWindow({ phase }))
        .catch(() => {
          if (!disposed) reportError.current();
        });
      return commands;
    };
    const queueMove = () => {
      dirty = true;
      if (!held || frame || moving) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        dirty = false;
        moving = true;
        void send('move').finally(() => {
          moving = false;
          if (held && dirty) queueMove();
        });
      });
    };
    const finish = () => {
      if (!held) return;
      held = false;
      cancelAnimationFrame(frame);
      frame = 0;
      dirty = false;
      const previous = capture;
      capture = undefined;
      if (previous?.element.hasPointerCapture(previous.id))
        previous.element.releasePointerCapture(previous.id);
      void send('move');
      void send('end').finally(() => {
        if (held) return;
        active.current = false;
        if (!disposed) window.dispatchEvent(new Event('interview-window-drag-end'));
      });
    };
    start.current = (event) => {
      if (event.button !== 0 || held) return;
      event.preventDefault();
      held = true;
      active.current = true;
      capture = { element: event.currentTarget, id: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
      void send('start');
    };
    const move = (event: PointerEvent) => {
      if (!held) return;
      if (!(event.buttons & 1)) finish();
      else queueMove();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('mouseup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', finish);
    return () => {
      disposed = true;
      finish();
      cancelAnimationFrame(frame);
      active.current = false;
      start.current = () => {};
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('mouseup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', finish);
    };
  }, []);
  return {
    active,
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => start.current(event),
  };
}
