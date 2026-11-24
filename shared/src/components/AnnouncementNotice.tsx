import { useState } from 'react';
import { announcementText, type AnnouncementTarget } from '../../electron/contracts/announcements';
import { t, uiLocale } from '../i18n';
import { openChatLink } from '../services/chat';
import { useAnnouncements } from '../stores/announcements';
import { useUpdates } from '../stores/updates';
import { InterviewReveal } from './InterviewReveal';
import { ArrowUpRight, Download, FileText, ListSquare, Settings } from './icons';
import { DoNotShowAgainButton, NoticeCloseButton } from './NoticeActions';
import { Button } from './ui/button';

const buttonIcons = { 'external-link': ArrowUpRight, settings: Settings, document: FileText, list: ListSquare, download: Download };

export function AnnouncementNotice({ onNavigate }: { onNavigate(target: AnnouncementTarget): void }) {
  const notice = useAnnouncements(state => state.items[0]);
  const error = useAnnouncements(state => state.error);
  const dismiss = useAnnouncements(state => state.dismiss);
  const updateVisible = useUpdates(state => !!state.noticeVersion);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const visibleError = error || (notice && failure?.id === notice.id ? failure.message : null);
  const language = uiLocale();
  const icon = notice?.button?.icon ?? 'external-link';
  const Icon = icon === 'none' ? null : buttonIcons[icon];
  return (
    <InterviewReveal className="component-notice-reveal" resizeChild resizeKey={`${notice?.id}:${language}:${visibleError}`}>
      {notice && !updateVisible && (
        <aside className="components-notice announcement-notice" aria-label={t('公告')}>
          <div className="settings-notice-body">
            <div>
              <strong role="status">{announcementText(notice.title, language)}</strong>
              <p>{announcementText(notice.subtitle, language)}</p>
              {visibleError && <p role="alert">{t(visibleError)}</p>}
            </div>
            <div className="announcement-actions">
              {notice.button && (
                <Button variant="ghost" onClick={() => {
                  setFailure(null);
                  const action = notice.button!.action;
                  if (action.type === 'navigate') onNavigate(action.target);
                  else void openChatLink(announcementText(action.url, language)).catch(() =>
                    setFailure({ id: notice.id, message: '无法打开公告链接，请稍后重试。' }));
                }}>
                  {Icon && icon !== 'external-link' && <Icon size={16} />}
                  {announcementText(notice.button.label, language)}
                  {Icon && icon === 'external-link' && <Icon size={16} />}
                </Button>
              )}
              <DoNotShowAgainButton onClick={() => dismiss(notice.id, true)} />
              <NoticeCloseButton label={t('关闭公告')} onClick={() => dismiss(notice.id)} />
            </div>
          </div>
        </aside>
      )}
    </InterviewReveal>
  );
}
