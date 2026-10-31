import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  applyFrostedAppearance,
  readFrostedTransparency,
} from '../../../shared/src/frostedAppearance';
import {
  applyInterviewAppearance,
  readInterviewTransparency,
  saveInterviewTransparency,
  subscribeInterviewTransparency,
} from '../../../shared/src/interviewAppearance';

const values = new Map<string, string>();
const properties = new Map<string, string>();
const key = 'voxcue-interview-background-transparency-v1';
let events: EventTarget;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
beforeEach(() => {
  values.clear();
  properties.clear();
  events = new EventTarget();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', Object.assign(events, { desktop: { platform: 'windows' } }));
  vi.stubGlobal('document', {
    documentElement: {
      dataset: {},
      style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
        removeProperty: (key: string) => properties.delete(key),
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('恢复合法面试偏好，损坏或越界值回退100且不改写原件', () => {
  expect(readInterviewTransparency()).toBe(100);
  for (const value of [0, 37, 100]) {
    values.set(key, String(value));
    expect(readInterviewTransparency()).toBe(value);
  }
  for (const value of ['null', '"20"', '{}', '[]', '-1', '101', '14.5', 'broken']) {
    values.set(key, value);
    expect(readInterviewTransparency()).toBe(100);
    expect(values.get(key)).toBe(value);
  }
  expect(storage.setItem).not.toHaveBeenCalled();
});

it('两端共用70/35上限，不改变主窗材质、Windows侧栏或独立通知', () => {
  for (const platform of ['windows', 'macos']) {
    window.desktop!.platform = platform as 'windows' | 'macos';
    const notices = new Map<string, string>();
    for (const value of [0, 50, 100]) {
      values.set(key, String(value));
      applyFrostedAppearance();
      expect(document.documentElement.dataset.interviewTransparency).toBe(String(value));
      expect(document.documentElement.dataset.frostedTransparency).toBe('100');
      expect(readFrostedTransparency()).toBe(100);
      expect(properties.get('--frosted-main-filter')).toBe('none');
      expect(Number(properties.get('--frosted-opacity-dark'))).toBeCloseTo(0);
      for (const name of ['--interview-chrome-panel-light', '--interview-chrome-panel-dark']) {
        if (value === 0) notices.set(name, properties.get(name)!);
        expect(properties.get(name)).toBe(notices.get(name));
      }
      if (platform === 'windows') {
        expect(Number(properties.get('--windows-sidebar-opacity-light'))).toBeCloseTo(0.4);
        expect(Number(properties.get('--windows-sidebar-opacity-dark'))).toBeCloseTo(0.512);
        expect(Number(properties.get('--interview-chrome-panel-dark'))).toBeCloseTo(0.8872);
      } else {
        expect(properties.has('--windows-sidebar-opacity-light')).toBe(false);
        expect(properties.has('--windows-sidebar-opacity-dark')).toBe(false);
        expect(Number(properties.get('--interview-chrome-panel-dark'))).toBeCloseTo(0.692);
      }
      if (value === 0)
        for (const name of [
          '--frosted-panel-light',
          '--frosted-panel-dark',
          '--interview-bubble-light',
          '--interview-bubble-dark',
        ])
          expect(Number(properties.get(name))).toBe(1);
      if (value === 100) {
        expect(Number(properties.get('--frosted-panel-light'))).toBeCloseTo(0.504);
        expect(Number(properties.get('--frosted-panel-dark'))).toBeCloseTo(0.564);
        expect(Number(properties.get('--interview-bubble-light'))).toBeCloseTo(0.764);
        expect(Number(properties.get('--interview-bubble-dark'))).toBeCloseTo(0.812);
      }
    }
  }
  expect(storage.setItem).not.toHaveBeenCalled();
});

it('本窗口与跨窗口实时更新，忽略其他设置，取消订阅后停止更新', () => {
  const changed = vi.fn(() => applyInterviewAppearance());
  const unsubscribe = subscribeInterviewTransparency(changed);
  saveInterviewTransparency(35);
  expect(values.get(key)).toBe('35');
  expect(changed).toHaveBeenLastCalledWith(35);
  expect(document.documentElement.dataset.interviewTransparency).toBe('35');
  values.set(key, '70');
  events.dispatchEvent(Object.assign(new Event('storage'), { key: 'unrelated' }));
  expect(changed).toHaveBeenCalledTimes(1);
  events.dispatchEvent(Object.assign(new Event('storage'), { key }));
  expect(changed).toHaveBeenLastCalledWith(70);
  expect(document.documentElement.dataset.interviewTransparency).toBe('70');
  values.clear();
  events.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
  expect(changed).toHaveBeenLastCalledWith(100);
  unsubscribe();
  saveInterviewTransparency(0);
  expect(changed).toHaveBeenCalledTimes(3);
});

it('非法值或保存失败不会通知虚假的成功，读取失败仍提供默认材质', () => {
  const changed = vi.fn();
  subscribeInterviewTransparency(changed);
  for (const invalid of [NaN, Infinity, -Infinity, -1, 101, 14.5])
    expect(() => saveInterviewTransparency(invalid)).toThrow();
  saveInterviewTransparency(37);
  changed.mockClear();
  storage.setItem.mockImplementation(() => {
    throw Error('denied');
  });
  expect(() => saveInterviewTransparency(50)).toThrow('denied');
  expect(readInterviewTransparency()).toBe(37);
  expect(changed).not.toHaveBeenCalled();
  storage.getItem.mockImplementation(() => {
    throw Error('denied');
  });
  expect(readInterviewTransparency()).toBe(100);
  expect(() => applyInterviewAppearance()).not.toThrow();
});
