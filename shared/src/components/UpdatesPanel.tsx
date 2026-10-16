import { useEffect } from 'react';
import { useUpdates } from '../stores/updates';
import { Button } from './ui/button';
import { Download, Loader, RotateCcw } from './icons';

export function UpdatesPanel() {
  const updates = useUpdates();
  useEffect(() => updates.connect(), []);
  const state = updates.state;
  const busy = !state || ['checking', 'downloading', 'installing'].includes(state.phase);
  const downloaded = state?.phase === 'downloaded';
  const available =
    state?.phase === 'available' || (state?.phase === 'error' && !!state.availableVersion);
  const label = !state
    ? '正在读取更新状态…'
    : state.phase === 'unavailable'
      ? state.message
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
                  : '启动后自动检查并下载新版本。';
  return (
    <>
      <div className="settings-entry">
        <strong>当前版本</strong>
        <span className="settings-value">{state?.currentVersion ?? '—'}</span>
      </div>
      <div className="settings-entry">
        <strong>软件更新</strong>
        <Button
          variant="outline"
          disabled={busy || state?.phase === 'unavailable' || (downloaded && state.interviewActive)}
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
            <RotateCcw size={16} />
          )}
          {state?.phase === 'checking'
            ? '检查中…'
            : state?.phase === 'downloading'
              ? '下载中…'
              : state?.phase === 'installing'
                ? '准备更新…'
                : downloaded
                  ? '重启并更新'
                  : available
                    ? '下载更新'
                    : '检查更新'}
        </Button>
      </div>
      <p className="settings-hint" role="status" aria-live="polite">
        {label}
      </p>
      {state?.phase === 'downloading' && (
        <progress
          className="update-progress"
          aria-label="更新下载进度"
          max={100}
          value={state.progress ?? 0}
        />
      )}
      <p className="settings-hint">
        更新会保留本机聊天、附件、个人资料和面试记录。安装需要点击“重启并更新”；面试进行中无法安装。
      </p>
      {(updates.error || state?.error) && (
        <p className="inline-error" role="alert">
          {updates.error || state?.error}
        </p>
      )}
      {state?.interviewActive && (
        <p className="settings-hint">面试进行中，可以检查和下载更新，请结束面试后再安装。</p>
      )}
    </>
  );
}
