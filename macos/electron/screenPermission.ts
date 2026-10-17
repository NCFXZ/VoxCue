import type {
  ScreenCaptureAccess,
  ScreenCapturePermission,
  ScreenCapturePermissionAction,
} from '../../shared/electron/contracts/screenCapture';
interface Dependencies {
  mediaStatus(): string;
  binding(): { preflight(): boolean; request(): Promise<boolean> };
  openSettings(): Promise<void>;
}
export class ScreenPermission implements ScreenCaptureAccess {
  private requesting?: Promise<ScreenCapturePermission>;
  constructor(private dependencies: Dependencies) {}
  private check(): ScreenCapturePermission {
    try {
      const granted = this.dependencies.binding().preflight();
      if (typeof granted !== 'boolean') throw Error('Invalid native response');
      if (granted) return { status: 'granted', message: '屏幕捕获已允许' };
      const status = this.dependencies.mediaStatus();
      if (status === 'restricted') return { status, message: '屏幕捕获权限受系统限制' };
      if (status === 'not-determined') return { status, message: '屏幕捕获尚未申请权限' };
      if (status === 'denied') return { status, message: '屏幕捕获未获允许' };
      return { status: 'unknown', message: '无法确认屏幕捕获权限，请重新检查' };
    } catch {
      return { status: 'error', message: '屏幕捕获权限检查失败，请检查本地组件后重试' };
    }
  }
  async call(action: ScreenCapturePermissionAction): Promise<ScreenCapturePermission> {
    if (action === 'check') return this.check();
    if (action === 'open-settings') {
      await this.dependencies.openSettings().catch(() => {
        throw Error('无法打开屏幕捕获权限设置，请手动打开 macOS 隐私与安全性。');
      });
      return this.check();
    }
    if (action !== 'request') throw Error('Invalid permission request');
    if (this.requesting) return this.requesting;
    const request = async () => {
      if (this.check().status === 'granted') return this.check();
      const granted = await this.dependencies.binding().request();
      if (typeof granted !== 'boolean') throw Error('屏幕捕获权限申请失败，请重试。');
      const result = this.check();
      if (result.status !== 'granted') await this.dependencies.openSettings();
      return result;
    };
    this.requesting = request()
      .catch(() => {
        throw Error('无法申请屏幕捕获权限，请检查本地组件或系统设置后重试。');
      })
      .finally(() => {
        this.requesting = undefined;
      });
    return this.requesting;
  }
}
