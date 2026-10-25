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
      hoverLabel="取消下载"
      progress={state.progress}
      onCancel={() => void run('cancel')}
    />
  ) : (
    <Button
      variant="ghost"
      size="icon"
      className={`sidebar-update${installing ? '' : ' sidebar-update-expandable'}`}
      aria-label={installing ? '正在准备更新' : downloaded ? '重启以更新' : '下载更新'}
      disabled={installing || (downloaded && state.interviewActive)}
      onClick={() => void run(downloaded ? 'install' : 'download')}
    >
      <span className="sidebar-update-idle" aria-hidden="true">
        {installing ? (
          <span className="update-spinner">
            <Loader size={17} />
          </span>
        ) : downloaded ? (
          <Update size={17} />
        ) : (
          <Download size={17} />
        )}
      </span>
      <span className="sidebar-update-expanded" aria-hidden="true">
        {downloaded ? <Update size={17} /> : <Download size={17} />}
        <span className="sidebar-update-label">{downloaded ? '重启以更新' : '下载更新'}</span>
      </span>
    </Button>
  );
}
