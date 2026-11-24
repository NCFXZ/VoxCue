import { prepareVisualSnapshot } from './visual-snapshot';

let removeExit: (() => void) | undefined;

export function clearModalExit() {
  removeExit?.();
}

export function modalExitRemaining(scope: Document) {
  const exit = scope.querySelector('[data-modal-exit]');
  const fade = exit?.getAnimations().find((animation) =>
    animation instanceof CSSAnimation && animation.animationName === 'modal-fade-out');
  const end = Number(fade?.effect?.getComputedTiming().endTime ?? 0);
  return Math.max(0, end - Number(fade?.currentTime ?? 0));
}

// Business state and the native modal lock are released immediately. A manual
// popover keeps only the inert visual in the top layer while it fades away.
export function captureModalExit(dialog: HTMLDialogElement) {
  clearModalExit();
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches || !dialog.open || !dialog.isConnected) return;
  const rect = dialog.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const style = getComputedStyle(dialog);
  const value = style.getPropertyValue('--panel-motion-duration').trim() || '240ms';
  const duration = parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
  if (!Number.isFinite(duration) || duration <= 0) return;

  const snapshot = document.createElement('div');
  for (const attribute of dialog.attributes)
    if (!['id', 'role', 'name', 'aria-label', 'aria-labelledby'].includes(attribute.name))
      snapshot.setAttribute(attribute.name, attribute.value);
  for (const child of dialog.childNodes) snapshot.append(child.cloneNode(true));
  const originals = [dialog, ...dialog.querySelectorAll<HTMLElement>('*')];
  const copies = [snapshot, ...snapshot.querySelectorAll<HTMLElement>('*')];
  for (const animation of dialog.getAnimations({ subtree: true })) {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof HTMLElement)) continue;
    if (effect.target === dialog) continue;
    const copy = copies[originals.indexOf(effect.target)];
    if (!copy) continue;
    const computed = getComputedStyle(effect.target);
    for (const key of new Set(effect.getKeyframes().flatMap(Object.keys))) {
      if (['offset', 'computedOffset', 'easing', 'composite'].includes(key)) continue;
      const property = key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
      copy.style.setProperty(property, computed.getPropertyValue(property));
    }
  }
  prepareVisualSnapshot(copies);
  copies.forEach((node) => {
    node.style.transition = 'none';
    node.style.viewTransitionName = 'none';
    if (node !== snapshot) node.style.animation = 'none';
  });
  snapshot.inert = true;
  snapshot.setAttribute('aria-hidden', 'true');
  snapshot.setAttribute('popover', 'manual');
  snapshot.setAttribute('data-modal-exit', '');
  snapshot.style.cssText += `;position:fixed;inset:auto;margin:0;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;min-width:0;min-height:0;max-width:none;max-height:none;pointer-events:none;`;
  snapshot.style.setProperty('--modal-exit-opacity', style.opacity);
  snapshot.style.setProperty(
    '--modal-backdrop-exit-opacity',
    getComputedStyle(dialog, '::backdrop').opacity,
  );
  document.body.append(snapshot);
  const offsets = originals.map((node) => [node.scrollLeft, node.scrollTop]);

  let timer: ReturnType<typeof setTimeout>;
  const remove = () => {
    clearTimeout(timer);
    preference.removeEventListener('change', reduce);
    snapshot.removeEventListener('animationend', finish);
    snapshot.remove();
    if (removeExit === remove) removeExit = undefined;
  };
  const reduce = () => {
    if (preference.matches) remove();
  };
  const finish = (event: AnimationEvent) => {
    if (event.target === snapshot && !event.pseudoElement) remove();
  };
  removeExit = remove;
  return () => {
    preference.addEventListener('change', reduce);
    snapshot.addEventListener('animationend', finish);
    timer = setTimeout(remove, duration + 50);
    try {
      snapshot.showPopover();
      copies.forEach((node, index) => {
        [node.scrollLeft, node.scrollTop] = offsets[index];
      });
    } catch {
      remove();
    }
  };
}
