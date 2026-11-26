import { describe, expect, it } from 'vitest';
import { continuedTiming, runningMotion } from '../../src/components/ui/motion-continuation';

const standard = { duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

function animation(local: number, easing = 'linear', playState = 'running', delay = 0) {
  return {
    playState,
    effect: {
      getTiming: () => ({ duration: 240, delay, easing }),
      getComputedTiming: () => ({ localTime: local }),
    },
  } as unknown as Animation;
}

describe('motion continuation', () => {
  it('keeps the shared timing when nothing was moving', () => {
    expect(continuedTiming(standard, undefined, [40])).toBe(standard);
    expect(runningMotion(animation(120, 'linear', 'finished'), [100])).toBeUndefined();
    expect(runningMotion(animation(120, 'linear', 'paused'), [100])).toBeUndefined();
    expect(runningMotion(undefined, [100])).toBeUndefined();
  });

  it('shortens a reversal to the distance already travelled, from rest and no shorter than 120 ms', () => {
    const halfway = runningMotion(animation(120), [-50]);
    expect(continuedTiming(standard, halfway, [25])).toEqual({ duration: 120, easing: standard.easing });
    const longer = { duration: 400, easing: standard.easing };
    expect(continuedTiming(longer, runningMotion(animation(200), [-100]), [50])).toEqual({ duration: 200, easing: standard.easing });
    expect(continuedTiming(standard, runningMotion(animation(20), [-100]), [5]).duration).toBe(120);
  });

  it('starts a same-direction retarget at the carried speed instead of from rest', () => {
    // Linear travel of 100 over 240 ms carries 100 / 240 per ms. Over the next
    // 100 in 240 ms that is a normalized slope of 1, so y1 equals x1.
    const carried = runningMotion(animation(120), [100]);
    expect(carried?.velocity[0]).toBeCloseTo(100 / 240, 9);
    expect(continuedTiming(standard, carried, [100])).toEqual({ duration: 240, easing: 'cubic-bezier(0.2, 0.2, 0, 1)' });
    // Only the speed toward the new target is carried; the shorter leg also takes less time.
    const diagonal = runningMotion(animation(120), [100, 100]);
    const across = continuedTiming(standard, diagonal, [100, 0]);
    expect(across.duration).toBeCloseTo(240 / Math.SQRT2, 9);
    expect(across.easing).toBe('cubic-bezier(0.2, 0.1414, 0, 1)');
    expect(continuedTiming(standard, diagonal, [0, -100]).easing).toBe(standard.easing);
  });

  it('carries no speed before a delayed motion starts or from an eased start at rest', () => {
    expect(runningMotion(animation(40, 'linear', 'running', 80), [100])?.velocity).toEqual([0]);
    const start = runningMotion(animation(0.001, standard.easing), [100])!;
    const middle = runningMotion(animation(60, standard.easing), [100])!;
    expect(start.velocity[0]).toBeLessThan(0.001);
    expect(middle.velocity[0]).toBeGreaterThan(100 / 240);
  });
});
