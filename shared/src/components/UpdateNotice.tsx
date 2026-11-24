import { useState } from 'react';
import { t, uiLocale } from '../i18n';
import { openChatLink } from '../services/chat';
import { releaseNotesUrl } from '../services/updates';
import { useUpdates } from '../stores/updates';
import { InterviewReveal } from './InterviewReveal';
import { ListSquare } from './icons';
import { NoticeCloseButton } from './NoticeActions';
import { Button } from './ui/button';

export function UpdateNotice() {
  const version = useUpdates(state => state.noticeVersion);
  const noticeError = useUpdates(state => state.noticeError);
  const dismiss = useUpdates(state => state.dismissNotice);
  const [linkError, setLinkError] = useState<string | null>(null);
  const url = releaseNotesUrl(uiLocale());
  const error = noticeError || linkError;
  return (
    <InterviewReveal className="component-notice-reveal" resizeChild resizeKey={error || version || ''}>
      {version && (
        <aside className="components-notice" aria-label={t('更新完成')}>
          <div className="settings-notice-body">
            <div>
              <strong role="status">{t('已更新至 VoxCue {0}', [version])}</strong>
              {error && <p role="alert">{t(error)}</p>}
            </div>
            <Button variant="ghost" asChild>
              <a href={url} onClick={event => {
                event.preventDefault();
                setLinkError(null);
                void openChatLink(url).catch(() => setLinkError('无法打开更新日志，请稍后重试。'));
              }}><ListSquare size={16} />{t('查看更新日志')}</a>
            </Button>
            <NoticeCloseButton label={t('关闭提示')} onClick={dismiss} />
          </div>
        </aside>
      )}
    </InterviewReveal>
  );
}
