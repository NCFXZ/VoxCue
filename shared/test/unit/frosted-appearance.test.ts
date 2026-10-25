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

it('共用材质预设保持100，Windows三层独立固定60%且不读写旧偏好', () => {
  for (const value of ['0', '20', '60', '100', 'off', 'strong', 'broken']) {
    for (const key of keys) values.set(key, value);
    expect(readFrostedTransparency()).toBe(100);
    expect(readInterviewTransparency()).toBe(100);
    applyFrostedAppearance();
    expect(document.documentElement.dataset.frostedTransparency).toBe('100');
    expect(document.documentElement.dataset.interviewTransparency).toBe('100');
    expect(Number(properties.get('--windows-sidebar-opacity-light'))).toBeCloseTo(0.4);
    expect(Number(properties.get('--windows-sidebar-opacity-dark'))).toBeCloseTo(0.512);
    for (const key of keys) expect(values.get(key)).toBe(value);
  }
  expect(storage.getItem).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
});
it('Mac参数保持原值，Windows专用参数不会遗留到Mac', () => {
  applyFrostedAppearance();
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
  for (const key of [
    '--windows-sidebar-opacity-light',
    '--windows-sidebar-opacity-dark',
    '--windows-interview-bubble-light',
    '--windows-interview-bubble-dark',
  ])
    expect(properties.has(key)).toBe(false);
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
it('Windows仅背景和文字气泡恢复0.5.9的60%映射，保留其他玻璃参数', () => {
  applyInterviewAppearance();
  expect(properties.has('--frosted-reading-dark')).toBe(false);
  expect(properties.has('--frosted-chrome-dark')).toBe(false);
  for (const [key, value] of Object.entries({
    '--frosted-panel-light': 0.8496,
    '--frosted-panel-dark': 0.8872,
    '--windows-interview-bubble-light': 0.8992,
    '--windows-interview-bubble-dark': 0.928,
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
