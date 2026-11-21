import { createContext, useContext, type ReactNode, type RefCallback } from 'react';
import { t } from '../i18n';
import { ArrowUpRight, X } from './icons';
import { Button } from './ui/button';
import { useDropdownSurfaceMotion } from './ui/useDropdownSurfaceMotion';
import { InterviewReveal } from './InterviewReveal';

const NoticeMotion = createContext<RefCallback<HTMLElement> | null>(null);

export function HomeNoticeSlot({ children }: { children: ReactNode }) {
  const attach = useDropdownSurfaceMotion();
  return (
    <NoticeMotion.Provider value={attach}>
      <div className="chat-notice-slot">{children}</div>
    </NoticeMotion.Provider>
  );
}

export function SettingsNotice({
  label,
  title,
  detail,
  onSettings,
  onDismiss,
  visible = true,
}: {
  label: string;
  title: string;
  detail: string;
  onSettings(): void;
  onDismiss?(): void;
  visible?: boolean;
}) {
  const motion = useContext(NoticeMotion);
  const body = (
    <div className={motion ? 'settings-notice-body dropdown-scroll' : 'settings-notice-body'}>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <Button variant="ghost" onClick={onSettings}>
        {t('前往设置 ')}
        <ArrowUpRight size={14} />
      </Button>
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon"
          data-reveal-on-hover
          aria-label={t('不再提醒本地资料迁移')}
          onClick={onDismiss}
        >
          <X size={14} />
        </Button>
      )}
    </div>
  );
  const notice = visible ? (
    <aside ref={motion} className="components-notice" aria-label={label}>
      {body}
    </aside>
  ) : null;
  return motion ? (
    notice && <div data-popup-positioner className="chat-notice-positioner">{notice}</div>
  ) : (
    <InterviewReveal className="component-notice-reveal">{notice}</InterviewReveal>
  );
}
