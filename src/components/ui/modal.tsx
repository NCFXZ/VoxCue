import { useEffect, useRef, type ReactNode } from 'react';
import { X } from '../icons';
import { Button } from './button';
export function Modal({
  title,
  onClose,
  children,
  action,
  wide = false,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  action?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`app-dialog ${wide ? 'wide' : ''}`}
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
      <header className="dialog-heading">
        <h2>{title}</h2>
        <div>
          {action}
          <Button variant="ghost" size="icon" aria-label="关闭对话框" onClick={onClose}>
            <X size={17} />
          </Button>
        </div>
      </header>
      {children}
    </dialog>
  );
}
