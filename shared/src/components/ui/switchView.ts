import { flushSync } from 'react-dom';
import './page-motion.css';

let active: { target: HTMLElement; skip(): void; clear(): void } | undefined;
const revisions = new WeakMap<HTMLElement, number>();

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
  target.style.viewTransitionName = 'screen';
  root.dataset.viewDirection = direction;
  const dialog = target.closest('dialog.app-dialog');
  const chrome = dialog ? null : document.querySelector<HTMLElement>('.titlebar');
  const previousChromeName = chrome?.style.viewTransitionName ?? '';
  if (chrome) chrome.style.viewTransitionName = 'window-chrome';
  if (dialog) {
    const frame = dialog.getBoundingClientRect(),
      bounds = target.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    const top = parseFloat(style.borderTopWidth),
      right = parseFloat(style.borderRightWidth);
    const bottom = parseFloat(style.borderBottomWidth),
      left = parseFloat(style.borderLeftWidth);
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
    root.style.setProperty(
      '--view-radius',
      radii
        .map(([edge, radius, border]) => `${edge ? Math.max(0, parseFloat(radius) - border) : 0}px`)
        .join(' '),
    );
    root.style.setProperty('--view-curve', style.getPropertyValue('corner-shape'));
  }
  const transition = document.startViewTransition(() => {
    if (current === revisions.get(target) && target.isConnected) flushSync(update);
  });
  let cleared = false;
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
