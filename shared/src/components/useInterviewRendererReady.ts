import { useLayoutEffect, type RefObject } from 'react';

// Native visibility waits for this surface's authoritative content to commit.
// Layout is read after that commit; inference and audio startup are independent.
export function useInterviewRendererReady(
  rendererRevision: number | undefined,
  surface: RefObject<HTMLElement | null>,
  onError: (message: string) => void,
) {
  useLayoutEffect(() => {
    if (
      typeof rendererRevision !== 'number' ||
      !Number.isSafeInteger(rendererRevision) ||
      rendererRevision < 1
    )
      return;
    let active = true;
    const frame = requestAnimationFrame(() => {
      if (!active) return;
      const bounds = surface.current?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return;
      void window.desktop?.interviewRendererReady(rendererRevision).catch(() => {
        if (active) onError('窗口切换失败，请重试。');
      });
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [rendererRevision, surface, onError]);
}
