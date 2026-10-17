import { expect, it } from 'vitest';
import { microphoneLevel } from '../../../shared/src/services/audioLevel';
it('把正常人声的线性 RMS 转换为可读的对数音量，不把静音和无效输入当作声音', () => {
  for (const rms of [0, -1, NaN, Infinity, 0.0001]) expect(microphoneLevel(rms)).toBe(0);
  expect(microphoneLevel(0.01)).toBeGreaterThan(30);
  expect(microphoneLevel(0.03)).toBeGreaterThan(50);
  expect(microphoneLevel(0.1)).toBeGreaterThan(microphoneLevel(0.03));
  expect(microphoneLevel(1)).toBe(100);
});
