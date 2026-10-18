import { useComponents } from '../stores/components';
import { Button } from './ui/button';
import { DownloadButton } from './DownloadButton';
import { ActionTransition } from './ActionTransition';
import { Download, Refresh, Loader } from './icons';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';

const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
export function ComponentsPanel() {
  const { state, error, run } = useComponents();
  if (!window.desktop?.components) return null;
  const busy = ['downloading', 'verifying', 'removing'].includes(state?.phase ?? '');
  const items = state?.items ?? [];
  return (
    <section className="components-panel" aria-label="本地组件">
      {!state && (
        <p className="section-help" role="status">
          正在检查本地组件…
        </p>
      )}
      {items.map((item) => (
        <div className="component-row" key={item.id}>
          <div className="component-copy">
            <strong>{item.label}</strong>
            <span role="status">
              {item.phase === 'ready'
                ? size(item.bytes)
                : item.phase === 'checking'
                  ? '正在校验本地文件…'
                  : item.phase === 'verifying'
                    ? '正在校验并准备…'
                    : item.phase === 'removing'
                      ? '正在删除本机模型…'
                      : item.phase === 'downloading'
                        ? `${size(item.received)} / ${size(item.bytes)}`
                        : `${size(item.bytes)} · 尚未下载`}
            </span>
          </div>
          <ActionTransition>
            {item.phase === 'ready' ? (
              <span className="component-ready-actions">
                <span className="component-ready">已就绪</span>
                {state?.removable && (
                  <ConfirmDeleteButton
                    target={item.label}
                    disabled={busy || state.phase === 'checking'}
                    warning="仅删除本机模型，可重新下载；知识库、资料和记录保留"
                    onConfirm={() => run({ op: 'remove', id: item.id })}
                  />
                )}
              </span>
            ) : item.phase === 'removing' ? (
              <Button variant="ghost" disabled>
                <Loader size={16} />
                删除中…
              </Button>
            ) : item.phase === 'downloading' || item.phase === 'verifying' ? (
              <DownloadButton
                label={item.label}
                progress={item.phase === 'downloading' ? (item.received / item.bytes) * 100 : null}
                status={item.phase === 'verifying' ? '校验中' : undefined}
                onCancel={() => void run({ op: 'cancel' })}
              />
            ) : (
              <Button
                variant="outline"
                disabled={busy || state?.phase === 'checking'}
                onClick={() => void run({ op: 'download', id: item.id })}
              >
                {item.phase === 'checking' ? (
                  <Loader size={16} />
                ) : state?.phase === 'error' ? (
                  <Refresh size={16} />
                ) : (
                  <Download size={16} />
                )}
                {item.phase === 'checking'
                  ? '检查中'
                  : state?.phase === 'error'
                    ? '重试下载'
                    : '下载'}
              </Button>
            )}
          </ActionTransition>
        </div>
      ))}
      {(error || state?.error) && (
        <p className="inline-error" role="alert">
          {error || state?.error}
        </p>
      )}
      {error && (
        <Button variant="ghost" onClick={() => void run({ op: 'status' })}>
          <Refresh size={16} />
          重新检查
        </Button>
      )}
    </section>
  );
}
