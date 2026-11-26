// Web Animations restart from rest at full length. When a running motion is
// replaced, keep the speed it carries and shorten a short or reversed leg the
// way CSS transitions shorten a reversal.

export type RunningMotion = { travel: readonly number[]; velocity: readonly number[] };

const keywords: Record<string, readonly number[]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
};

function curve(easing: string) {
  const value = easing.trim();
  if (keywords[value]) return keywords[value];
  const points = /^cubic-bezier\(([^)]*)\)$/.exec(value)?.[1].split(',').map(Number);
  return points?.length === 4 && points.every(Number.isFinite) ? points : undefined;
}

// Slope of the eased progress at a fraction of the active duration.
function slope([x1, y1, x2, y2]: readonly number[], fraction: number) {
  const at = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  const rate = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b);
  let low = 0;
  let high = 1;
  for (let step = 0; step < 30; step++) {
    const middle = (low + high) / 2;
    if (at(middle, x1, x2) < fraction) low = middle;
    else high = middle;
  }
  const t = (low + high) / 2;
  const dx = rate(t, x1, x2);
  return dx > 1e-6 ? rate(t, y1, y2) / dx : 0;
}

/** Read a running motion's velocity along its travel, per millisecond. Call before cancelling it. */
export function runningMotion(
  animation: Animation | undefined,
  travel: readonly number[],
): RunningMotion | undefined {
  const effect = animation?.playState === 'running' ? animation.effect : null;
  if (!effect) return;
  const { duration, delay = 0, easing = 'linear' } = effect.getTiming();
  const local = effect.getComputedTiming().localTime;
  const points = curve(easing);
  if (typeof duration !== 'number' || !(duration > 0) || local === null || local === undefined || !points)
    return;
  const fraction = (Number(local) - delay) / duration;
  const rate = fraction > 0 && fraction < 1 ? slope(points, fraction) / duration : 0;
  return { travel, velocity: travel.map((value) => value * rate) };
}

/**
 * Time a motion that replaces `running` and travels `next`, in the same units.
 * A reversal or a shorter leg takes its share of the duration, at least 120 ms.
 * A leg in the same direction starts at the carried speed instead of from rest.
 */
export function continuedTiming<T extends { duration: number; easing: string }>(
  timing: T,
  running: RunningMotion | undefined,
  next: readonly number[],
): T {
  const span = running ? Math.hypot(...running.travel) : 0;
  const remaining = Math.hypot(...next);
  if (!running || !(span > 0) || !(remaining > 0)) return timing;
  const duration = Math.max(
    Math.min(timing.duration, 120),
    timing.duration * Math.min(1, remaining / span),
  );
  const carried =
    running.velocity.reduce((sum, value, index) => sum + value * (next[index] ?? 0), 0) / remaining;
  const points = curve(timing.easing);
  if (!points || !(carried > 0)) return { ...timing, duration };
  const [x1, , x2, y2] = points;
  // The curve leaves at slope y1 / x1, the carried speed in its normalized units.
  const y1 = Math.min(1, (x1 * carried * duration) / remaining);
  return { ...timing, duration, easing: `cubic-bezier(${x1}, ${Number(y1.toFixed(4))}, ${x2}, ${y2})` };
}
