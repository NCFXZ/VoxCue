import { app, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { ApiKeyField, ApiKeyPromptCommand } from '../../shared/electron/contracts/apiConnections';

interface NativeInput {
  begin(handle: Buffer, label: string, notify: (action: 'tab' | 'backtab' | 'submit' | 'cancel') => void): void;
  layout(x: number, y: number, width: number, height: number, font: number, dark: boolean): void;
  command(action: 'submit'): string;
  command(action: 'focus' | 'close' | 'mask' | 'reveal'): void;
  certificatePassword(handle: Buffer, english: boolean, result: (value: string | null) => void): void;
}
export function nativeInput(): NativeInput {
  const directory = app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(app.getAppPath(), 'native/bin');
  return require(path.join(directory, 'VoxCue.SecureInput.node'));
}
const active = new WeakMap<BrowserWindow, (command: ApiKeyPromptCommand) => void>();
export function controlApiKey(owner: BrowserWindow, command: ApiKeyPromptCommand) {
  active.get(owner)?.(command);
}
export async function promptApiKey(owner: BrowserWindow, name: string, language: string, signal: AbortSignal,
  field: ApiKeyField, tab?: (backwards: boolean) => void): Promise<string | null> {
  signal.throwIfAborted();
  if (owner.isDestroyed() || active.has(owner)) throw Error('无法打开 API 密钥输入窗口。');
  const native = nativeInput();
  const service = name.replace(/ API$/i, '') + (language === 'en' ? ' API key' : ' API 密钥');
  return new Promise((resolve, reject) => {
    let opened = false;
    let settled = false;
    function finish(value: string | null, error?: unknown) {
      if (settled) return;
      settled = true;
      active.delete(owner);
      owner.removeListener('closed', abort);
      signal.removeEventListener('abort', abort);
      if (opened) native.command('close');
      if (error) reject(error);
      else resolve(value);
    }
    function abort() { finish(null, signal.reason ?? new DOMException('Aborted', 'AbortError')); }
    function send(command: ApiKeyPromptCommand) {
      if (settled) return;
      try {
        if (command.action === 'layout') {
          const { x, y, width, height, dark } = command.field;
          const zoom = owner.webContents.getZoomFactor();
          native.layout(x * zoom, y * zoom, width * zoom, height * zoom, 14 * zoom, dark);
        } else if (command.action === 'visibility') native.command(command.visible ? 'reveal' : 'mask');
        else if (command.action === 'focus') native.command('focus');
        else finish(command.action === 'submit' ? native.command('submit') : null);
      } catch (error) { finish(null, error); }
    }
    try {
      native.begin(owner.getNativeWindowHandle(), service, action => {
        if (settled || owner.isDestroyed()) return;
        if (action === 'tab' || action === 'backtab') {
          owner.webContents.focus();
          tab?.(action === 'backtab');
        } else send({ action });
      });
      opened = true;
      active.set(owner, send);
      owner.once('closed', abort);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      send({ action: 'layout', field });
      send({ action: 'focus' });
    } catch (error) { finish(null, error); }
  });
}
