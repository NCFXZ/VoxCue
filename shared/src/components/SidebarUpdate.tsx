import { useUpdates } from '../stores/updates';
import { Button } from './ui/button';
import { DownloadButton } from './DownloadButton';
import { Download, Loader, Update } from './icons';

export function SidebarUpdate() {
  const { state, run } = useUpdates();
  if (!state?.availableVersion) return null;
  if (!['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state.phase))
    return null;
  const downloaded = state.phase === 'downloaded';
  const installing = state.phase === 'installing';
  return state.phase === 'downloading' ? (
    <DownloadButton
      className="sidebar-update"
      iconOnly
      label="更新"
      progress={state.progress}
      onCancel={() => void run('cancel')}
    />
  ) : (
    <Button
      variant="ghost"
      size="icon"
      className="sidebar-update"
      aria-label={installing ? '正在准备更新' : downloaded ? '重启并更新' : '下载更新'}
      disabled={installing || (downloaded && state.interviewActive)}
      onClick={() => void run(downloaded ? 'install' : 'download')}
    >
      {installing ? (
        <span className="update-spinner" aria-hidden="true">
          <Loader size={17} />
        </span>
      ) : downloaded ? (
        <Update size={17} />
      ) : (
        <Download size={17} />
      )}
    </Button>
  );
}
