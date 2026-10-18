import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  readInterviewFontSize,
  saveInterviewFontSize,
  subscribeInterviewFontSize,
} from '../../../shared/src/interviewTypography';
const key = 'voxcue-interview-font-size-v1';
const values = new Map<string, string>();
let events: EventTarget;
beforeEach(() => {
  values.clear();
  events = new EventTarget();
  vi.stubGlobal('window', events);
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => values.set(name, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it('默认 14，保留合法字号；损坏、非整数与越界偏好不覆盖原始值', () => {
  expect(readInterviewFontSize()).toBe(14);
  for (const value of [12, 14, 24]) {
    values.set(key, String(value));
    expect(readInterviewFontSize()).toBe(value);
  }
  for (const invalid of ['null', '"20"', '{}', '[]', '11', '25', '14.5', 'broken']) {
    values.set(key, invalid);
    expect(readInterviewFontSize()).toBe(14);
    expect(values.get(key)).toBe(invalid);
  }
});
it('调整和重置通知本窗口与其他窗口，订阅不回写，释放后停止通知', () => {
  const changed = vi.fn();
  const unsubscribe = subscribeInterviewFontSize(changed);
  saveInterviewFontSize(18);
  expect(values.get(key)).toBe('18');
  expect(changed).toHaveBeenLastCalledWith(18);
  values.set(key, '20');
  events.dispatchEvent(Object.assign(new Event('storage'), { key }));
  expect(changed).toHaveBeenLastCalledWith(20);
  expect(changed).toHaveBeenCalledTimes(2);
  saveInterviewFontSize(14);
  expect(changed).toHaveBeenLastCalledWith(14);
  unsubscribe();
  saveInterviewFontSize(24);
  expect(changed).toHaveBeenCalledTimes(3);
});
it('非法字号和保存失败不会通知虚假的成功状态', () => {
  saveInterviewFontSize(18);
  const changed = vi.fn();
  subscribeInterviewFontSize(changed);
  for (const value of [NaN, Infinity, -Infinity, 11, 25, 14.5])
    expect(() => saveInterviewFontSize(value)).toThrow();
  vi.stubGlobal('localStorage', {
    getItem: () => '18',
    setItem: () => {
      throw Error('denied');
    },
  });
  expect(() => saveInterviewFontSize(20)).toThrow('denied');
  expect(readInterviewFontSize()).toBe(18);
  expect(changed).not.toHaveBeenCalled();
});
