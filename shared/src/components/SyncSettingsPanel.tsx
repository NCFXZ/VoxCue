import { t } from '../i18n';
import { useCloudSync } from '../stores/cloudSync';
import { Button } from './ui/button';
import { SyncBadge } from './SyncBadge';
import { CloudStorageSummary } from './CloudStorageSummary';
import { CloudSync, Refresh } from './icons';

export function SyncSettingsPanel() {
  const state = useCloudSync();
  return (
    <>
      <CloudStorageSummary />
      {(
        [
          ['profile', t('个人信息')],
          ['history', t('面试记录')],
          ['knowledgebase', t('知识库')],
        ] as const
      ).map(([kind, label]) => (
        <div className="settings-entry" key={kind}>
          <div>
            <strong>{t(label)}</strong>
          </div>
          <button
            className="settings-switch"
            role="switch"
            aria-label={t('同步{0}', [t(label)])}
            aria-checked={state.preferences.enabled[kind]}
            disabled={!state.ready}
            onClick={() => void state.configure(kind, !state.preferences.enabled[kind])}
          >
            <span />
          </button>
        </div>
      ))}
      <div className="cloud-sync-actions">
        <Button
          variant="outline"
          disabled={!state.ready || state.busy}
          onClick={() => void state.refresh()}
        >
          <CloudSync size={16} />
          {t('立即同步')}
        </Button>
        <Button
          variant="outline"
          disabled={!state.ready || state.busy}
          onClick={() => void state.refreshStorage()}
        >
          <Refresh size={16} />
          {t('刷新容量')}
        </Button>
      </div>
      {state.busy && (
        <p className="settings-hint" role="status">
          {t('正在同步…')}
        </p>
      )}
      {state.error && (
        <p className="danger-text" role="alert">
          {t(state.error)}
        </p>
      )}
      {Object.entries(state.marks)
        .filter(([, m]) => m.status === 'conflict' || m.status === 'error')
        .map(([key, mark]) => (
          <div className="settings-entry" key={key}>
            <div>
              <strong>{key.startsWith('profile:') ? t('个人信息') : t('同步条目')}</strong>
              <p className="settings-hint">
                {t(mark.error || '两端都有修改，请选择要保留的版本。')}
              </p>
            </div>
            <SyncBadge itemKey={key} />
          </div>
        ))}
    </>
  );
}
