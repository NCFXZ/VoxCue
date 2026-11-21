import { flushSync } from 'react-dom';
import './page-motion.css';

let active: { target: HTMLElement; skip(): void; clear(): void } | undefined;
const revisions = new WeakMap<HTMLElement, number>();
type ViewBounds = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>;

function dialogViewport(target: HTMLElement, dialog: HTMLDialogElement): ViewBounds {
  const bounds = target.getBoundingClientRect();
  const clip = {
    top: Math.max(0, bounds.top),
    right: innerWidth,
    bottom: innerHeight,
    left: Math.max(0, bounds.left),
  };
  for (
    let parent = target.parentElement;
    parent && dialog.contains(parent);
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const rect = parent.getBoundingClientRect();
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
      clip.left = Math.max(clip.left, rect.left + parent.clientLeft);
      clip.right = Math.min(clip.right, rect.left + parent.clientLeft + parent.clientWidth);
    }
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
      clip.top = Math.max(clip.top, rect.top + parent.clientTop);
      clip.bottom = Math.min(clip.bottom, rect.top + parent.clientTop + parent.clientHeight);
    }
  }
  if (dialog.hasAttribute('data-overlay-header')) {
    const heading = dialog.querySelector<HTMLElement>(':scope > .dialog-heading');
    if (heading) clip.top = Math.max(clip.top, heading.getBoundingClientRect().bottom);
  }
  return clip;
}

function isClipped(bounds: ViewBounds, clip: ViewBounds) {
  // Client extents are integer-rounded; ignore that subpixel border round trip.
  return (
    bounds.top < clip.top - 1 ||
    bounds.left < clip.left - 1 ||
    bounds.right > clip.right + 1 ||
    bounds.bottom > clip.bottom + 1
  );
}

export function cancelViewSwitch(container?: HTMLElement) {
  if (active && (!container || container.contains(active.target))) {
    active.skip();
    active?.clear();
  }
}

// Browser snapshots animate the old view without keeping its controls or
// asynchronous React lifecycle alive alongside the new page.
export function switchView(
  target: HTMLElement | null,
  update: () => void,
  direction: 'page' | 'forward' | 'back' = 'page',
  geometry: 'shared' | 'independent' = 'shared',
) {
  const current = target ? (revisions.get(target) ?? 0) + 1 : 0;
  if (target) revisions.set(target, current);
  active?.skip();
  active?.clear();
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  if (!target || preference.matches || !document.startViewTransition) {
    update();
    return;
  }
  const root = document.documentElement;
  const previousName = target.style.viewTransitionName;
  // Distinct names slide each list at its own size without morphing the two boxes.
  target.style.viewTransitionName = geometry === 'independent' ? 'panel-outgoing' : 'screen';
  root.dataset.viewDirection = direction;
  const dialog = target.closest<HTMLDialogElement>('dialog.app-dialog');
  const chrome = dialog ? null : document.querySelector<HTMLElement>('.titlebar');
  const previousChromeName = chrome?.style.viewTransitionName ?? '';
  if (chrome) chrome.style.viewTransitionName = 'window-chrome';
  let updateClip: (() => void) | undefined;
  if (dialog) {
    const style = getComputedStyle(dialog);
    const top = parseFloat(style.borderTopWidth),
      right = parseFloat(style.borderRightWidth);
    const bottom = parseFloat(style.borderBottomWidth),
      left = parseFloat(style.borderLeftWidth);
    const radiiFor = (bounds: ViewBounds) => {
      const frame = dialog.getBoundingClientRect();
      const reaches = {
        top: Math.abs(bounds.top - frame.top - top) < 1,
        right: Math.abs(bounds.right - frame.right + right) < 1,
        bottom: Math.abs(bounds.bottom - frame.bottom + bottom) < 1,
        left: Math.abs(bounds.left - frame.left - left) < 1,
      };
      const radii = [
        [reaches.top && reaches.left, style.borderTopLeftRadius, Math.max(top, left)],
        [reaches.top && reaches.right, style.borderTopRightRadius, Math.max(top, right)],
        [reaches.bottom && reaches.right, style.borderBottomRightRadius, Math.max(bottom, right)],
        [reaches.bottom && reaches.left, style.borderBottomLeftRadius, Math.max(bottom, left)],
      ] as const;
      return radii
        .map(([edge, radius, border]) => `${edge ? Math.max(0, parseFloat(radius) - border) : 0}px`)
        .join(' ');
    };
    root.style.setProperty('--view-radius', radiiFor(target.getBoundingClientRect()));
    root.style.setProperty('--view-curve', style.getPropertyValue('corner-shape'));
    const before = dialogViewport(target, dialog);
    const clippedBefore = isClipped(target.getBoundingClientRect(), before);
    updateClip = () => {
      const after = dialogViewport(target, dialog);
      if (!clippedBefore && !isClipped(target.getBoundingClientRect(), after)) return;
      const clip = {
        top: Math.max(before.top, after.top),
        right: Math.min(before.right, after.right),
        bottom: Math.min(before.bottom, after.bottom),
        left: Math.max(before.left, after.left),
      };
      root.dataset.viewClip = geometry;
      root.style.setProperty('--view-clip-left', `${clip.left}px`);
      root.style.setProperty('--view-clip-top', `${clip.top}px`);
      root.style.setProperty('--view-clip-width', `${Math.max(0, clip.right - clip.left)}px`);
      root.style.setProperty('--view-clip-height', `${Math.max(0, clip.bottom - clip.top)}px`);
      root.style.setProperty('--view-clip-radius', radiiFor(clip));
    };
    updateClip();
  }
  let cleared = false;
  const transition = document.startViewTransition(() => {
    if (current === revisions.get(target) && target.isConnected) {
      flushSync(update);
      if (
        !cleared &&
        active?.target === target &&
        current === revisions.get(target) &&
        target.isConnected
      ) {
        if (geometry === 'independent') target.style.viewTransitionName = 'panel-incoming';
        updateClip?.();
      }
    }
  });
  const entry = {
    target,
    skip: () => transition.skipTransition(),
    clear: () => {
      if (cleared) return;
      cleared = true;
      preference.removeEventListener('change', reduce);
      target.style.viewTransitionName = previousName;
      if (chrome) chrome.style.viewTransitionName = previousChromeName;
      if (active === entry) {
        delete root.dataset.viewDirection;
        root.style.removeProperty('--view-radius');
        root.style.removeProperty('--view-curve');
        delete root.dataset.viewClip;
        for (const name of ['left', 'top', 'width', 'height', 'radius'])
          root.style.removeProperty(`--view-clip-${name}`);
        active = undefined;
      }
    },
  };
  const reduce = () => {
    if (preference.matches) transition.skipTransition();
  };
  active = entry;
  preference.addEventListener('change', reduce);
  // Skipping before capture intentionally rejects ready, while finished still
  // controls cleanup and the update callback retains its normal semantics.
  void transition.ready.catch(() => {});
  void transition.finished.then(entry.clear, entry.clear);
}
