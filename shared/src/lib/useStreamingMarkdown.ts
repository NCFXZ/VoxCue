import { useLayoutEffect, useRef, useState } from 'react';

// Give input and scrolling time between expensive Markdown commits. The source
// remains current in the store, and replacements and final text display immediately.
export function useStreamingMarkdown(content: string, streaming: boolean) {
  const [shown, setShown] = useState(content);
  const nextRender = useRef(0);
  const visible = streaming && shown && content.startsWith(shown) ? shown : content;
  const started = performance.now();

  useLayoutEffect(() => {
    const finished = performance.now();
    nextRender.current = finished + Math.min(250, 3 * (finished - started));
  }, [visible, streaming]);

  useLayoutEffect(() => {
    if (shown === content) return;
    const wait = nextRender.current - performance.now();
    if (visible === content || wait <= 0) {
      setShown(content);
      return;
    }
    const timer = window.setTimeout(() => setShown(content), wait);
    return () => window.clearTimeout(timer);
  }, [content, shown, visible]);

  return visible;
}
