import { InterviewReveal } from './InterviewReveal';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useCloudAccount } from '../stores/cloudAccount';
import { useCloudSync } from '../stores/cloudSync';
import { syncItemsWithStatus } from '../services/cloudSync';
import { Button } from './ui/button';
import { SyncProblemDialog } from './SyncProblemDialog';
import { CloudStorageSummary } from './CloudStorageSummary';
import { CloudError, CloudSync, Refresh } from './icons';

export function SyncSettingsPanel() {
  const state = useCloudSync();
  const owner = useCloudAccount(account => account.state.user?.id);
  const [show, setShow] = useState<'conflict' | 'error'>();
  useEffect(() => setShow(undefined), [owner]);
  const conflicts = syncItemsWithStatus(state.marks, 'conflict');
  const failures = syncItemsWithStatus(state.marks, 'error');
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
          {state.ready ? (
            <button
              className="settings-switch"
              role="switch"
              aria-label={t('同步{0}', [t(label)])}
              aria-checked={state.preferences.enabled[kind]}
              onClick={() => void state.configure(kind, !state.preferences.enabled[kind])}
            >
              <span />
            </button>
          ) : (
            <span className="settings-hint">{state.error ? '—' : t('读取中…')}</span>
          )}
        </div>
      ))}
      <div className="cloud-sync-actions">
        <div className="cloud-sync-messages">
          <InterviewReveal resizeKey={`${state.busy}:${state.error ?? ''}`}>
            {state.busy || state.error ? (
              <>
                {state.busy && <p className="settings-hint" role="status">{t('正在同步…')}</p>}
                {state.error && <p className="danger-text" role="alert">{t(state.error)}</p>}
              </>
            ) : null}
          </InterviewReveal>
        </div>
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
      {conflicts.length > 0 && (
        <div className="settings-entry sync-problem-entry" data-settings-target="sync-conflicts">
          <div>
            <strong>{t('资料冲突')}</strong>
            <p className="settings-hint">{t('有 {0} 条资料在本地与云端存在冲突。', [conflicts.length])}</p>
          </div>
          <Button variant="outline" aria-haspopup="dialog" onClick={() => setShow('conflict')}>
            <CloudError size={16} />
            {t('查看冲突')}
          </Button>
        </div>
      )}
      {failures.length > 0 && (
        <div className="settings-entry sync-problem-entry">
          <div>
            <strong>{t('同步失败')}</strong>
            <p className="settings-hint">{t('有 {0} 条资料未能同步。', [failures.length])}</p>
          </div>
          <Button variant="outline" aria-haspopup="dialog" onClick={() => setShow('error')}>
            <CloudError size={16} />
            {t('查看错误')}
          </Button>
        </div>
      )}
      {show && (
        <SyncProblemDialog key={owner + '/' + show} mode={show}
          problems={show === 'conflict' ? conflicts : failures} busy={state.busy} onClose={() => setShow(undefined)} />
      )}
    </>
  );
}
