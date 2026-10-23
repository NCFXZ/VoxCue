// The settings scroller contains Chromium text and AppKit artwork. Apply wheel
// deltas and publish their geometry in the same renderer frame, instead of
// letting compositor scrolling run ahead of two separately queued RAF readers.
if (window.desktop?.platform === 'macos' && window.desktop.presentation?.liquidGlass === true) {
  const selector = '.settings-content-body,.interview-settings-dialog > .dialog-scroll';
  let frame = 0;
  const pending = new Map<HTMLElement, number>();
  const synchronize = () => document.dispatchEvent(new Event('voxcue-native-scroll'));
  const flush = () => {
    frame = 0;
    for (const [element, delta] of pending) if (element.isConnected) element.scrollTop += delta;
    pending.clear();
    synchronize();
  };
  const wheel = (event: WheelEvent) => {
    if (
      event.ctrlKey ||
      !event.deltaY ||
      !(event.target instanceof Element) ||
      (!document.documentElement.classList.contains('sidebar-liquid-glass') &&
        !document.documentElement.classList.contains('macos-interview-glass'))
    )
      return;
    const element = event.target.closest<HTMLElement>(selector);
    if (!element || element.scrollHeight <= element.clientHeight || !event.cancelable) return;
    // A nested scrollable field retains its own scrolling.
    for (let child = event.target; child !== element; child = child.parentElement!)
      if (
        child instanceof HTMLElement &&
        /(auto|scroll)/.test(getComputedStyle(child).overflowY) &&
        child.scrollHeight > child.clientHeight
      )
        return;
    event.preventDefault();
    const scale =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 20
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? element.clientHeight
          : 1;
    pending.set(element, (pending.get(element) ?? 0) + event.deltaY * scale);
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const scroll = (event: Event) => {
    if (event.target instanceof Element && event.target.matches(selector)) synchronize();
  };
  document.addEventListener('wheel', wheel, { passive: false });
  document.addEventListener('scroll', scroll, true);
  const dispose = () => {
    cancelAnimationFrame(frame);
    pending.clear();
    document.removeEventListener('wheel', wheel);
    document.removeEventListener('scroll', scroll, true);
  };
  window.addEventListener('beforeunload', dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
