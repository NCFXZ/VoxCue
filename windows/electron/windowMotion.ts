import { app, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function prepareWindowFade(win: BrowserWindow) {
  const directory = app.isPackaged
    ? path.join(process.resourcesPath, 'native')
    : path.join(app.getAppPath(), 'native/bin');
  const handle = win.getNativeWindowHandle().readBigUInt64LE().toString();
  await execute(path.join(directory, 'VoxCue.WindowMotion.exe'), [handle, String(process.pid)], {
    windowsHide: true,
    timeout: 3000,
  });
}
