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
  const restored = useRef<{ node: HTMLDivElement; position: ScrollPosition; top: number } | null>(
    null,
  );
  const [following, setFollowing] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const touchY = useRef<number | null>(null);

  // Resize observers can retain this callback across conversations. Read only
  // live refs, and leave hidden routes' zero-height/clamped DOM out of memory.
  const syncLayout = () => {
    const node = ref.current;
    if (!node?.clientHeight) {
      restoreNeeded.current = true;
      previousNode.current = null;
      restored.current = null;
      return;
    }
    if (previousNode.current !== node) restoreNeeded.current = true;
    previousNode.current = node;
    const position = current.current;
    if (position.following || (remember.current && restoreNeeded.current)) {
      node.scrollTop = position.following ? node.scrollHeight : position.top;
      if (remember.current) {
        if (position.following) position.top = node.scrollTop;
        restored.current = { node, position, top: node.scrollTop };
      }
    }
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
      restored.current = null;
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

  return {
    syncLayout,
    following,
    hasNew,
    pauseFollowing: () => {
      restored.current = null;
      current.current.following = false;
      const node = ref.current;
      if (node?.clientHeight) current.current.top = node.scrollTop;
      setFollowing(false);
    },
    scrollToLatest: () => {
      current.current.following = true;
      current.current.hasNew = false;
      setFollowing(true);
      setHasNew(false);
      const node = ref.current;
      if (node?.clientHeight) {
        syncLayout();
        node.focus({ preventScroll: true });
      }
    },
    scrollProps: {
      ref,
      onScroll: (event: React.UIEvent<HTMLDivElement>) => {
        const node = ref.current;
        if (!node?.clientHeight || event.currentTarget !== node) return;
        const position = current.current;
        const pending = restored.current;
        restored.current = null;
        if (
          pending?.node === node &&
          pending.position === position &&
          pending.top === node.scrollTop
        )
          return;
        // Save on real scrolling, never in cleanup after the next chat's DOM
        // has already replaced the old content and clamped its scrollTop.
        position.top = node.scrollTop;
        position.following = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        setFollowing(position.following);
        if (position.following) {
          position.hasNew = false;
          setHasNew(false);
        }
      },
      onWheel: (event: React.WheelEvent) => {
        restored.current = null;
        if (event.deltaY < 0) {
          current.current.following = false;
          setFollowing(false);
        }
      },
      onTouchStart: (event: React.TouchEvent) => {
        touchY.current = event.touches.length === 1 ? event.touches[0].clientY : null;
      },
      onTouchMove: (event: React.TouchEvent) => {
        if (event.touches.length !== 1) { touchY.current = null; return; }
        if (touchY.current === null) return;
        const y = event.touches[0].clientY;
        if (y - touchY.current > 4) {
          restored.current = null;
          current.current.following = false;
          setFollowing(false);
        }
        touchY.current = y;
      },
      onTouchEnd: () => { touchY.current = null; },
      onTouchCancel: () => { touchY.current = null; },
      onKeyDown: (event: React.KeyboardEvent) => {
        restored.current = null;
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
          current.current.following = false;
          setFollowing(false);
        }
      },
    },
  };
}
