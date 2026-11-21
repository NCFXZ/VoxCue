import { useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { useCloudAccount } from '../stores/cloudAccount';
import { SettingsNotice } from './SettingsNotice';
import {
  dismissLocalImportNotice,
  shouldShowLocalImport,
  subscribeLocalImport,
} from '../services/localImportNotice';

export function LocalImportNotice({ onSettings }: { onSettings?(): void }) {
  const revision = useCloudAccount((s) => (s.state.user ? s.state.localImportRevision : undefined));
  const visible = useSyncExternalStore(
    subscribeLocalImport,
    () => shouldShowLocalImport(revision),
    () => false,
  );
  if (!visible || !onSettings) return null;
  return (
    <SettingsNotice
      label={t('本地资料提醒')}
      title={t('本地账户有可迁移的资料')}
      detail={t('本地账户与当前账号的资料分开保存。')}
      onSettings={onSettings}
      onDismiss={dismissLocalImportNotice}
    />
  );
}
