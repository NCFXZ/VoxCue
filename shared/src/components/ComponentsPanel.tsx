import { t } from '../i18n';
import { InterviewReveal } from './InterviewReveal';
import { useRef } from 'react';
import { useComponents } from '../stores/components';
import { Button } from './ui/button';
import { DownloadButton } from './DownloadButton';
import { ActionTransition } from './ActionTransition';
import { Download, Refresh, Loader } from './icons';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import {
  componentPresentation as modelInfo,
  type ComponentState,
} from '../../electron/contracts/components';

const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
const skeletonGroups = [
  ['语音识别组件', ['speech', 'qwen']],
  ['知识库检索组件', ['rag']],
] as const;
export function ComponentsPanel() {
  const { state, error, run } = useComponents();
  const settled = useRef(new Map<string, 'ready' | 'pending'>());
  if (!window.desktop?.components) return null;
  const loading = !state && !error;
  const busy = ['downloading', 'verifying', 'removing'].includes(state?.phase ?? '');
  const items = state?.items ?? [];
  for (const item of items)
    if (item.phase === 'ready' || item.phase === 'pending')
      settled.current.set(item.id, item.phase);
  const speechModels = items.filter((item) => item.id === 'speech' || item.id === 'qwen');
  const knowledgeModels = items.filter((item) => item.id === 'rag');
  const renderItem = (item: ComponentState['items'][number], label = modelInfo[item.id].label) => {
    // Revalidation can visit every cache before one selected download starts.
    // Keep the last settled action while the status text reports the check.
    const action =
      item.phase === 'checking' ? (settled.current.get(item.id) ?? 'pending') : item.phase;
    const blocked = busy || state?.phase === 'checking' || item.phase === 'checking';
    return (
      <div className="component-row" key={item.id} data-component-id={item.id} data-settings-target={item.id}>
        <div className="component-copy">
          <span className="component-model-name">{t(label)}</span>
          <span>{t(modelInfo[item.id].description)}</span>
          <span role="status">
            {item.phase === 'ready'
              ? size(item.bytes)
              : item.phase === 'checking'
                ? t('正在校验本地文件…')
                : item.phase === 'verifying'
                  ? t('正在校验并准备…')
                  : item.phase === 'removing'
                    ? t('正在删除本机模型…')
                    : item.phase === 'downloading'
                      ? `${size(item.received)} / ${size(item.bytes)}`
                      : t('{0} · 尚未下载', [size(item.bytes)])}
          </span>
        </div>
        <ActionTransition>
          {action === 'ready' ? (
            <span className="component-ready-actions">
              {(item.removable ?? state?.removable) && (
                <ConfirmDeleteButton
                  target={t(label)}
                  disabled={blocked}
                  warning={t('仅删除本机模型，可重新下载；知识库、资料和记录保留')}
                  onConfirm={() => run({ op: 'remove', id: item.id })}
                />
              )}
            </span>
          ) : item.phase === 'removing' ? (
            <Button variant="ghost" disabled>
              <Loader size={16} />
              {t('删除中…')}
            </Button>
          ) : item.phase === 'downloading' || item.phase === 'verifying' ? (
            <DownloadButton
              label={t(label)}
              cancelDelayMs={500}
              progress={item.phase === 'downloading' ? (item.received / item.bytes) * 100 : null}
              status={item.phase === 'verifying' ? t('校验中') : undefined}
              onCancel={() => void run({ op: 'cancel' })}
            />
          ) : (
            <Button
              variant="outline"
              disabled={blocked}
              onClick={() => void run({ op: 'download', id: item.id })}
            >
              <Download size={16} />
              {t('下载')}
            </Button>
          )}
        </ActionTransition>
      </div>
    );
  };
  return (
    <section className="components-panel" aria-label={t('本地组件')} aria-busy={loading}>
      {loading && (
        <>
          <p className="sr-only" role="status">
            {t('正在检查本地组件…')}
          </p>
          <div aria-hidden="true">
            {skeletonGroups.map(([label, models]) => (
              <section className="component-group" key={label}>
                <h3>{t(label)}</h3>
                {models.map((model) => (
                  <div className="component-row" key={model}>
                    <div className="component-copy">
                      <span className="component-model-name quota-skeleton-line quota-skeleton-reset" />
                      <span className="quota-skeleton-line component-skeleton-description" />
                      <span className="quota-skeleton-line quota-skeleton-number" />
                    </div>
                    <span className="quota-skeleton-line component-skeleton-action" />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
      {speechModels.length > 0 && (
        <section className="component-group" aria-label={t('语音识别组件')}>
          <h3>{t('语音识别组件')}</h3>
          {speechModels.map((item) => renderItem(item))}
        </section>
      )}
      {knowledgeModels.length > 0 && (
        <section className="component-group" aria-label={t('知识库检索组件')}>
          <h3>{t('知识库检索组件')}</h3>
          {knowledgeModels.map((item) => renderItem(item))}
        </section>
      )}
      <InterviewReveal resizeKey={error ? `retry:${error}` : state?.error ?? ''}>
        {error || state?.error ? (
          <>
            <p className="inline-error" role="alert">{t(error || state?.error)}</p>
            {error && (
              <Button variant="ghost" onClick={() => void run({ op: 'status' })}>
                <Refresh size={16} />
                {t('重新检查')}
              </Button>
            )}
          </>
        ) : null}
      </InterviewReveal>
    </section>
  );
}
