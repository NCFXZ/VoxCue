import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import './sidebarSelectionIndicator.css';

export function SidebarSelectionIndicator({
  container,
}: {
  container: RefObject<HTMLElement | null>;
}) {
  const indicator = useRef<HTMLSpanElement>(null);
  const measure = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    const sidebar = container.current;
    const marker = indicator.current;
    const overlay = marker?.parentElement;
    if (!sidebar || !marker || !overlay) return;
    let frame = 0;
    let active: HTMLElement | null = null;
    let destination: { x: number; y: number } | undefined;
    let lastClip: { top: number; right: number; bottom: number; left: number } | undefined;
    const watched = new Set<HTMLElement>();
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Align the marker with the resized row before that frame is painted.
    const resize = new ResizeObserver(update);
    function update() {
      cancelAnimationFrame(frame);
      frame = 0;
      const target = sidebar!.querySelector<HTMLElement>(
        '.nav-item.active, .conversation-row.active',
      );
      const observed = new Set<HTMLElement>([
        sidebar!,
        ...sidebar!.querySelectorAll<HTMLElement>(
          ':scope > .sidebar-heading, :scope > nav, :scope > .sidebar-conversations',
        ),
        ...(target ? [target] : []),
      ]);
      for (const node of watched)
        if (!observed.has(node)) {
          resize.unobserve(node);
          watched.delete(node);
        }
      for (const node of observed)
        if (!watched.has(node)) {
          watched.add(node);
          resize.observe(node);
        }

      const bounds = sidebar!.getBoundingClientRect();
      const scroller = target?.closest<HTMLElement>('.sidebar-conversations');
      const scrollBounds = scroller?.getBoundingClientRect();
      const clip =
        scroller && scrollBounds
          ? {
              top: Math.max(bounds.top, scrollBounds.top + scroller.clientTop),
              right: Math.min(
                bounds.right,
                scrollBounds.left + scroller.clientLeft + scroller.clientWidth,
              ),
              bottom: Math.min(
                bounds.bottom,
                scrollBounds.top + scroller.clientTop + scroller.clientHeight,
              ),
              left: Math.max(bounds.left, scrollBounds.left + scroller.clientLeft),
            }
          : bounds;
      const row = target?.getBoundingClientRect();
      const left = row ? row.left + 3 : 0;
      const top = row ? row.top + (row.height - 18) / 2 : 0;
      const visible =
        target &&
        row &&
        row.width > 0 &&
        row.height > 0 &&
        left >= clip.left &&
        left + 3 <= clip.right &&
        top >= clip.top &&
        top + 18 <= clip.bottom;
      if (!visible) {
        if (active) {
          // Fade at the position currently on screen, even if a slide is unfinished.
          const position = getComputedStyle(marker!).transform;
          marker!.dataset.snap = '';
          marker!.style.transform = position;
        }
        marker!.dataset.visible = 'false';
        const exitClip = scroller ? clip : lastClip;
        overlay!.style.clipPath = exitClip
          ? `inset(${Math.max(0, exitClip.top - bounds.top)}px ${Math.max(0, bounds.right - exitClip.right)}px ${Math.max(0, bounds.bottom - exitClip.bottom)}px ${Math.max(0, exitClip.left - bounds.left)}px)`
          : '';
        active = null;
        return;
      }

      const next = { x: left - bounds.left, y: top - bounds.top };
      const changed = target !== active;
      const moved =
        !destination ||
        Math.abs(next.x - destination.x) > 1 / 64 ||
        Math.abs(next.y - destination.y) > 1 / 64;
      if (changed || moved) {
        const hidden = Number(getComputedStyle(marker!).opacity) === 0;
        if (hidden || !changed || preference.matches) marker!.dataset.snap = '';
        else delete marker!.dataset.snap;
        marker!.style.transform = `translate(${next.x}px, ${next.y}px)`;
        if (hidden) {
          // Commit the destination while invisible; only opacity enters from none.
          marker!.getBoundingClientRect();
        }
      }
      overlay!.style.clipPath = '';
      marker!.dataset.visible = 'true';
      active = target;
      destination = next;
      lastClip = clip;
    }
    const changes = new MutationObserver(schedule);
    changes.observe(sidebar, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-current', 'hidden'],
    });
    sidebar.addEventListener('scroll', schedule, { capture: true, passive: true });
    sidebar.addEventListener('collection-motion', update);
    window.addEventListener('resize', schedule);
    preference.addEventListener('change', schedule);
    measure.current = update;
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      sidebar.removeEventListener('scroll', schedule, true);
      sidebar.removeEventListener('collection-motion', update);
      window.removeEventListener('resize', schedule);
      preference.removeEventListener('change', schedule);
      measure.current = undefined;
    };
  }, [container]);
  useLayoutEffect(() => measure.current?.());
  return (
    <div className="sidebar-selection-overlay" aria-hidden="true">
      <span
        ref={indicator}
        className="sidebar-selection-indicator"
        aria-hidden="true"
        data-visible="false"
        data-snap=""
      />
    </div>
  );
}
