import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../scripts/workspace.mjs';

export async function assertSystemSymbol(button, key, name, size) {
  const svg = button.locator('svg');
  assert.equal(await svg.getAttribute('data-sf-symbol'), name);
  assert.equal(await svg.getAttribute('data-sf-icon'), key);
  const dimensions = await svg.evaluate((element, size) => {
    const style = getComputedStyle(element);
    const { width, height } = element.getBoundingClientRect();
    const pixels = (value) => Math.round(value * devicePixelRatio);
    return { css: [style.width, style.height], pixels: [pixels(width), pixels(height)], expected: pixels(size) };
  }, size);
  assert.deepEqual(dimensions.css, [`${size}px`, `${size}px`], key);
  assert.deepEqual(dimensions.pixels, [dimensions.expected, dimensions.expected], key);
  const source = await svg.locator('mask image').evaluate(image =>
    new URL(image.getAttribute('href'), document.baseURI).href);
  const bytes = source.startsWith('data:image/png;base64,')
    ? Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')
    : await readFile(new URL(source));
  const expected = await readFile(path.join(workspace.platformRoot, 'public/sf-symbols', key + '.png'));
  assert.deepEqual(bytes, expected, key + ' must display the image generated from AppKit');
}
