import { ipcMain, type WebContents } from 'electron';
import type { DesktopInvokeMap, DesktopSendMap, DesktopEventMap } from '../contracts/desktop';

export function isMainDocumentNavigation(details: Pick<
  Electron.WebContentsDidStartNavigationEventParams, 'isMainFrame' | 'isSameDocument'
>) {
  return details.isMainFrame && !details.isSameDocument;
}

// Compile-time channel/reply agreement. Each route must still validate the
// actual sender and untrusted values before invoking a business service.
export function handleDesktop<K extends keyof DesktopInvokeMap>(
  channel: K,
  handler: (
    event: Electron.IpcMainInvokeEvent,
    ...args: DesktopInvokeMap[K]['args']
  ) => DesktopInvokeMap[K]['result'] | Promise<DesktopInvokeMap[K]['result']>,
) {
  ipcMain.handle(channel, handler);
}

export function onDesktop<K extends keyof DesktopSendMap>(
  channel: K,
  handler: (event: Electron.IpcMainEvent, ...args: DesktopSendMap[K]) => void,
) {
  ipcMain.on(channel, handler);
}

export function sendDesktop<K extends keyof DesktopEventMap>(
  target: WebContents,
  channel: K,
  ...args: DesktopEventMap[K]
) {
  target.send(channel, ...args);
}
