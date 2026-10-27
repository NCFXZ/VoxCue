import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from './ui/button';
import { Loader, X } from './icons';

export function DownloadButton({
  label,
  progress,
  status,
  iconOnly = false,
  hoverLabel,
  className = '',
  onCancel,
}: {
  label: string;
  progress: number | null;
  status?: string;
  iconOnly?: boolean;
  hoverLabel?: string;
  className?: string;
  onCancel(): void;
}) {
  const [cancelReady, setCancelReady] = useState(false);
  const idle = useRef<HTMLSpanElement>(null),
    cancel = useRef<HTMLSpanElement>(null);
  const [widths, setWidths] = useState({ idle: 96, cancel: 88 });
  useLayoutEffect(() => {
    if (iconOnly) return;
    const measure = () => {
      const next = {
        idle: Math.max(80, Math.ceil((idle.current?.getBoundingClientRect().width ?? 56) + 32)),
        cancel: Math.max(80, Math.ceil((cancel.current?.getBoundingClientRect().width ?? 48) + 32)),
      };
      setWidths((old) => (old.idle === next.idle && old.cancel === next.cancel ? old : next));
    };
    const observer = new ResizeObserver(measure);
    if (idle.current) observer.observe(idle.current);
    if (cancel.current) observer.observe(cancel.current);
    measure();
    return () => observer.disconnect();
  }, [iconOnly]);
  useEffect(() => {
    // The pointer can still be over the original download button when it changes.
    const timer = setTimeout(() => setCancelReady(true), 1000);
    return () => clearTimeout(timer);
  }, []);
  const value =
    progress !== null && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, progress))
      : undefined;
  return (
    <Button
      variant="outline"
      size={iconOnly ? 'icon' : undefined}
      className={`download-button${iconOnly ? ' is-icon-only' : ''}${cancelReady ? ' is-cancellable' : ''} ${className}`}
      data-hover-label={hoverLabel}
      style={
        !iconOnly
          ? ({
              '--download-idle-width': `${widths.idle}px`,
              '--download-cancel-width': `${widths.cancel}px`,
            } as CSSProperties)
          : undefined
      }

      aria-label={cancelReady ? `${label}，取消下载` : `${label}下载中`}
      aria-disabled={!cancelReady}
      onClick={() => {
        if (cancelReady) onCancel();
      }}
    >
      <span ref={idle} className="download-button-progress">
        <span
          className={`download-ring${value === undefined ? ' is-indeterminate' : ''}`}
          role="progressbar"
          aria-label={`${label}下载进度`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={status}
        >
          {value === undefined && window.desktop?.platform === 'macos' ? (
            <Loader size={20} />
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle className="download-ring-track" cx="12" cy="12" r="9" />
              <circle
                className="download-ring-value"
                cx="12"
                cy="12"
                r="9"
                pathLength="100"
                strokeDasharray={value === undefined ? '25 75' : '100 100'}
                strokeDashoffset={value === undefined ? 0 : 100 - value}
              />
            </svg>
          )}
        </span>
        {!iconOnly && (
          <span aria-hidden="true">
            {status ?? (value === undefined ? '下载中' : `${Math.floor(value)}%`)}
          </span>
        )}
      </span>
      <span ref={cancel} className="download-button-cancel" aria-hidden="true">
        <X size={iconOnly ? 17 : 16} />
        {hoverLabel ? (
          <span className="download-button-cancel-label">{hoverLabel}</span>
        ) : (
          !iconOnly && '取消'
        )}
      </span>
    </Button>
  );
}
