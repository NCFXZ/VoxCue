import { useEffect, useState, type RefObject } from 'react';

const questionStart = 100;
const thinkingStart = 1000;
const answerStart = 1400;
const finish = 3500;

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
    let visible = false;
    const tick = (now: number) => {
      frame = 0;
      if (previous) time = Math.min(finish, time + now - previous);
      previous = now;
      if (time === finish) {
        setElapsed(time);
        node.dataset.playing = 'false';
        return;
      }
      // Follow the display's frame rate while text grows. The still phases
      // retain a single value, including while the thinking label animates in CSS.
      setElapsed(time < questionStart ? 0 : time >= thinkingStart && time < answerStart ? thinkingStart : time);
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (motion.matches) time = finish;
      const playing = time < finish && visible && !document.hidden;
      node.dataset.playing = String(playing);
      if (time === finish) setElapsed(time);
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
    questionProgress: Math.max(0, Math.min(1, (elapsed - questionStart) / (thinkingStart - questionStart))),
    answerProgress: Math.max(0, Math.min(1, (elapsed - answerStart) / (finish - answerStart))),
    phase:
      elapsed < questionStart
        ? 'ready'
        : elapsed < thinkingStart
          ? 'question'
          : elapsed < answerStart
            ? 'thinking'
            : elapsed < finish
              ? 'answering'
              : 'complete',
  };
}
