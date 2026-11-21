const durationMs = 1900;
const timers = new WeakMap<HTMLElement, number>();

/** A new navigation to the same row restarts the full highlight. */
export function highlightLocation(row: HTMLElement): () => void {
  window.clearTimeout(timers.get(row));
  row.removeAttribute('data-location-highlight');
  // Commit the cleared style so consecutive clicks can replay the same CSS animation.
  void row.offsetWidth;
  row.style.setProperty('--location-highlight-duration', durationMs + 'ms');
  row.setAttribute('data-location-highlight', '');

  const timer = window.setTimeout(clear, durationMs);
  timers.set(row, timer);
  function clear() {
    if (timers.get(row) !== timer) return;
    window.clearTimeout(timer);
    timers.delete(row);
    row.removeAttribute('data-location-highlight');
    row.style.removeProperty('--location-highlight-duration');
  }
  return clear;
}
