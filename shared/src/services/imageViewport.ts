export interface ImageSize {
  width: number;
  height: number;
}
export interface ImageTransform {
  scale: number;
  x: number;
  y: number;
}
export const initialImageTransform: ImageTransform = { scale: 1, x: 0, y: 0 };

export function fittedImage(image: ImageSize, viewport: ImageSize): ImageSize {
  if (image.width <= 0 || image.height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

export function boundImage(
  view: ImageTransform,
  image: ImageSize,
  viewport: ImageSize,
): ImageTransform {
  const scale = Math.min(8, Math.max(1, view.scale));
  const x = Math.max(0, (image.width * scale - viewport.width) / 2);
  const y = Math.max(0, (image.height * scale - viewport.height) / 2);
  return {
    scale,
    x: Math.max(-x, Math.min(x, view.x)) || 0,
    y: Math.max(-y, Math.min(y, view.y)) || 0,
  };
}

/** Zoom about the pointer rather than pulling its image point toward the center. */
export function zoomImage(
  view: ImageTransform,
  factor: number,
  point: { x: number; y: number },
  image: ImageSize,
  viewport: ImageSize,
): ImageTransform {
  const scale = Math.min(8, Math.max(1, view.scale * factor));
  const ratio = scale / view.scale;
  return boundImage(
    { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio },
    image,
    viewport,
  );
}
