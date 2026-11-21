import { InterviewReveal } from './InterviewReveal';
import type { ReactNode } from 'react';
import type { AudioSource, InterviewAccessReport } from '../../electron/contracts/speech';
import { t } from '../i18n';
import { AudioPreviewIcon } from './InterviewAudioPreview';
import { RemoteConnectionStatus } from './RemoteConnection';
import { ShortcutAvailabilityStatus } from './ShortcutSettings';
import { Check, Monitor, X } from './icons';

const audioLabels = {
  granted: '可用',
  denied: '未授权',
  unavailable: '设备不可用',
  error: '检查失败',
};
const screenLabels = {
  granted: '可用',
  'not-required': '无需单独授权',
  'not-determined': '未授权',
  denied: '未授权',
  restricted: '受限制',
  unknown: '待确认',
  error: '检查失败',
};

export function AccessSkeleton({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <span className={`interview-access-skeleton-slot ${className}`} aria-hidden="true">
      <span className="interview-access-skeleton-content">{children}</span>
      <span className="quota-skeleton-line interview-access-skeleton" />
    </span>
  );
}

export function InterviewAccessList({
  checking,
  sources,
  report,
}: {
  checking: boolean;
  sources: AudioSource[];
  report: InterviewAccessReport | null;
}) {
  const statusSlot = (content: ReactNode) =>
    checking ? (
      <AccessSkeleton className="interview-access-status-slot">{content}</AccessSkeleton>
    ) : (
      content
    );
  const screen = report?.screenCapture;
  const supported = window.desktop?.screenCapturePermissionSupported;
  const screenReady = screen?.status === 'granted' || screen?.status === 'not-required';
  const screenStatus = checking
    ? window.desktop?.platform === 'windows'
      ? 'not-required'
      : 'granted'
    : screen?.status;
  return (
    <>
      {checking && (
        <p className="sr-only" role="status">
          {t('正在检查权限与音频设备…')}
        </p>
      )}
      <ul className="interview-access-list" aria-hidden={checking || undefined}>
        {(['microphone', 'system'] as const).map((source) => {
          const check = report?.checks.find((item) => item.source === source);
          const status = checking ? 'granted' : check?.status;
          const failed = status && status !== 'granted';
          const label = status
            ? audioLabels[status]
            : sources.includes(source)
              ? '待确认'
              : '未启用';
          return (
            <li key={source}>
              <div className="interview-access-row">
                <span>{t(source === 'microphone' ? '麦克风' : '系统音频')}</span>
                {statusSlot(
                  <span className={`interview-access-status ${failed ? 'danger-text' : ''}`}>
                    {checking && <Check size={14} />}
                    {!checking && status === 'granted' && <AudioPreviewIcon source={source} />}
                    {failed && <X size={14} />}
                    {t(label)}
                  </span>,
                )}
              </div>
              <InterviewReveal resizeKey={check?.message ?? ''}>
                {failed && check ? (
                  <p className="interview-access-detail danger-text">{t(check.message)}</p>
                ) : null}
              </InterviewReveal>
            </li>
          );
        })}
        <li aria-label={t('屏幕捕获权限检查')}>
          <div className="interview-access-row">
            <span>{t('屏幕截图')}</span>
            {statusSlot(
              <span className="interview-access-status">
                {checking || screenReady ? <Check size={14} /> : <Monitor size={14} />}
                {t(screenStatus ? screenLabels[screenStatus] : supported ? '待确认' : '未启用')}
              </span>,
            )}
          </div>
          <InterviewReveal resizeKey={screen?.message || screen?.status || ''}>
            {!checking && screen && !screenReady ? (
              <p className="interview-access-detail">
                {['error', 'unknown', 'restricted'].includes(screen.status) &&
                  `${t(screen.message)} `}
                {t('可继续纯语音面试，截图需授权。')}
              </p>
            ) : null}
          </InterviewReveal>
        </li>
        <li>
          <div className="interview-access-row">
            <span>{t('远程连接')}</span>
            <RemoteConnectionStatus />
          </div>
        </li>
        <li>
          <div className="interview-access-row">
            <span>{t('快捷键')}</span>
            {checking ? (
              statusSlot(
                <span className="interview-access-status">
                  <Check size={14} />
                  {t('快捷键可用')}
                </span>,
              )
            ) : (
              <ShortcutAvailabilityStatus />
            )}
          </div>
        </li>
      </ul>
    </>
  );
}
