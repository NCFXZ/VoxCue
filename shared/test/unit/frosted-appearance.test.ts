import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  applyFrostedAppearance,
  readFrostedTransparency,
  saveFrostedTransparency,
  subscribeFrostedTransparency,
} from '../../../shared/src/frostedAppearance';
import {
  readInterviewTransparency,
  saveInterviewTransparency,
  subscribeInterviewTransparency,
} from '../../../shared/src/interviewAppearance';
const key = 'voxcue-frosted-transparency-v2';
const values = new Map<string, string>();
const properties = new Map<string, string>();
let events: EventTarget;
beforeEach(() => {
  values.clear();
  properties.clear();
  events = new EventTarget();
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => values.set(name, value),
  });
  vi.stubGlobal('window', events);
  vi.stubGlobal('document', {
    documentElement: {
      dataset: {},
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it('默认 50、旧四档只读兼容，损坏/越界偏好不迁移或覆盖原始值', () => {
  expect(readFrostedTransparency()).toBe(50);
  for (const [legacy, value] of [
    ['off', 0],
    ['weak', 25],
    ['medium', 50],
    ['strong', 100],
  ] as const) {
    values.set('voxcue-frosted-strength-v1', legacy);
    expect(readFrostedTransparency()).toBe(value);
    expect(values.has(key)).toBe(false);
  }
  for (const invalid of ['null', '"100"', '{}', '[]', '-1', '100.1', 'broken']) {
    values.set(key, invalid);
    expect(readFrostedTransparency()).toBe(50);
    expect(values.get(key)).toBe(invalid);
  }
});
it('连续值保存与当前窗口/跨窗口通知共用，无回写循环，取消订阅后不再通知', () => {
  const changed = vi.fn();
  const unsubscribe = subscribeFrostedTransparency(changed);
  saveFrostedTransparency(47.25);
  expect(values.get(key)).toBe('47.25');
  expect(changed).toHaveBeenLastCalledWith(47.25);
  values.set(key, '75');
  events.dispatchEvent(Object.assign(new Event('storage'), { key }));
  expect(changed).toHaveBeenLastCalledWith(75);
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribe();
  saveFrostedTransparency(100);
  expect(changed).toHaveBeenCalledTimes(2);
});
it('非法值与存储拒绝均明确失败，保留旧值，不广播虚假的成功状态', () => {
  saveFrostedTransparency(50);
  const changed = vi.fn();
  subscribeFrostedTransparency(changed);
  for (const value of [NaN, Infinity, -Infinity, -0.01, 100.01])
    expect(() => saveFrostedTransparency(value)).toThrow();
  expect(values.get(key)).toBe('50');
  expect(changed).not.toHaveBeenCalled();
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw Error('denied');
    },
    setItem: () => {
      throw Error('denied');
    },
  });
  expect(readFrostedTransparency()).toBe(50);
  expect(() => saveFrostedTransparency(60)).toThrow('denied');
  expect(changed).not.toHaveBeenCalled();
});
it('面试独立保存与同步，保留旧版背景60/阅读30的曲线和不透明下限', () => {
  expect(readInterviewTransparency()).toBe(20);
  const changed = vi.fn();
  const unsubscribe = subscribeInterviewTransparency(changed);
  saveInterviewTransparency(0);
  expect(properties.get('--frosted-panel-light')).toBe('1');
  saveFrostedTransparency(100);
  expect(properties.get('--frosted-panel-light')).toBe('1');
  expect(readInterviewTransparency()).toBe(0);
  saveInterviewTransparency(100);
  expect(Number(properties.get('--frosted-panel-light'))).toBeCloseTo(0.632);
  expect(Number(properties.get('--frosted-panel-dark'))).toBeCloseTo(0.692);
  expect(Number(properties.get('--frosted-chrome-light'))).toBeCloseTo(0.768);
  expect(Number(properties.get('--frosted-chrome-dark'))).toBeCloseTo(0.804);
  expect(Number(properties.get('--frosted-reading-light'))).toBeCloseTo(0.812);
  expect(Number(properties.get('--frosted-reading-dark'))).toBeCloseTo(0.856);
  expect(properties.get('--frosted-panel-filter')).toBe('blur(19.2px)');
  expect(readFrostedTransparency()).toBe(100);
  saveFrostedTransparency(0);
  expect(Number(properties.get('--frosted-panel-light'))).toBeCloseTo(0.632);
  expect(changed).toHaveBeenCalledTimes(2);
  values.set('voxcue-interview-background-transparency-v1', '30');
  events.dispatchEvent(
    Object.assign(new Event('storage'), { key: 'voxcue-interview-background-transparency-v1' }),
  );
  expect(changed).toHaveBeenLastCalledWith(30);
  unsubscribe();
  saveInterviewTransparency(50);
  expect(Number(properties.get('--frosted-panel-light'))).toBeCloseTo(0.888);
  expect(Number(properties.get('--frosted-panel-dark'))).toBeCloseTo(0.916);
  expect(Number(properties.get('--frosted-reading-light'))).toBeCloseTo(0.916);
  expect(Number(properties.get('--frosted-reading-dark'))).toBeCloseTo(0.94);
  expect(properties.get('--frosted-panel-filter')).toBe('blur(17.6px)');
  for (let value = 0; value <= 100; value += 0.5) {
    saveInterviewTransparency(value);
    applyFrostedAppearance();
    expect([...properties.values()].some((value) => /NaN|Infinity/.test(value))).toBe(false);
  }
  for (const value of [NaN, Infinity, -1, 101])
    expect(() => saveInterviewTransparency(value)).toThrow();
  for (const invalid of ['null', '"100"', '{}', '-1', '101', 'broken']) {
    values.set('voxcue-interview-background-transparency-v1', invalid);
    expect(readInterviewTransparency()).toBe(20);
    expect(values.get('voxcue-interview-background-transparency-v1')).toBe(invalid);
  }
});
