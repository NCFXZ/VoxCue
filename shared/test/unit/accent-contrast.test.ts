import { expect, it } from 'vitest';
import { accentOptions, readableAccent } from '../../../shared/src/systemAccent';
const luminance = (hex: string) =>
  hex
    .slice(1)
    .match(/../g)!
    .map((c) => parseInt(c, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
it('系统强调色在浅深表面都保持普通文字对比度，包括极浅和极深颜色', () => {
  for (const dark of [false, true])
    for (const color of [
      '#ffffff',
      '#000000',
      '#ffff00',
      '#459bac',
      '#0078d4',
      '#ff00ff',
      ...accentOptions.filter((option) => option.value !== 'system').map((option) => option.value),
    ]) {
      const result = readableAccent(color, dark);
      const a = luminance(result);
      for (const background of dark
        ? ['#1c2023', '#23282c', '#323a3e']
        : ['#ffffff', '#f7f8f9', '#ccd6d8']) {
        const b = luminance(background);
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
});
