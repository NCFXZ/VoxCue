import { t } from '../i18n';
import { AppLogo } from './AppLogo';

export function StartupScreen() {
  return (
    <main className="startup-screen" role="status" aria-label={t('正在启动 VoxCue')}>
      <AppLogo size={88} />
      <strong className="startup-title">VoxCue</strong>
    </main>
  );
}
