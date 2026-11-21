import { t } from '../../i18n';
import { useLayoutEffect, useRef, type ReactNode, type KeyboardEventHandler, type Ref } from 'react';
import { headerCoverage } from '../../platform/chromeGeometry';
import { X, Trash } from '../icons';
import { Button } from './button';
import { captureModalExit, clearModalExit } from './modal-motion';
import { cancelViewSwitch } from './switchView';
import './modal-motion.css';
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
  fixedHeader = true,
  overlayHeader = false,
  onKeyDown,
  footer,
  contentRef,
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
  contentRef?: Ref<HTMLDivElement>;
  backdrop?: 'viewport' | 'transparent';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    cancelViewSwitch();
    clearModalExit();
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      cancelViewSwitch(dialog);
      const exit = captureModalExit(dialog);
      dialog.close();
      exit?.();
      requestAnimationFrame(() => {
        const active = document.activeElement;
        const nextModal = [...document.querySelectorAll('dialog[open]')].find((node) =>
          node.matches(':modal'),
        );
        if (
          previousFocus?.isConnected &&
          (!nextModal || nextModal.contains(previousFocus)) &&
          (!active || active === document.body || active === dialog || !active.isConnected)
        )
          previousFocus.focus({ preventScroll: true });
      });
    };
  }, []);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const heading = dialog.querySelector<HTMLElement>(':scope > .dialog-heading');
    const scroll = dialog.querySelector<HTMLElement>(':scope > .dialog-scroll')!;
    let frame = 0;
    const update = () => {
      frame = 0;
      const overflow = getComputedStyle(scroll).overflowY;
      dialog.toggleAttribute(
        'data-scrollable',
        /^(auto|scroll)$/.test(overflow) && scroll.scrollHeight > scroll.clientHeight,
      );
      const gutter = `${Math.max(0, scroll.offsetWidth - scroll.clientWidth)}px`;
      if (dialog.style.getPropertyValue('--dialog-scrollbar-width') !== gutter)
        dialog.style.setProperty('--dialog-scrollbar-width', gutter);
      if (!overlayHeader || !heading) return;
      const rect = heading.getBoundingClientRect();
      // At fractional scale the first row and header can meet a fraction of a
      // device pixel apart. The material starts only after the content scrolls.
      const opacity = scroll.scrollTop > 0 ? headerCoverage(scroll, rect, ':scope > *') : 0;
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
    const observe = () => {
      resize.disconnect();
      if (heading) resize.observe(heading);
      resize.observe(scroll);
      for (const child of scroll.children) resize.observe(child);
    };
    const changes = new MutationObserver(() => {
      observe();
      schedule();
    });
    changes.observe(scroll, { childList: true, characterData: true, subtree: true });
    observe();
    scroll.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      scroll.removeEventListener('scroll', schedule);
    };
  }, [overlayHeader, hideHeader]);
  const heading = !hideHeader && (
    <header className="dialog-heading">
      <div className="dialog-title">
        {destructive && (
          <span className="danger-icon">
            <Trash size={20} />
          </span>
        )}
        <div>
          <div className="dialog-title-line">
            <h2>{title}</h2>
            {titleAction}
          </div>
          {subtitle && <p className="dialog-subtitle">{t(subtitle)}</p>}
        </div>
        {icon && !destructive && <span className="dialog-icon">{icon}</span>}
      </div>
      <div className="dialog-actions">
        {action}
        <Button
          variant="ghost"
          size="icon"
          className="dialog-close-button"
          data-autofocus={initialFocus === 'close' ? '' : undefined}
          aria-label={t(closeLabel)}
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
        event.stopPropagation();
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
      <div className="dialog-scroll" ref={contentRef}>
        {!fixedHeader && heading}
        {children}
      </div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
