import { useLayoutEffect, useRef, useState } from 'react';

type ScrollPosition = {
  identity: unknown;
  value: unknown;
  top: number;
  following: boolean;
  hasNew: boolean;
};

// A stream follows only while the reader remains near the bottom. Wheel/key
// intent is captured before a subsequent delta can move the scroll position.
export function useFollowScroll(
  value: unknown,
  identity?: unknown,
  options: { rememberPosition?: boolean; identities?: readonly unknown[] } = {},
) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<unknown, ScrollPosition>());
  const current = useRef<ScrollPosition>({
    identity,
    value,
    top: 0,
    following: true,
    hasNew: false,
  });
  const remember = useRef(options.rememberPosition === true);
  const restoreNeeded = useRef(true);
  const previousNode = useRef<HTMLDivElement | null>(null);
  const scripted = useRef<{ node: HTMLDivElement; position: ScrollPosition; top: number } | null>(
    null,
  );
  const [following, setFollowing] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const touchY = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const observed = useRef<{ node: HTMLDivElement; tail: Element | null; resize: ResizeObserver } | null>(null);
  const cancelMotion = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useLayoutEffect(() => () => {
    cancelMotion();
    observed.current?.resize.disconnect();
    observed.current = null;
  }, [identity]);

  const writeTop = (node: HTMLDivElement, position: ScrollPosition, value: number) => {
    node.scrollTop = value;
    const top = node.scrollTop;
    if (position.following) position.top = top;
    scripted.current = { node, position, top };
  };

  const followBottom = (node: HTMLDivElement, position: ScrollPosition) => {
    if (frame.current !== null) return;
    const bottom = node.scrollHeight - node.clientHeight;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches || Math.abs(bottom - node.scrollTop) <= 1) {
      // Scroll dimensions are rounded. Let the browser clamp to the true bottom
      // so a resize callback keeps the same position as conversation restoration.
      writeTop(node, position, node.scrollHeight);
      return;
    }
    let top = node.scrollTop;
    let velocity = 0;
    let last = performance.now();
    const paint = (now: number) => {
      frame.current = null;
      if (ref.current !== node || current.current !== position || !position.following || !node.clientHeight) return;
      const target = node.scrollHeight - node.clientHeight;
      if (reduced.matches || Math.abs(node.scrollTop - target) <= 1) {
        writeTop(node, position, node.scrollHeight);
        return;
      }
      // Keep the same motion as each new line changes the destination.
      const elapsed = Math.min(48, Math.max(0, now - last));
      last = now;
      const delta = top - target;
      const responseMs = 52;
      const drift = (velocity + delta / responseMs) * elapsed;
      const decay = Math.exp(-elapsed / responseMs);
      const next = target + (delta + drift) * decay;
      if (Math.abs(next - target) <= 0.5 || (next - target) * delta <= 0) {
        writeTop(node, position, node.scrollHeight);
        return;
      }
      velocity = (velocity - drift / responseMs) * decay;
      top = next;
      writeTop(node, position, top);
      frame.current = requestAnimationFrame(paint);
    };
    frame.current = requestAnimationFrame(paint);
  };

  // Resize observers can retain this callback across conversations. Read only
  // live refs, and leave hidden routes' zero-height/clamped DOM out of memory.
  const syncLayout = () => {
    const node = ref.current;
    if (observed.current?.node !== node) {
      observed.current?.resize.disconnect();
      observed.current = null;
      if (node && typeof ResizeObserver !== 'undefined') {
        const resize = new ResizeObserver(() => {
          if (observed.current?.resize === resize) syncLayout();
        });
        resize.observe(node);
        observed.current = { node, tail: null, resize };
      }
    }
    const observation = observed.current;
    if (node && observation && observation.tail !== node.lastElementChild) {
      // Markdown can finish rendering a new line after the store update. Watch the
      // chat thread or newest answer/paragraph as well as the viewport's content box.
      if (observation.tail) observation.resize.unobserve(observation.tail);
      observation.tail = node.lastElementChild;
      if (observation.tail) observation.resize.observe(observation.tail);
    }
    if (!node?.clientHeight) {
      cancelMotion();
      restoreNeeded.current = true;
      previousNode.current = null;
      scripted.current = null;
      return;
    }
    if (previousNode.current !== node) restoreNeeded.current = true;
    previousNode.current = node;
    const position = current.current;
    if (restoreNeeded.current) {
      cancelMotion();
      if (position.following || remember.current)
        writeTop(node, position, position.following ? node.scrollHeight : position.top);
    } else if (position.following) followBottom(node, position);
    restoreNeeded.current = false;
  };

  useLayoutEffect(() => {
    remember.current = options.rememberPosition === true;
    if (remember.current && options.identities) {
      const retained = new Set(options.identities);
      for (const key of positions.current.keys()) {
        if (!retained.has(key)) positions.current.delete(key);
      }
    }
    let position = current.current;
    if (!Object.is(position.identity, identity)) {
      restoreNeeded.current = true;
      scripted.current = null;
      position = (remember.current && positions.current.get(identity)) || {
        identity,
        value,
        top: 0,
        following: true,
        hasNew: false,
      };
      current.current = position;
    }
    if (remember.current && identity != null) positions.current.set(identity, position);
    if (!Object.is(position.value, value) && !position.following) position.hasNew = true;
    position.value = value;
    if (!remember.current && ref.current && !(ref.current.clientHeight && position.following))
      position.hasNew = true;
    setFollowing(position.following);
    setHasNew(position.hasNew);
    syncLayout();
  }, [value, identity, options.rememberPosition, options.identities]);

  const pauseFollowing = () => {
    cancelMotion();
    current.current.following = false;
    const node = ref.current;
    if (node?.clientHeight) {
      current.current.top = node.scrollTop;
      scripted.current = { node, position: current.current, top: node.scrollTop };
    }
    setFollowing(false);
  };

  return {
    syncLayout,
    restorePosition: () => {
      restoreNeeded.current = true;
      syncLayout();
    },
    following,
    hasNew,
    pauseFollowing,
    scrollToLatest: () => {
      current.current.following = true;
      current.current.hasNew = false;
      setFollowing(true);
      setHasNew(false);
      const node = ref.current;
      if (node?.clientHeight) {
        // A reader's native smooth scroll (e.g. a remote device command) may still be moving.
        if (frame.current === null) writeTop(node, current.current, node.scrollTop);
        syncLayout();
        node.focus({ preventScroll: true });
      }
    },
    scrollProps: {
      ref,
      'data-following-latest': following,
      onScroll: (event: React.UIEvent<HTMLDivElement>) => {
        const node = ref.current;
        if (!node?.clientHeight || event.currentTarget !== node) return;
        const position = current.current;
        const pending = scripted.current;
        if (
          pending?.node === node &&
          pending.position === position &&
          pending.top === node.scrollTop
        )
          return;
        cancelMotion();
        scripted.current = null;
        // Save on real scrolling, never in cleanup after the next chat's DOM
        // has already replaced the old content and clamped its scrollTop.
        const top = node.scrollTop;
        const gap = node.scrollHeight - top - node.clientHeight;
        position.following = gap <= 1 || (gap < 48 && top >= position.top);
        position.top = top;
        setFollowing(position.following);
        if (position.following) {
          position.hasNew = false;
          setHasNew(false);
        }
      },
      onWheel: (event: React.WheelEvent) => {
        if (event.ctrlKey) return;
        if (event.deltaY < 0 || (frame.current !== null && event.deltaY > 0)) pauseFollowing();
      },
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        // A touch becomes reading intent only after a one-finger vertical move.
        if (event.pointerType === 'touch') return;
        const node = event.currentTarget;
        const x = event.clientX - node.getBoundingClientRect().left;
        if (event.button === 1 || x < node.clientLeft || x >= node.clientLeft + node.clientWidth)
          pauseFollowing();
      },
      onTouchStart: (event: React.TouchEvent) => {
        touchY.current = event.touches.length === 1 ? event.touches[0].clientY : null;
      },
      onTouchMove: (event: React.TouchEvent) => {
        if (event.touches.length !== 1) { touchY.current = null; return; }
        if (touchY.current === null) return;
        const y = event.touches[0].clientY;
        if (y - touchY.current > 4) {
          pauseFollowing();
          touchY.current = y;
        } else if (y < touchY.current) touchY.current = y;
      },
      onTouchEnd: () => { touchY.current = null; },
      onTouchCancel: () => { touchY.current = null; },
      onKeyDown: (event: React.KeyboardEvent) => {
        if (
          event.target === event.currentTarget && !event.defaultPrevented &&
          !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey &&
          (event.key === 'Home' || event.key === 'End')
        ) {
          const node = ref.current;
          if (!node?.clientHeight) return;
          // macOS can route Home/End to the document even when this nested pane has focus.
          event.preventDefault();
          cancelMotion();
          const position = current.current;
          position.following = event.key === 'End' || node.scrollHeight <= node.clientHeight;
          writeTop(node, position, position.following ? node.scrollHeight : 0);
          position.top = node.scrollTop;
          setFollowing(position.following);
          if (position.following) {
            position.hasNew = false;
            setHasNew(false);
          }
          return;
        }
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey) ||
          (frame.current !== null && ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)))
          pauseFollowing();
      },
    },
  };
}
