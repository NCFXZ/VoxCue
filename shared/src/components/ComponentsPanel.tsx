import { useComponents } from '../stores/components';
import { Button } from './ui/button';
import { DownloadButton } from './DownloadButton';
import { ActionTransition } from './ActionTransition';
import { Download, Refresh, Loader } from './icons';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import type { ComponentState } from '../../electron/contracts/components';
import { speechModelLabels } from '../../electron/contracts/speechSettings';

const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
const modelInfo = {
  speech: {
    label: speechModelLabels.paraformer,
    description: '轻量中英流式识别，使用 CPU，资源占用较低。',
  },
  qwen: {
    label: speechModelLabels.qwen,
    description: '多语言流式识别，支持标点，硬件要求较高。',
  },
  rag: { label: 'multilingual-e5-small', description: '将资料转换为向量，用于知识库检索。' },
} as const;
export function ComponentsPanel() {
  const { state, error, run } = useComponents();
  if (!window.desktop?.components) return null;
  const busy = ['downloading', 'verifying', 'removing'].includes(state?.phase ?? '');
  const items = state?.items ?? [];
  const speechModels = items.filter((item) => item.id === 'speech' || item.id === 'qwen');
  const knowledgeModels = items.filter((item) => item.id === 'rag');
  const renderItem = (item: ComponentState['items'][number], label = modelInfo[item.id].label) => (
    <div className="component-row" key={item.id} data-component-id={item.id}>
      <div className="component-copy">
        <span className="component-model-name">{label}</span>
        <span>{modelInfo[item.id].description}</span>
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
            {(item.removable ?? state?.removable) && (
              <ConfirmDeleteButton
                target={label}
                disabled={busy || state?.phase === 'checking'}
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
            label={label}
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
            {item.phase === 'checking' ? '检查中' : state?.phase === 'error' ? '重试下载' : '下载'}
          </Button>
        )}
      </ActionTransition>
    </div>
  );
  return (
    <section className="components-panel" aria-label="本地组件">
      {!state && (
        <p className="section-help" role="status">
          正在检查本地组件…
        </p>
      )}
      {speechModels.length > 0 && (
        <section className="component-group" aria-label="本地语音模型">
          <h3>本地语音模型</h3>
          {speechModels.map((item) => renderItem(item))}
        </section>
      )}
      {knowledgeModels.length > 0 && (
        <section className="component-group" aria-label="知识库模型">
          <h3>知识库模型</h3>
          {knowledgeModels.map((item) => renderItem(item))}
        </section>
      )}
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
