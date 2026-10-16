import { useLayoutEffect, useRef, useState } from 'react';
// A stream follows only while the reader remains near the bottom. Wheel/key
// intent is captured before a subsequent delta can move the scroll position.
export function useFollowScroll(value: unknown, identity?: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  useLayoutEffect(() => {
    follow.current = true;
    setFollowing(true);
    setHasNew(false);
  }, [identity]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
    else if (node) setHasNew(true);
  }, [value, identity]);
  return {
    following,
    hasNew,
    scrollToLatest: () => {
      follow.current = true;
      setFollowing(true);
      setHasNew(false);
      const node = ref.current;
      if (node) {
        node.scrollTop = node.scrollHeight;
        node.focus({ preventScroll: true });
      }
    },
    scrollProps: {
      ref,
      onScroll: () => {
        const node = ref.current;
        if (node) {
          follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
          setFollowing(follow.current);
          if (follow.current) setHasNew(false);
        }
      },
      onWheel: (event: React.WheelEvent) => {
        if (event.deltaY < 0) {
          follow.current = false;
          setFollowing(false);
        }
      },
      onKeyDown: (event: React.KeyboardEvent) => {
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
          follow.current = false;
          setFollowing(false);
        }
      },
    },
  };
}
