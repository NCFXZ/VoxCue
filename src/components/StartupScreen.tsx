import { AppLogo } from './AppLogo';

export function StartupScreen() {
  return (
    <main className="startup-screen" role="status" aria-label="正在启动 VoxCue">
      <AppLogo size={88} />
      <strong>VoxCue</strong>
      <span className="startup-progress" />
    </main>
  );
}
