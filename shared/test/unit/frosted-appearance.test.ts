import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  applyFrostedAppearance,
  readFrostedTransparency,
} from '../../../shared/src/frostedAppearance';
import {
  applyInterviewAppearance,
  readInterviewTransparency,
} from '../../../shared/src/interviewAppearance';

const values = new Map<string, string>();
const properties = new Map<string, string>();
const keys = [
  'voxcue-frosted-transparency-v2',
  'voxcue-frosted-strength-v1',
  'voxcue-interview-background-transparency-v1',
];
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
beforeEach(() => {
  values.clear();
  properties.clear();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { desktop: { platform: 'windows' } });
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

it('主窗口和面试使用最高透明档，忽略全部旧值且不读写偏好', () => {
  for (const value of ['0', '20', '60', '100', 'off', 'strong', 'broken']) {
    for (const key of keys) values.set(key, value);
    expect(readFrostedTransparency()).toBe(100);
    expect(readInterviewTransparency()).toBe(100);
    applyFrostedAppearance();
    expect(document.documentElement.dataset.frostedTransparency).toBe('100');
    expect(document.documentElement.dataset.interviewTransparency).toBe('100');
    for (const key of keys) expect(values.get(key)).toBe(value);
  }
  expect(storage.getItem).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
});
it('Mac和Windows共用旧曲线最高档，不读写旧偏好', () => {
  vi.stubGlobal('window', { desktop: { platform: 'macos' } });
  applyFrostedAppearance();
  expect(readFrostedTransparency()).toBe(100);
  expect(readInterviewTransparency()).toBe(100);
  expect(document.documentElement.dataset.frostedTransparency).toBe('100');
  expect(document.documentElement.dataset.interviewTransparency).toBe('100');
  expect(properties.get('--frosted-main-filter')).toBe('none');
  expect(properties.has('--web-material-min-opacity')).toBe(false);
  expect(Number(properties.get('--frosted-panel-light'))).toBeCloseTo(0.632);
  expect(Number(properties.get('--frosted-panel-dark'))).toBeCloseTo(0.692);
  expect(storage.getItem).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
  vi.stubGlobal('window', { desktop: { platform: 'windows' } });
  applyFrostedAppearance();
  expect(document.documentElement.dataset.frostedTransparency).toBe('100');
  expect(properties.has('--web-material-min-opacity')).toBe(false);
});
it('主窗口最高档不叠加网页滤镜，交给系统材质', () => {
  applyFrostedAppearance();
  expect(Number(properties.get('--frosted-opacity-light'))).toBeCloseTo(0, 10);
  expect(Number(properties.get('--frosted-opacity-dark'))).toBeCloseTo(0, 10);
  expect(properties.get('--frosted-main-filter')).toBe('none');
});
it('面试大背景保留60曲线，内部玻璃不再设置独立底色', () => {
  applyInterviewAppearance();
  expect(properties.has('--frosted-reading-dark')).toBe(false);
  expect(properties.has('--frosted-chrome-dark')).toBe(false);
  for (const [key, value] of Object.entries({
    '--frosted-panel-light': 0.632,
    '--frosted-panel-dark': 0.692,
  }))
    expect(Number(properties.get(key))).toBeCloseTo(value, 10);
});
it('存储不可用时仍有相同固定材质；重新应用不接受迟到的旧值', () => {
  storage.getItem.mockImplementation(() => {
    throw Error('denied');
  });
  storage.setItem.mockImplementation(() => {
    throw Error('denied');
  });
  applyFrostedAppearance();
  const baseline = [...properties];
  for (const key of keys) values.set(key, '100');
  applyFrostedAppearance();
  expect([...properties]).toEqual(baseline);
  expect(storage.getItem).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
});
