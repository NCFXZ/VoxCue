import { useEffect, useState, type RefObject } from 'react';

// Play the website hero's transcript → thinking → answer once per login opening.
export function useLoginPreviewPlayback(enabled: boolean, scene: RefObject<HTMLDivElement | null>) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const node = scene.current;
    if (!enabled || !node) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let previous = 0;
    let time = 0;
    let painted = -Infinity;
    let visible = false;
    const tick = (now: number) => {
      frame = 0;
      if (previous) time = Math.min(3500, time + now - previous);
      previous = now;
      if (time === 3500) {
        setElapsed(time);
        node.dataset.playing = 'false';
        return;
      }
      if (now - painted >= 32) {
        setElapsed(time);
        painted = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (motion.matches) time = 3500;
      const playing = time < 3500 && visible && !document.hidden;
      node.dataset.playing = String(playing);
      if (time === 3500) setElapsed(time);
      else if (playing) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      schedule();
    });
    observer.observe(node);
    motion.addEventListener('change', schedule);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener('change', schedule);
      document.removeEventListener('visibilitychange', schedule);
      delete node.dataset.playing;
    };
  }, [enabled, scene]);
  return {
    elapsed,
    phase:
      elapsed < 100
        ? 'ready'
        : elapsed < 1000
          ? 'question'
          : elapsed < 1400
            ? 'thinking'
            : elapsed < 3500
              ? 'answering'
              : 'complete',
  };
}
