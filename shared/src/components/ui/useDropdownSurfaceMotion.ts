import { useCallback, useRef } from 'react';
import { animateDropdownEnter, animateDropdownExit } from './dropdown-motion';

export function useDropdownSurfaceMotion() {
  const surface = useRef<HTMLElement | null>(null);
  const motion = useRef<{ enter?: () => void; exit?: () => void }>({});
  return useCallback((node: HTMLElement | null) => {
    motion.current.exit?.();
    if (!node && surface.current) {
      motion.current.exit = animateDropdownExit(surface.current, () => {
        motion.current.exit = undefined;
      });
    }
    motion.current.enter?.();
    surface.current = node;
    motion.current.enter = node ? animateDropdownEnter(node) : undefined;
  }, []);
}
