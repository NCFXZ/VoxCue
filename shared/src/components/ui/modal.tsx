import { useEffect, useRef, type ReactNode, type KeyboardEventHandler } from 'react';
import { headerCoverage } from '../../platform/chromeGeometry';
import { X, Trash } from '../icons';
import { Button } from './button';
export function Modal({
  title,
  onClose,
  children,
  action,
  titleAction,
  wide = false,
  destructive = false,
  icon,
  subtitle,
  className = '',
  closeLabel = '关闭对话框',
  initialFocus,
  hideHeader = false,
  fixedHeader = false,
  overlayHeader = false,
  onKeyDown,
  footer,
  backdrop = 'viewport',
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  action?: ReactNode;
  titleAction?: ReactNode;
  wide?: boolean;
  destructive?: boolean;
  icon?: ReactNode;
  subtitle?: string;
  className?: string;
  closeLabel?: string;
  initialFocus?: 'close';
  hideHeader?: boolean;
  fixedHeader?: boolean;
  overlayHeader?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>;
  footer?: ReactNode;
  backdrop?: 'viewport' | 'transparent';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      dialog.close();
      requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      });
    };
  }, []);
  useEffect(() => {
    if (!overlayHeader) return;
    const dialog = ref.current!;
    const heading = dialog.querySelector<HTMLElement>(':scope > .dialog-heading')!;
    const scroll = dialog.querySelector<HTMLElement>(':scope > .dialog-scroll')!;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = heading.getBoundingClientRect();
      dialog.style.setProperty(
        '--dialog-scrollbar-width',
        `${Math.max(0, scroll.offsetWidth - scroll.clientWidth)}px`,
      );
      const opacity = headerCoverage(dialog, rect, '.dialog-scroll > *');
      for (const [name, value] of [
        ['--dialog-header-height', rect.height + 'px'],
        ['--dialog-header-opacity', String(opacity)],
      ])
        if (dialog.style.getPropertyValue(name) !== value) dialog.style.setProperty(name, value);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(heading);
    resize.observe(scroll);
    scroll.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      scroll.removeEventListener('scroll', schedule);
    };
  }, [overlayHeader]);
  const heading = !hideHeader && (
    <header className="dialog-heading">
      <div className="dialog-title">
        {destructive && (
          <span className="danger-icon">
            <Trash size={20} />
          </span>
        )}
        {icon && !destructive && <span className="dialog-icon">{icon}</span>}
        <div>
          <div className="dialog-title-line">
            <h2>{title}</h2>
            {titleAction}
          </div>
          {subtitle && <p className="dialog-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div>
        {action}
        <Button
          variant="ghost"
          size="icon"
          className="dialog-close-button"
          data-autofocus={initialFocus === 'close' ? '' : undefined}

          aria-label={closeLabel}
          onClick={onClose}
        >
          <X size={17} />
        </Button>
      </div>
    </header>
  );
  return (
    <dialog
      ref={ref}
      className={`app-dialog ${wide ? 'wide' : ''} ${destructive ? 'destructive-dialog' : ''} ${className}`}
      aria-label={title}
      data-backdrop={backdrop}
      data-fixed-header={fixedHeader ? '' : undefined}
      data-overlay-header={overlayHeader ? '' : undefined}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          ) {
            // Consume the dismissing click; it must not activate a control
            // beneath the native dialog or reach a different application.
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }
      }}
    >
      {fixedHeader && heading}
      <div className="dialog-scroll">
        {!fixedHeader && heading}
        {children}
      </div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
