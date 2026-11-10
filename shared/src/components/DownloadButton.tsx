import { t } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Loader, X } from './icons';

export function DownloadButton({
  label,
  progress,
  status,
  iconOnly = false,
  hoverLabel,
  cancelDelayMs = 1000,
  className = '',
  onCancel,
}: {
  label: string;
  progress: number | null;
  status?: string;
  iconOnly?: boolean;
  hoverLabel?: string;
  cancelDelayMs?: number;
  className?: string;
  onCancel(): void;
}) {
  const [cancelReady, setCancelReady] = useState(false);
  const control = useRef<HTMLButtonElement>(null);
  const idle = useRef<HTMLSpanElement>(null),
    cancel = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (iconOnly) return;
    let initial = true;
    const measure = () => {
      const element = control.current;
      if (!element) return;
      const next = {
        idle: Math.max(80, Math.ceil((idle.current?.getBoundingClientRect().width ?? 56) + 32)),
        cancel: Math.max(80, Math.ceil((cancel.current?.getBoundingClientRect().width ?? 48) + 32)),
      };
      if (
        element.style.getPropertyValue('--download-idle-width') === `${next.idle}px` &&
        element.style.getPropertyValue('--download-cancel-width') === `${next.cancel}px`
      )
        return;
      // The parent ActionTransition must measure the final width on this commit.
      // A deferred state update would animate the fallback width and then retarget it.
      const transition = element.style.transition;
      if (initial) element.style.transition = 'none';
      element.style.setProperty('--download-idle-width', `${next.idle}px`);
      element.style.setProperty('--download-cancel-width', `${next.cancel}px`);
      if (initial) {
        element.getBoundingClientRect();
        element.style.transition = transition;
        initial = false;
      }
    };
    const observer = new ResizeObserver(measure);
    if (idle.current) observer.observe(idle.current);
    if (cancel.current) observer.observe(cancel.current);
    measure();
    return () => observer.disconnect();
  }, [iconOnly]);
  useEffect(() => {
    // The pointer can still be over the original download button when it changes.
    const timer = setTimeout(() => setCancelReady(true), cancelDelayMs);
    return () => clearTimeout(timer);
  }, [cancelDelayMs]);
  const value =
    progress !== null && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, progress))
      : undefined;
  return (
    <Button
      ref={control}
      variant="outline"
      size={iconOnly ? 'icon' : undefined}
      className={`download-button${iconOnly ? ' is-icon-only' : ''}${cancelReady ? ' is-cancellable' : ''} ${className}`}
      data-hover-label={hoverLabel}
      aria-label={cancelReady ? t('{0}，取消下载', [t(label)]) : t('{0}下载中', [t(label)])}
      aria-disabled={!cancelReady}
      onClick={() => {
        if (cancelReady) onCancel();
      }}
    >
      <span ref={idle} className="download-button-progress">
        <span
          className={`download-ring${value === undefined ? ' is-indeterminate' : ''}`}
          role="progressbar"
          aria-label={t(`${label}下载进度`)}
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
            {t(status) || (value === undefined ? t('下载中') : `${Math.floor(value)}%`)}
          </span>
        )}
      </span>
      <span ref={cancel} className="download-button-cancel" aria-hidden="true">
        <X size={iconOnly ? 17 : 16} />
        {hoverLabel ? (
          <span className="download-button-cancel-label">{t(hoverLabel)}</span>
        ) : (
          !iconOnly && t('取消')
        )}
      </span>
    </Button>
  );
}
