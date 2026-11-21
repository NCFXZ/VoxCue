import { app, type BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ApiKeyField, ApiKeyPromptCommand } from '../../shared/electron/contracts/apiConnections';

const active = new WeakMap<BrowserWindow, (command: ApiKeyPromptCommand) => void>();
const maxReply = 24 * 1024;
const unavailable = () => Error('无法打开 API 密钥输入窗口。');

export function controlApiKey(owner: BrowserWindow, command: ApiKeyPromptCommand) {
  active.get(owner)?.(command);
}

export async function promptApiKey(
  owner: BrowserWindow, name: string, language: string, signal: AbortSignal, field: ApiKeyField,
  tab?: (backwards: boolean) => void,
): Promise<string | null> {
  signal.throwIfAborted();
  if (owner.isDestroyed() || active.has(owner)) throw unavailable();
  const directory = app.isPackaged ? path.join(process.resourcesPath, 'native')
    : path.join(app.getAppPath(), 'native/bin');
  const handle = owner.getNativeWindowHandle().readBigUInt64LE().toString();
  const child = spawn(path.join(directory, 'VoxCue.ApiKeyPrompt.exe'),
    [handle, String(process.pid), name, language], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
  let pending = Buffer.alloc(0);
  let key: string | null | undefined;
  let lastLayout = '';
  let settled = false;
  return new Promise<string | null>((resolve, reject) => {
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      active.delete(owner);
      owner.removeListener('closed', onClosed);
      signal.removeEventListener('abort', aborted);
      pending.fill(0);
      child.kill();
      if (error) reject(error);
      else resolve(key ?? null);
      key = undefined;
    }
    const onClosed = () => finish(new DOMException('Aborted', 'AbortError'));
    const aborted = () => finish(signal.reason);
    const send = (command: ApiKeyPromptCommand) => {
      if (settled || !child.stdin.writable) return;
      let line: string = command.action;
      if (command.action === 'visibility') {
        line = command.visible ? 'reveal' : 'mask';
      } else if (command.action === 'layout') {
        const { x, y, width, height, dark } = command.field;
        const zoom = owner.webContents.getZoomFactor();
        // Thousandths of a DIP. Only the native side knows the owner's current monitor DPI.
        const values = [x, y, width, height, 14].map((value) => Math.round(value * zoom * 1000));
        line = 'layout ' + values.join(' ') + (dark ? ' 1' : ' 0');
        if (line === lastLayout) return;
        lastLayout = line;
      }
      if (child.stdin.writableLength > 32 * 1024) return finish(unavailable());
      child.stdin.write(line + '\n');
    };
    active.set(owner, send);
    owner.once('closed', onClosed);
    signal.addEventListener('abort', aborted, { once: true });
    child.once('error', () => finish(unavailable()));
    child.stdin.on('error', () => { /* A native Enter/Escape can close the pipe before the UI. */ });
    child.stdout.on('error', () => finish(unavailable()));
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      const previous = pending;
      pending = Buffer.concat([previous, chunk]);
      previous.fill(0);
      chunk.fill(0);
      if (pending.length > maxReply) return finish(unavailable());
      let end;
      while ((end = pending.indexOf(10)) >= 0) {
        const line = pending.subarray(0, end);
        pending = pending.subarray(end + 1);
        if (key !== undefined) return finish(unavailable());
        const message = line.toString('ascii');
        line.fill(0);
        if (message === 'tab' || message === 'backtab') {
          if (tab && !owner.isDestroyed()) {
            owner.webContents.focus();
            tab(message === 'backtab');
          }
        } else if (message === 'cancel') key = null;
        else if (message.startsWith('submit ')) {
          const plain = Buffer.from(message.slice(7), 'base64');
          key = plain.toString('utf8');
          plain.fill(0);
        } else return finish(unavailable());
      }
    });
    child.once('close', (code) => finish(code === 0 && key !== undefined && !pending.length
      ? undefined : unavailable()));
    if (signal.aborted) return aborted();
    send({ action: 'layout', field });
  });
}
