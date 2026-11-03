import { expect, it } from 'vitest';
import {
  interviewCanvas,
  fitInterviewBounds,
  draggedInterviewScale,
} from '../../../shared/electron/contracts/interviewLayout';

const area = { x: -1920, y: 0, width: 1920, height: 1080 };
const original = { x: -1500, y: 60, ...interviewCanvas() };
it('免费模式收起仅保留工具栏且不移动顶部或中心', () => {
  const folded = fitInterviewBounds(original, area, 1, true, true);
  expect(folded.height).toBe(72);
  expect(fitInterviewBounds(folded, area, 1, true, true)).toEqual(folded);
});
it('调整面板与隐藏转写保留固定控件空间，恢复工具栏中心和顶部位置', () => {
  for (const scale of [0.75, 0.9, 1, 1.3]) {
    const both = fitInterviewBounds(original, area, scale);
    const hidden = fitInterviewBounds(both, area, scale, false);
    expect(hidden.height).toBe(both.height);
    expect((hidden.width - 24) / 600).toBeCloseTo((both.width - 40) / 1020, 2);
    expect(Math.abs(hidden.x + hidden.width / 2 - both.x - both.width / 2)).toBeLessThanOrEqual(
      0.5,
    );
    expect(hidden.y).toBe(both.y);
    expect(fitInterviewBounds(hidden, area, scale)).toEqual(both);
  }
});
it('小屏幕保留面板比例和固定控件空间，不能超出工作区', () => {
  for (const visible of [true, false]) {
    const small = { x: 0, y: 0, width: 700, height: 450 };
    for (const scale of [0.01, 0.75, 1, 10]) {
      const bounds = fitInterviewBounds(original, small, scale, visible);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(small.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(small.height);
      expect((bounds.height - 182) / 500).toBeCloseTo(
        (bounds.width - (visible ? 40 : 24)) / (visible ? 1020 : 600),
        2,
      );
    }
  }
});
it('两侧边角跟随指针，工具栏中心和顶部固定，逆向回到原尺寸', () => {
  for (const visible of [true, false]) {
    const start = { x: -1400, y: 40, ...interviewCanvas(visible) };
    // Each bottom corner moves by half the total width change around the fixed toolbar.
    const dx = (visible ? 510 : 300) * 0.2,
      dy = 100;
    for (const edge of ['left', 'right'] as const) {
      const scale = draggedInterviewScale(1, edge === 'right' ? dx : -dx, dy, edge, visible);
      expect(scale).toBeCloseTo(1.2);
      const after = fitInterviewBounds(start, area, scale, visible);
      expect(after.y).toBe(start.y);
      expect(after.height - start.height).toBe(dy);
      expect(after.width - start.width).toBe(dx * 2);
      expect(after.x + after.width / 2).toBe(start.x + start.width / 2);
    }
    const right = draggedInterviewScale(1, 80, 60, 'right', visible);
    const left = draggedInterviewScale(1, -80, 60, 'left', visible);
    expect(right).toBe(left);
    expect(right).toBeGreaterThan(1);
    expect(draggedInterviewScale(right, -80, -60, 'right', visible)).toBeCloseTo(1);
    expect(draggedInterviewScale(1, 0, 100, 'right', visible)).toBeGreaterThan(1);
    expect(draggedInterviewScale(1, 0, 0, 'right', visible)).toBe(1);
  }
});
it('靠近屏幕边缘时限制扩展，不移动工具栏来腾出空间', () => {
  const start = { x: -1900, y: 500, ...interviewCanvas(true, false, 0.75) };
  const after = fitInterviewBounds(start, area, 10);
  expect(after.y).toBe(start.y);
  expect(after.x + after.width / 2).toBe(start.x + start.width / 2);
  expect(after.x).toBeGreaterThanOrEqual(area.x);
  expect(after.y + after.height).toBeLessThanOrEqual(area.y + area.height);
  expect(after.x + after.width).toBeLessThanOrEqual(area.x + area.width);
});
