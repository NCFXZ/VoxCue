import type { ScreenCaptureAccess } from '../contracts/screenCapture';
import { handleDesktop } from './handle';
export function registerScreenCaptureIpc(
  access: ScreenCaptureAccess | undefined,
  requireMain: (event: Electron.IpcMainInvokeEvent) => void,
) {
  handleDesktop('interview:screen-permission', (event, action: unknown, ...extra: unknown[]) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (extra.length || !['check', 'request', 'open-settings'].includes(action as string))
      throw Error('Invalid request');
    if (!access) throw Error('当前系统不需要此屏幕捕获权限设置。');
    return access.call(action as 'check' | 'request' | 'open-settings');
  });
}
