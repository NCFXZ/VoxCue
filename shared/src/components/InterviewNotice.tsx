import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { Button } from './ui/button';
import { X } from './icons';
import { useDropdownSurfaceMotion } from './ui/useDropdownSurfaceMotion';

export function InterviewNotice({ noticeKey, container, title, description, role = 'alert', children }: {
  noticeKey: string | number | null;
  container?: HTMLElement | null;
  title: string;
  description?: string;
  role?: 'alert' | 'status';
  children: ReactNode;
}) {
  const [dismissed, setDismissed] = useState<typeof noticeKey>(null);
  const attach = useDropdownSurfaceMotion();
  useEffect(() => { setDismissed(null); }, [noticeKey]);
  if (container === null) return null;
  const card = noticeKey !== null && dismissed !== noticeKey ? (
    <div data-popup-positioner className="interview-notice-positioner">
      <div ref={attach} className="audio-recovery" role={role}>
        <div className="dropdown-scroll interview-notice-body">
          <div>
            <div className="interview-notice-heading">
              <strong>{title}</strong>
              <Button variant="ghost" size="icon" className="interview-notice-close"
                data-reveal-on-hover aria-label={t('关闭提示')} onClick={() => setDismissed(noticeKey)}>
                <X size={16} />
              </Button>
            </div>
            {description && <p>{description}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  ) : null;
  return container ? createPortal(card, container) : card;
}
