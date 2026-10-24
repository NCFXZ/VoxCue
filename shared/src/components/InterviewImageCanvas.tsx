import { useEffect, useRef, useState } from 'react';
import {
  boundImage,
  fittedImage,
  initialImageTransform,
  zoomImage,
  type ImageSize,
  type ImageTransform,
} from '../services/imageViewport';

export function InterviewImageCanvas({
  src,
  alt,
  onError,
}: {
  src: string;
  alt: string;
  onError(): void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const transform = useRef<ImageTransform>(initialImageTransform);
  const geometry = useRef({ image: { width: 0, height: 0 }, viewport: { width: 0, height: 0 } });
  const measure = useRef<() => void>(() => {});
  const drag = useRef<{ id: number; x: number; y: number; view: ImageTransform } | null>(null);
  const [view, setView] = useState(initialImageTransform);
  const [size, setSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const apply = (next: ImageTransform) => {
    transform.current = next;
    setView(next);
  };
  useEffect(() => {
    const element = canvas.current!;
    measure.current = () => {
      const viewport = { width: element.clientWidth, height: element.clientHeight };
      const fitted = fittedImage(
        { width: image.current?.naturalWidth ?? 0, height: image.current?.naturalHeight ?? 0 },
        viewport,
      );
      geometry.current = { image: fitted, viewport };
      setSize(fitted);
      apply(boundImage(transform.current, fitted, viewport));
    };
    const resize = new ResizeObserver(measure.current);
    resize.observe(element);
    measure.current();
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const deltaX = event.deltaX * unit;
      const deltaY = event.deltaY * unit;
      // Chromium reports trackpad pinch as ctrl+wheel. Ordinary pixel scroll
      // (including two-finger momentum) pans; line/page wheels retain zoom.
      if (event.ctrlKey || event.deltaMode !== 0) {
        const delta = deltaY || deltaX;
        if (!delta) return;
        const rect = element.getBoundingClientRect();
        apply(
          zoomImage(
            transform.current,
            Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0025)),
            {
              x: event.clientX - rect.left - rect.width / 2,
              y: event.clientY - rect.top - rect.height / 2,
            },
            geometry.current.image,
            geometry.current.viewport,
          ),
        );
      } else {
        apply(
          boundImage(
            {
              ...transform.current,
              x: transform.current.x - deltaX,
              y: transform.current.y - deltaY,
            },
            geometry.current.image,
            geometry.current.viewport,
          ),
        );
      }
      drag.current = null;
      setDragging(false);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      resize.disconnect();
      element.removeEventListener('wheel', wheel);
      drag.current = null;
    };
  }, [src]);
  return (
    <div
      ref={canvas}
      className="interview-image-canvas"
      tabIndex={0}
      aria-label="截图，两指滑动平移，捏合或 Ctrl 加滚轮缩放，鼠标拖拽，双击复位"
      data-zoomed={view.scale > 1 ? '' : undefined}
      data-dragging={dragging ? '' : undefined}
      onDoubleClick={() => apply(initialImageTransform)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.focus({ preventScroll: true });
        if (transform.current.scale <= 1) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          view: transform.current,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        apply(
          boundImage(
            {
              ...start.view,
              x: start.view.x + event.clientX - start.x,
              y: start.view.y + event.clientY - start.y,
            },
            geometry.current.image,
            geometry.current.viewport,
          ),
        );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <div
        className="interview-image-picture"
        style={{ width: size.width || '100%', height: size.height || '100%' }}
      >
        <img
          ref={image}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => measure.current()}
          onError={onError}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
    </div>
  );
}
