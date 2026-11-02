import { t } from '../i18n';
import { useUpdates } from '../stores/updates';
import { useState } from 'react';
import githubLogo from '../assets/github.svg?inline';
import { openChatLink } from '../services/chat';
import { Button } from './ui/button';
import { Download, Loader, Update } from './icons';
import { DownloadButton } from './DownloadButton';
import { ActionTransition } from './ActionTransition';

export function UpdatesPanel({ showVersion = true }: { showVersion?: boolean } = {}) {
  const updates = useUpdates();
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const feedbackUrl = 'https://github.com/NCFXZ/VoxCue-releases/issues/new';
  const state = updates.state;
  const busy = !state || ['checking', 'downloading', 'installing'].includes(state.phase);
  const downloaded = state?.phase === 'downloaded';
  const available =
    state?.phase === 'available' || (state?.phase === 'error' && !!state.availableVersion);
  const label = !state
    ? '正在读取更新状态…'
    : state.phase === 'unavailable'
      ? state.message === '开发版本不检查线上更新，请使用 VoxCue 安装版。'
        ? null
        : state.message
      : state.phase === 'checking'
        ? '正在检查更新…'
        : state.phase === 'downloading'
          ? `正在下载更新 ${Math.floor(state.progress ?? 0)}%`
          : state.phase === 'downloaded'
            ? `版本 ${state.availableVersion} 已下载，可以重启安装。`
            : state.phase === 'installing'
              ? '正在保存聊天并准备更新…'
              : available
                ? `发现新版本 ${state.availableVersion}`
                : state.lastCheckedAt && state.phase === 'idle'
                  ? '当前已是最新版本。'
                  : state.autoDownload
                    ? '启动后自动检查并下载新版本。'
                    : '启动后自动检查新版本，由你选择下载。';
  return (
    <>
      {showVersion && (
        <div className="settings-entry">
          <strong>{t('当前版本')}</strong>
          <span className="settings-value">{state?.currentVersion ?? '—'}</span>
        </div>
      )}
      <div className="settings-entry">
        <div>
          <strong id="auto-download-label">{t('自动下载更新')}</strong>
        </div>
        <button
          type="button"
          role="switch"
          className="settings-switch"

          aria-labelledby="auto-download-label"
          aria-checked={state?.autoDownload ?? false}
          disabled={!state || state.phase === 'installing'}
          onClick={() =>
            state && void updates.run({ op: 'set-auto-download', enabled: !state.autoDownload })
          }
        >
          <span />
        </button>
      </div>
      <div className="settings-entry">
        <strong>{t('软件更新')}</strong>
        <ActionTransition>
          {state?.phase === 'downloading' ? (
            <DownloadButton
              label={t('更新')}
              progress={state.progress}
              onCancel={() => void updates.run('cancel')}
            />
          ) : (
            <Button
              variant="outline"
              disabled={
                busy || state?.phase === 'unavailable' || (downloaded && state.interviewActive)
              }
              onClick={() =>
                void updates.run(downloaded ? 'install' : available ? 'download' : 'check')
              }
            >
              {busy ? (
                <span className="update-spinner" aria-hidden="true">
                  <Loader size={16} />
                </span>
              ) : available ? (
                <Download size={16} />
              ) : (
                <Update size={16} />
              )}
              {state?.phase === 'checking'
                ? t('检查中…')
                : state?.phase === 'installing'
                  ? t('准备更新…')
                  : downloaded
                    ? t('重启并更新')
                    : available
                      ? t('下载更新')
                      : t('检查更新')}
            </Button>
          )}
        </ActionTransition>
      </div>
      <div className="updates-footer settings-hint">
        <div className="updates-notes">
          {label && (
            <p role="status" aria-live="polite">
              {t(label)}
            </p>
          )}
          <p>{t('更新会保留本机聊天、附件、个人资料和面试记录。')}</p>
        </div>
        <a
          className="updates-feedback"
          href={feedbackUrl}
          onClick={(event) => {
            event.preventDefault();
            setFeedbackError(null);
            void openChatLink(feedbackUrl).catch(() =>
              setFeedbackError('无法打开反馈页面，请稍后重试。'),
            );
          }}
        >
          <img className="service-brand-icon" src={githubLogo} alt="" aria-hidden="true" />
          {t('问题反馈')}
        </a>
      </div>
      {feedbackError && (
        <p className="inline-error" role="alert">
          {t(feedbackError)}
        </p>
      )}
      {(updates.error || state?.error) && (
        <p className="inline-error" role="alert">
          {t(updates.error || state?.error)}
        </p>
      )}
      {state?.interviewActive && (
        <p className="settings-hint">{t('面试进行中，可以检查和下载更新，请结束面试后再安装。')}</p>
      )}
    </>
  );
}
