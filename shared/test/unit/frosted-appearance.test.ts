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

it('主窗口和面试固定沿用60%效果，忽略全部旧值且不读写偏好', () => {
  for (const value of ['0', '20', '60', '100', 'off', 'strong', 'broken']) {
    for (const key of keys) values.set(key, value);
    expect(readFrostedTransparency()).toBe(60);
    expect(readInterviewTransparency()).toBe(60);
    applyFrostedAppearance();
    expect(document.documentElement.dataset.frostedTransparency).toBe('60');
    expect(document.documentElement.dataset.interviewTransparency).toBe('60');
    for (const key of keys) expect(values.get(key)).toBe(value);
  }
  expect(storage.getItem).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
});
it('主窗口保留原60%曲线与虚化，不把60直接当作表面不透明度', () => {
  applyFrostedAppearance();
  expect(Number(properties.get('--frosted-opacity-light'))).toBeCloseTo(0.4, 10);
  expect(Number(properties.get('--frosted-opacity-dark'))).toBeCloseTo(0.512, 10);
  expect(properties.get('--frosted-main-filter')).toBe('blur(28.8px) saturate(130%)');
});
it('面试外层和阅读层保留原60%设置的独立曲线', () => {
  applyInterviewAppearance();
  for (const [key, value] of Object.entries({
    '--frosted-panel-light': 0.8496,
    '--frosted-panel-dark': 0.8872,
    '--frosted-chrome-light': 0.916,
    '--frosted-chrome-dark': 0.9248,
    '--frosted-reading-light': 0.8992,
    '--frosted-reading-dark': 0.928,
  }))
    expect(Number(properties.get(key))).toBeCloseTo(value, 10);
  expect(properties.get('--frosted-panel-filter')).toBe('blur(19.52px)');
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
