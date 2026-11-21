/** Center a caption, keeping the start of a tall caption below the fixed toolbar. */
export function transcriptScrollTop(pane: HTMLElement, row: HTMLElement, header: HTMLElement | null) {
  const viewport = pane.getBoundingClientRect();
  const caption = row.getBoundingClientRect();
  const visibleTop = Math.max(viewport.top, header?.getBoundingClientRect().bottom ?? viewport.top);
  const alignedTop = Math.max(visibleTop, (viewport.top + viewport.bottom - caption.height) / 2);
  return Math.max(0, Math.min(pane.scrollHeight - pane.clientHeight, pane.scrollTop + caption.top - alignedTop));
}

type Motion = {
  pane: HTMLElement;
  row: HTMLElement;
  header: HTMLElement | null;
  reduced: MediaQueryList;
  mode: 'seek' | 'track';
  position: number;
  velocity: number;
  lastFrame: number;
};

export function createTranscriptScrubScroll() {
  let motion: Motion | null = null;
  let frame = 0;
  const cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    motion = null;
  };

  const paint = (now: number) => {
    if (!motion) return;
    const { pane, row, header } = motion;
    if (!row.isConnected || !pane.contains(row)) return cancel();
    const target = transcriptScrollTop(pane, row, header);
    if (motion.reduced.matches) {
      pane.scrollTo({ top: target, behavior: 'instant' });
      return cancel();
    }
    // A critically damped spring retains position and velocity when the slider reverses.
    // Long seeks accelerate more gradually. A delayed frame must not skip the whole journey.
    const elapsed = Math.min(40, Math.max(0, now - motion.lastFrame));
    motion.lastFrame = now;
    const offset = motion.position - target;
    const screens = Math.abs(offset) / Math.max(1, pane.clientHeight);
    const responseMs = (motion.mode === 'track' ? 22 : 42) * (1 + 0.35 * Math.log1p(screens));
    let rate = 1 / responseMs;
    if (motion.velocity * offset > 0) {
      // Shed momentum that points away from the new target without moving the viewport abruptly.
      motion.velocity *= Math.exp(-elapsed / 18);
    } else {
      // Brake early enough to land on a nearer target without overshooting it.
      rate = Math.max(rate, Math.abs(motion.velocity) / Math.max(0.5, Math.abs(offset)));
    }
    const decay = Math.exp(-rate * elapsed);
    const drift = (motion.velocity + rate * offset) * elapsed;
    motion.position = target + (offset + drift) * decay;
    motion.velocity = (motion.velocity - rate * drift) * decay;
    const settled = Math.abs(motion.position - target) <= 0.5 && Math.abs(motion.velocity) < 0.02;
    pane.scrollTo({ top: settled ? target : motion.position, behavior: 'instant' });
    if (settled) cancel();
    else frame = requestAnimationFrame(paint);
  };

  return {
    cancel,
    get active() { return frame !== 0; },
    interrupt(pane: HTMLElement) {
      cancelAnimationFrame(frame);
      frame = 0;
      // Keep the last painted position, velocity and frame time for the incoming input event.
      if (motion?.pane === pane) return;
      motion = null;
      pane.scrollTo({ top: pane.scrollTop, behavior: 'instant' });
    },
    move(pane: HTMLElement, row: HTMLElement, header: HTMLElement | null, mode: Motion['mode']) {
      // Successive drag events update one destination. Holding still lets the same
      // animation finish, and releasing on an already settled caption leaves it still.
      if (motion?.pane === pane) {
        motion.row = row;
        motion.mode = mode;
      } else {
        cancel();
        const start = pane.scrollTop;
        const target = transcriptScrollTop(pane, row, header);
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        if (reduced.matches || Math.abs(start - target) <= 0.5) {
          pane.scrollTo({ top: target, behavior: 'instant' });
          return;
        }
        pane.scrollTo({ top: start, behavior: 'instant' });
        motion = { pane, row, header, reduced, mode, position: start, velocity: 0, lastFrame: performance.now() };
      }
      if (!frame) frame = requestAnimationFrame(paint);
    },
  };
}
