import { useLayoutEffect, type RefObject } from 'react';
import { continuedTiming, runningMotion } from './motion-continuation';

type Position = { top: number; height: number; resizing: boolean; animation?: Animation; start?: number };

// Reveal animations already move the flow. Animate only the remaining layout
// jumps, continuing from the visible position when another change interrupts.
export function useNoticeStackMotion(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const positions = new Map<HTMLElement, Position>();
    const resize = new ResizeObserver(update);
    const mutation = new MutationObserver(update);

    function update() {
      const nodes = Array.from(host!.querySelectorAll<HTMLElement>(
        ':scope > .interview-reveal, :scope > .chat-notice-slot > .chat-notice-positioner',
      ));
      const origin = host!.getBoundingClientRect().top;
      let flow = 0;
      // Finish all geometry reads before writing animation effects.
      const measured = nodes.map(node => {
        const previous = positions.get(node);
        const style = getComputedStyle(node);
        const offset = previous?.animation
          ? new DOMMatrixReadOnly(style.transform).m42 : 0;
        const box = node.getBoundingClientRect();
        const height = box.height + (parseFloat(style.marginBottom) || 0);
        const top = box.top - origin - offset;
        const resizing = node.getAnimations({ subtree: true }).some(animation =>
          animation.playState === 'running' && animation.effect instanceof KeyframeEffect &&
          animation.effect.getKeyframes().some(frame =>
            'height' in frame || 'blockSize' in frame || 'gridTemplateRows' in frame || 'marginBottom' in frame),
        );
        const jump = previous ? previous.top + flow - top : 0;
        if (previous && (previous.resizing || resizing)) flow += height - previous.height;
        // Read the carried speed before a retarget cancels it.
        const running = previous?.start === undefined ? undefined : runningMotion(previous.animation, [-previous.start]);
        return { node, previous, top, height, resizing, jump, offset, running };
      });
      for (const [node, position] of positions) {
        if (nodes.includes(node)) continue;
        position.animation?.cancel();
        resize.unobserve(node);
        positions.delete(node);
      }
      const style = getComputedStyle(host!);
      const value = style.getPropertyValue('--panel-motion-duration').trim();
      const duration = parseFloat(value) * (value.endsWith('ms') ? 1 : 1000) || 240;
      const easing = style.getPropertyValue('--panel-motion-easing').trim() || 'cubic-bezier(0.2, 0, 0, 1)';
      for (const { node, previous, top, height, resizing, jump, offset, running } of measured) {
        const position = previous ?? { top, height, resizing };
        Object.assign(position, { top, height, resizing });
        positions.set(node, position);
        if (!previous) resize.observe(node);
        if (preference.matches) {
          position.animation?.cancel();
          position.animation = undefined;
        } else if (Math.abs(jump) >= 0.5) {
          position.animation?.cancel();
          const start = jump + offset;
          const animation = node.animate([
            { transform: `translateY(${start}px)` },
            { transform: 'translateY(0px)' },
          ], { ...continuedTiming({ duration, easing }, running, [-start]), fill: 'both' });
          position.animation = animation;
          position.start = start;
          const finish = () => {
            if (position.animation !== animation) return;
            animation.cancel();
            position.animation = undefined;
          };
          void animation.finished.then(finish, finish);
        }
      }
    }

    resize.observe(host);
    mutation.observe(host, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['style', 'class', 'data-open'],
    });
    preference.addEventListener('change', update);
    update();
    return () => {
      mutation.disconnect();
      resize.disconnect();
      preference.removeEventListener('change', update);
      for (const position of positions.values()) position.animation?.cancel();
    };
  }, [ref]);
}
