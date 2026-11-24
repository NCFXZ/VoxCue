import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useHeightTransition } from './useHeightTransition';
import './content-reveal.css';

function ResizingContent({ children, resizeKey, resizeChild }: {
  children: ReactElement; resizeKey: string; resizeChild?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  useHeightTransition(resizeKey, () => [
    resizeChild ? content.current?.firstElementChild as HTMLElement | null : content.current,
  ]);
  return <div ref={content} className="reveal-content">{children}</div>;
}

/** Keep the last contents inert until their space and opacity finish transitioning. */
export function ContentReveal({ children, className, resizeKey, resizeChild }: {
  children: ReactElement | null | undefined | false | '';
  className?: string;
  resizeKey?: string;
  resizeChild?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [retained, setRetained] = useState(children);
  if (children && children !== retained) setRetained(children);
  const open = Boolean(children);
  useLayoutEffect(() => {
    if (open || !retained || !frame.current) return;
    let current = true;
    const transitions = frame.current.getAnimations();
    void Promise.allSettled(transitions.map(animation => animation.finished)).then(() => {
      if (current) setRetained(null);
    });
    return () => { current = false; };
  }, [open, retained]);
  const content = children || retained;
  if (!content) return null;
  return (
    <div
      ref={frame}
      className={className ? `interview-reveal ${className}` : 'interview-reveal'}
      data-open={open}
      inert={!open}
      aria-hidden={!open || undefined}
    >
      <div className="interview-reveal-clip">
        {resizeKey === undefined ? content : <ResizingContent resizeKey={resizeKey} resizeChild={resizeChild}>{content}</ResizingContent>}
      </div>
    </div>
  );
}
