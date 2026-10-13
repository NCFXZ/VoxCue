import { useEffect, useRef, type ReactNode } from 'react';
import { X, Trash } from '../icons';
import { Button } from './button';
export function Modal({
  title,
  onClose,
  children,
  action,
  wide = false,
  destructive = false,
  icon,
  subtitle,
  className = '',
  closeLabel = '关闭对话框',
  hideHeader = false,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  action?: ReactNode;
  wide?: boolean;
  destructive?: boolean;
  icon?: ReactNode;
  subtitle?: string;
  className?: string;
  closeLabel?: string;
  hideHeader?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`app-dialog ${wide ? 'wide' : ''} ${destructive ? 'destructive-dialog' : ''} ${className}`}
      aria-label={title}
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
          )
            onClose();
        }
      }}
    >
      {!hideHeader && (
        <header className="dialog-heading">
          <div className="dialog-title">
            {destructive && (
              <span className="danger-icon">
                <Trash size={20} />
              </span>
            )}
            {icon && !destructive && <span className="dialog-icon">{icon}</span>}
            <div>
              <h2>{title}</h2>
              {subtitle && <p className="dialog-subtitle">{subtitle}</p>}
            </div>
          </div>
          <div>
            {action}
            <Button variant="ghost" size="icon" aria-label={closeLabel} onClick={onClose}>
              <X size={17} />
            </Button>
          </div>
        </header>
      )}
      {children}
    </dialog>
  );
}
