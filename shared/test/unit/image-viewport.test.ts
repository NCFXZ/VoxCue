import { expect, it } from 'vitest';
import {
  boundImage,
  fittedImage,
  initialImageTransform,
  zoomImage,
} from '../../src/services/imageViewport';

it('长图/宽图适应窗口，指针处缩放保持对应图像点', () => {
  expect(fittedImage({ width: 1200, height: 2400 }, { width: 800, height: 600 })).toEqual({
    width: 300,
    height: 600,
  });
  const viewport = { width: 800, height: 600 };
  const image = fittedImage({ width: 1600, height: 1200 }, viewport);
  const zoomed = zoomImage(initialImageTransform, 2, { x: 100, y: -80 }, image, viewport);
  expect(zoomed).toEqual({ scale: 2, x: -100, y: 80 });
  expect((100 - zoomed.x) / zoomed.scale).toBe(100);
  expect((-80 - zoomed.y) / zoomed.scale).toBe(-80);
});

it('拖拽不移出图片边缘，缩小或窗口变大后重新限制偏移', () => {
  const viewport = { width: 800, height: 600 };
  const image = { width: 800, height: 600 };
  expect(boundImage({ scale: 2, x: 1000, y: -1000 }, image, viewport)).toEqual({
    scale: 2,
    x: 400,
    y: -300,
  });
  expect(zoomImage({ scale: 2, x: 400, y: -300 }, 0.01, { x: 0, y: 0 }, image, viewport)).toEqual(
    initialImageTransform,
  );
  expect(boundImage({ scale: 30, x: 0, y: 0 }, image, viewport).scale).toBe(8);
  expect(boundImage({ scale: 1, x: 20, y: 20 }, { width: 200, height: 600 }, viewport)).toEqual(
    initialImageTransform,
  );
});
