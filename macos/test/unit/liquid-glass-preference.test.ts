import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readLiquidGlass, subscribeLiquidGlass } from '../../src/liquidGlassPreference';

const key = 'voxcue-liquid-glass-enabled-v1';
const legacy = 'voxcue-frosted-transparency-v2';
const values = new Map<string, string>();
let events: EventTarget;
beforeEach(() => {
  values.clear();
  events = new EventTarget();
  vi.stubGlobal('window', events);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('inherits the old zero/nonzero preference without changing other material parameters', () => {
  expect(readLiquidGlass()).toBe(true);
  for (const value of [0, 25, 50, 100]) {
    values.set(legacy, String(value));
    expect(readLiquidGlass()).toBe(value > 0);
    expect(values.has(key)).toBe(false);
    expect(values.get(legacy)).toBe(String(value));
  }
  values.set(legacy, '47.25');
  values.set(key, 'false');
  expect(readLiquidGlass()).toBe(false);
  expect(values.get(legacy)).toBe('47.25');
  values.set(key, 'true');
  expect(readLiquidGlass()).toBe(true);
  expect(values.get(legacy)).toBe('47.25');
});
it('rejects corrupt saved types and retains the existing appearance without rewriting storage', () => {
  values.set(legacy, '0');
  for (const value of ['null', '"false"', '0', '{}', '[]', 'broken']) {
    values.set(key, value);
    expect(readLiquidGlass()).toBe(false);
    expect(values.get(key)).toBe(value);
  }
});
it('keeps cross-window preference compatibility without exposing a removed settings writer', () => {
  const changed = vi.fn();
  const stop = subscribeLiquidGlass(changed);
  values.set(key, 'false');
  events.dispatchEvent(Object.assign(new Event('storage'), { key }));
  expect(readLiquidGlass()).toBe(false);
  expect(changed).toHaveBeenCalledOnce();
  events.dispatchEvent(Object.assign(new Event('storage'), { key: 'unrelated' }));
  expect(changed).toHaveBeenCalledOnce();
  stop();
  events.dispatchEvent(Object.assign(new Event('storage'), { key }));
  expect(changed).toHaveBeenCalledOnce();
});
