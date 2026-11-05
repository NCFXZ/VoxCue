import { prepareVisualSnapshot } from './visual-snapshot';

function playMotion(content: HTMLElement, frames: Keyframe[], onRemove?: () => void) {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const style = getComputedStyle(content);
  const value = style.getPropertyValue('--panel-motion-duration').trim();
  const duration = parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
  if (preference.matches || !Number.isFinite(duration) || duration <= 0) {
    onRemove?.();
    return;
  }
  const animation = content.animate(frames, {
    duration,
    easing: style.getPropertyValue('--panel-motion-easing').trim() || 'ease',
    fill: 'forwards',
  });
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    preference.removeEventListener('change', stop);
    window.removeEventListener('resize', remove);
    animation.cancel();
    onRemove?.();
  };
  const stop = () => {
    if (preference.matches) remove();
  };
  preference.addEventListener('change', stop);
  window.addEventListener('resize', remove, { once: true });
  void animation.finished.then(remove, remove);
  return remove;
}

function pinReveal(content: HTMLElement) {
  const positioner = content.parentElement;
  const scroll = content.querySelector<HTMLElement>(':scope > .dropdown-scroll');
  if (!positioner?.hasAttribute('data-radix-popper-content-wrapper') || !scroll) return;
  if (content.dataset.side && !['top', 'bottom'].includes(content.dataset.side)) return;
  const style = getComputedStyle(content);
  const scrollStyle = getComputedStyle(scroll);
  const wrapperStyle = getComputedStyle(positioner);
  const height = style.height;
  const width = style.width;
  const opacity = style.opacity;
  const padding = { top: style.paddingTop, bottom: style.paddingBottom };
  const inner = { left: style.paddingLeft, width: scrollStyle.width, height: scrollStyle.height };
  const previous: (() => void)[] = [];
  const set = (node: HTMLElement, values: Record<string, string>) => {
    for (const [property, value] of Object.entries(values)) {
      const original = node.style.getPropertyValue(property);
      const priority = node.style.getPropertyPriority(property);
      previous.push(() => {
        if (original) node.style.setProperty(property, original, priority);
        else node.style.removeProperty(property);
      });
      node.style.setProperty(property, value);
    }
  };
  // FloatingUI measures this wrapper, whose final border box stays unchanged.
  // The actual surface can then grow a rounded border and an unclipped shadow.
  set(positioner, { width: wrapperStyle.width, height: wrapperStyle.height });
  set(content, {
    position: 'absolute',
    width,
    height,
    opacity,
    'padding-top': '0px',
    'padding-bottom': '0px',
  });
  set(scroll, {
    position: 'absolute',
    ...inner,
  });
  const above = content.dataset.side === 'top';
  set(content, { top: above ? 'auto' : '0px', bottom: above ? '0px' : 'auto' });
  set(scroll, { top: above ? 'auto' : padding.top, bottom: above ? padding.bottom : 'auto' });
  content.setAttribute('data-menu-height-motion', '');
  let restored = false;
  return {
    height,
    restore() {
      if (restored) return;
      restored = true;
      previous.reverse().forEach((restore) => restore());
      content.removeAttribute('data-menu-height-motion');
    },
  };
}

export function animateDropdownEnter(content: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const initial = pinReveal(content);
  if (!initial) return;
  let reveal = initial;
  content.style.height = '0px';
  content.style.opacity = '0';
  let cancel: (() => void) | undefined;
  let stopped = false;
  const restore = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    reveal.restore();
  };
  // A model-panel switch needs its new natural size, not the opening target.
  const observer = new MutationObserver(() => {
    cancel?.();
    restore();
  });
  observer.observe(content, { childList: true, subtree: true });
  // Resolve Popper's final top/bottom edge without animating its measured box.
  const frame = requestAnimationFrame(() => {
    if (stopped) return;
    // Popper's size middleware may have supplied an available-height limit
    // since attachment. Capture that final layout before fixing its wrapper.
    reveal.restore();
    const positioned = pinReveal(content);
    if (!positioned) {
      restore();
      return;
    }
    reveal = positioned;
    content.style.height = '0px';
    content.style.opacity = '0';
    cancel = playMotion(
      content,
      [
        { height: '0px', opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.6 },
        { height: reveal.height, opacity: 1, offset: 1 },
      ],
      restore,
    );
  });
  return () => {
    cancel?.();
    restore();
  };
}

// Radix must unmount immediately on close to release its focus, scroll and
// accessibility locks. Only this inert snapshot remains for the visual exit.
export function animateDropdownExit(
  content: HTMLElement,
  onRemove: () => void,
): (() => void) | undefined {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches) return;
  const positioner = content.parentElement;
  if (!positioner?.hasAttribute('data-radix-popper-content-wrapper')) return;
  const host = positioner.parentElement;
  if (!host) return;
  const style = getComputedStyle(content);
  if (content.dataset.side && !['top', 'bottom'].includes(content.dataset.side)) return;
  const height = style.height;
  const opacity = style.opacity;
  const snapshot = positioner.cloneNode(true) as HTMLElement;
  const surface = snapshot.querySelector<HTMLElement>('.dropdown-content')!;
  snapshot.inert = true;
  snapshot.setAttribute('aria-hidden', 'true');
  snapshot.style.pointerEvents = 'none';
  surface.inert = true;
  surface.setAttribute('aria-hidden', 'true');
  surface.setAttribute('data-state', 'closed');
  surface.setAttribute('data-menu-outro', '');
  surface.style.transformOrigin = style.transformOrigin;
  const originals = [positioner, ...positioner.querySelectorAll<HTMLElement>('*')];
  const copies = [snapshot, ...snapshot.querySelectorAll<HTMLElement>('*')];
  // A quick close can interrupt the model view, popup height or slider motion.
  // Freeze only their animated properties so disabling motion cannot jump them
  // to their final layout before the snapshot folds away.
  for (const animation of content.getAnimations({ subtree: true })) {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof HTMLElement)) continue;
    if (effect.target === content) continue;
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
    node.style.animation = 'none';
    node.style.transition = 'none';
  });
  // Keep the same portal/dialog parent, coordinates and scroll position.
  host.append(snapshot);
  // WAAPI effects are not cloned. A fast close continues from the surface's
  // current height while retaining its pinned final-size content and wrapper.
  surface.style.height = height;
  surface.style.opacity = opacity;
  if (!surface.hasAttribute('data-menu-height-motion')) pinReveal(surface);
  copies.forEach((node, index) => {
    node.scrollTop = originals[index].scrollTop;
    node.scrollLeft = originals[index].scrollLeft;
  });
  return playMotion(
    surface,
    [
      { height, opacity, offset: 0 },
      { opacity, offset: 0.9 },
      { height: '0px', opacity: 0, offset: 1 },
    ],
    () => {
      snapshot.remove();
      onRemove();
    },
  );
}
