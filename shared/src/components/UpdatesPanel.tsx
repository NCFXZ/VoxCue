import { InterviewReveal } from './InterviewReveal';
import { useHeightTransition } from './ui/useHeightTransition';
import { t, uiLocale } from '../i18n';
import { useUpdates } from '../stores/updates';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import githubLogo from '../assets/github.svg?inline';
import { openChatLink } from '../services/chat';
import { Button } from './ui/button';
import { Download, Loader, Update } from './icons';
import { DownloadButton } from './DownloadButton';
import { ActionTransition } from './ActionTransition';
import { storeUpdateMessage } from '../../electron/contracts/updates';
import { version } from '../../package.json';
import { releaseNotesUrl } from '../services/updates';

export function UpdatesPanel({ showVersion = true }: { showVersion?: boolean } = {}) {
  const updates = useUpdates();
  const [linkError, setLinkError] = useState<string | null>(null);
  const repositoryUrl = 'https://github.com/NCFXZ/VoxCue';
  const changelogUrl = releaseNotesUrl(uiLocale());
  const licenseLinks = [
    {
      label: 'AGPL-3.0-only',
      url: `${repositoryUrl}/blob/main/LICENSE`,
      error: '无法打开开源协议，请稍后重试。',
    },
    {
      label: '第三方许可',
      url: `${repositoryUrl}/blob/main/THIRD_PARTY_NOTICES.md`,
      error: '无法打开第三方许可，请稍后重试。',
    },
  ];
  function openLink(event: MouseEvent<HTMLAnchorElement>, url: string, error: string) {
    event.preventDefault();
    setLinkError(null);
    void openChatLink(url).catch(() => setLinkError(error));
  }
  const state = updates.state;
  const storeManaged = state?.phase === 'unavailable' && state.message === storeUpdateMessage;
  const busy = !state || ['checking', 'downloading', 'installing'].includes(state.phase);
  const downloaded = state?.phase === 'downloaded';
  const available =
    state?.phase === 'available' || (state?.phase === 'error' && !!state.availableVersion);
  const canCheck = !busy && state?.phase !== 'unavailable' && !downloaded && !available;
  const canCheckNow = useRef(canCheck);
  canCheckNow.current = canCheck;
  const hold = useRef<{ timer?: number; keyboard: boolean; forced: boolean }>({
    keyboard: false,
    forced: false,
  });
  function cancelHold() {
    window.clearTimeout(hold.current.timer);
    hold.current.timer = undefined;
    hold.current.keyboard = false;
  }
  function startHold(keyboard: boolean) {
    cancelHold();
    hold.current.keyboard = keyboard;
    hold.current.forced = false;
    hold.current.timer = window.setTimeout(() => {
      hold.current.timer = undefined;
      if (canCheckNow.current) {
        hold.current.forced = true;
        void updates.run({ op: 'check', force: true });
      }
    }, 5000);
  }
  useEffect(() => {
    if (!canCheck) cancelHold();
  }, [canCheck]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) cancelHold();
    };
    window.addEventListener('blur', cancelHold);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelHold();
      window.removeEventListener('blur', cancelHold);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
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
  const notes = useRef<HTMLDivElement>(null);
  useHeightTransition(state?.phase === 'downloading' ? 'downloading' : label, () => [notes.current]);
  return (
    <>
      {showVersion && (
        <div className="settings-entry">
          <strong>VoxCue</strong>
          <div className="settings-value">
            <span>{version}</span>
            <span aria-hidden="true">·</span>
            <a className="updates-license-link" href={changelogUrl}
              onClick={(event) => openLink(event, changelogUrl, '无法打开更新日志，请稍后重试。')}>
              {t('更新日志')}
            </a>
          </div>
        </div>
      )}
      <div className="settings-entry">
        <strong>{t('开源协议')}</strong>
        <div className="updates-license-links">
          {licenseLinks.map(({ label, url, error }) => (
            <a
              key={url}
              className="updates-license-link"
              href={url}
              onClick={(event) => openLink(event, url, error)}
            >
              {t(label)}
            </a>
          ))}
        </div>
      </div>
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
          disabled={!state || state.phase === 'installing' || storeManaged}
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
              onPointerDown={(event) => {
                if (event.button === 0 && canCheck) startHold(false);
              }}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              onBlur={cancelHold}
              onKeyDown={(event) => {
                if (canCheck && (event.key === ' ' || event.key === 'Enter')) {
                  event.preventDefault();
                  if (!event.repeat) startHold(true);
                }
              }}
              onKeyUp={(event) => {
                if (event.key !== ' ' && event.key !== 'Enter') return;
                const { keyboard, forced } = hold.current;
                if (keyboard || forced) event.preventDefault();
                cancelHold();
                if (forced) hold.current.forced = false;
                else if (keyboard && canCheck) void updates.run('check');
              }}
              onClick={(event) => {
                if (hold.current.forced) {
                  event.preventDefault();
                  hold.current.forced = false;
                  return;
                }
                void updates.run(downloaded ? 'install' : available ? 'download' : 'check');
              }}
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
        <div ref={notes} className="updates-notes">
          {label && <p role="status" aria-live="polite">{t(label)}</p>}
          <p>{t('更新会保留本机聊天、附件、个人资料和面试记录。')}</p>
        </div>
        <a
          className="updates-feedback"
          href={repositoryUrl}
          onClick={(event) =>
            openLink(event, repositoryUrl, '无法打开 GitHub 仓库，请稍后重试。')
          }
        >
          <img className="service-brand-icon" src={githubLogo} alt="" aria-hidden="true" />
          {t('GitHub 仓库')}
        </a>
      </div>
      <InterviewReveal>
        {linkError ? (
          <p className="inline-error" role="alert">
            {t(linkError)}
          </p>
        ) : null}
      </InterviewReveal>
      <InterviewReveal>
        {(updates.error || state?.error) ? (
          <p className="inline-error" role="alert">
            {t(updates.error || state?.error)}
          </p>
        ) : null}
      </InterviewReveal>
      <InterviewReveal>
        {state?.interviewActive ? (
          <p className="settings-hint">{t('面试进行中，可以检查和下载更新，请结束面试后再安装。')}</p>
        ) : null}
      </InterviewReveal>
    </>
  );
}
