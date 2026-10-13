import { useLayoutEffect, useRef } from 'react';
// A stream follows only while the reader remains near the bottom. Wheel/key
// intent is captured before a subsequent delta can move the scroll position.
export function useFollowScroll(value: unknown, identity?: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    follow.current = true;
  }, [identity]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [value, identity]);
  return {
    ref,
    onScroll: () => {
      const node = ref.current;
      if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    },
    onWheel: (event: React.WheelEvent) => {
      if (event.deltaY < 0) follow.current = false;
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) follow.current = false;
    },
  };
}
