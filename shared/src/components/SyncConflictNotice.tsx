import { useContext } from 'react';
import { t } from '../i18n';
import { syncItemsWithStatus } from '../services/cloudSync';
import { useCloudAccount } from '../stores/cloudAccount';
import { useCloudSync } from '../stores/cloudSync';
import { SettingsNotice } from './SettingsNotice';
import { ConflictSettingsContext } from './ui/useSettingsTarget';

export function SyncConflictNotice() {
  const openSettings = useContext(ConflictSettingsContext);
  const signedIn = useCloudAccount(state => Boolean(state.state.user));
  const count = useCloudSync(state => syncItemsWithStatus(state.marks, 'conflict').length);
  if (!signedIn || !count || !openSettings) return null;
  return (
    <SettingsNotice
      title={t('资料冲突')}
      label={t('资料冲突')}
      detail={t('有 {0} 条资料在本地与云端存在冲突。', [count])}
      onSettings={openSettings}
    />
  );
}
