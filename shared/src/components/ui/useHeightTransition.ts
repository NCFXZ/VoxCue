import { useEffect, useLayoutEffect, useRef } from 'react';

type Track = { height: number; animation?: Animation; release?(): void };

// Each surface keeps its outer frame; only the sections whose natural height
// changes expand or contract, using the same timing as the existing tabs.
export function useHeightTransition(
  key: string,
  targets: () => Array<HTMLElement | null | undefined>,
) {
  const tracks = useRef(new Map<HTMLElement, Track>());
  const anchors = useRef(new Map<HTMLElement, { count: number; value: string }>());
  const cancel = (track: Track) => {
    track.animation?.cancel();
    track.release?.();
  };
  const stop = () => {
    for (const [node, track] of tracks.current) {
      cancel(track);
      track.animation = undefined;
      track.height = node.getBoundingClientRect().height;
    }
  };
  useLayoutEffect(() => {
    const nodes = new Set(targets().filter((node): node is HTMLElement => !!node));
    for (const [node, track] of tracks.current)
      if (!nodes.has(node)) {
        cancel(track);
        tracks.current.delete(node);
      }
    for (const node of nodes) {
      const old = tracks.current.get(node);
      const from = old?.animation ? node.getBoundingClientRect().height : old?.height;
      if (old) cancel(old);
      const height = node.getBoundingClientRect().height;
      const track: Track = { height };
      tracks.current.set(node, track);
      if (
        from === undefined ||
        Math.abs(from - height) < 0.5 ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        continue;
      const scroll = node.closest<HTMLElement>('.dialog-scroll, .settings-content-body');
      if (scroll) {
        const anchor = anchors.current.get(scroll) ?? {
          count: 0,
          value: scroll.style.overflowAnchor,
        };
        ++anchor.count;
        anchors.current.set(scroll, anchor);
        scroll.style.overflowAnchor = 'none';
        let released = false;
        track.release = () => {
          if (released) return;
          released = true;
          if (--anchor.count === 0) {
            scroll.style.overflowAnchor = anchor.value;
            anchors.current.delete(scroll);
          }
        };
      }
      const style = getComputedStyle(node);
      const duration = style.getPropertyValue('--panel-motion-duration').trim();
      const animation = node.animate(
        [
          { height: `${from}px`, minHeight: 0, overflow: 'clip' },
          { height: `${height}px`, minHeight: 0, overflow: 'clip' },
        ],
        {
          duration: Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000) || 240,
          easing:
            style.getPropertyValue('--panel-motion-easing').trim() || 'cubic-bezier(0.2, 0, 0, 1)',
          fill: 'both',
        },
      );
      track.animation = animation;
      const finish = () => {
        track.release?.();
        if (tracks.current.get(node) !== track) return;
        animation.cancel();
        track.animation = undefined;
      };
      void animation.finished.then(finish, finish);
    }
  }, [key]);
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      if (motion.matches) stop();
    };
    motion.addEventListener('change', changed);
    window.addEventListener('resize', stop);
    return () => {
      motion.removeEventListener('change', changed);
      window.removeEventListener('resize', stop);
      stop();
      tracks.current.clear();
    };
  }, []);
}
