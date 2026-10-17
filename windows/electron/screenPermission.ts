import type {
  ScreenCaptureAccess,
  ScreenCapturePermissionAction,
  ScreenCapturePermission,
} from '../../shared/electron/contracts/screenCapture';

/** Checking desktopCapturer capability must not enumerate sources or read pixels.
 * Electron's Windows screen media status is always granted, not a permission proof.
 */
export class ScreenPermission implements ScreenCaptureAccess {
  async call(action: ScreenCapturePermissionAction): Promise<ScreenCapturePermission> {
    if (action !== 'check') throw Error('Windows 当前捕获方式无需单独申请屏幕权限。');
    return {
      status: 'not-required',
      message: 'Windows 当前捕获方式无需单独申请权限；实际截图仍可能受系统或受保护内容限制。',
    };
  }
}
