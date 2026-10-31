import { app, nativeImage, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);

/** One requested frame from the owner's current monitor; no files or persistent capture. */
export async function captureScreen(window: BrowserWindow, signal: AbortSignal) {
  signal.throwIfAborted();
  if (window.isDestroyed()) throw new DOMException('Aborted', 'AbortError');
  const helper = path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    app.isPackaged ? 'native' : 'native/bin',
    'VoxCue.Screenshot.exe',
  );
  try {
    const { stdout } = await execute(
      helper,
      [window.getNativeWindowHandle().readBigUInt64LE().toString()],
      {
        windowsHide: true,
        encoding: 'buffer',
        timeout: 10000,
        maxBuffer: 3840 * 3840 * 4 + 8,
        signal,
      },
    );
    signal.throwIfAborted();
    if (window.isDestroyed()) throw new DOMException('Aborted', 'AbortError');
    if (stdout.length < 8) throw Error('Invalid screen frame');
    const width = stdout.readUInt32LE(0),
      height = stdout.readUInt32LE(4);
    if (
      width < 1 ||
      height < 1 ||
      width > 3840 ||
      height > 3840 ||
      stdout.length !== 8 + width * height * 4
    )
      throw Error('Invalid screen frame');
    const image = nativeImage.createFromBitmap(stdout.subarray(8), { width, height });
    if (image.isEmpty()) throw Error('Empty screen frame');
    return image;
  } catch (error) {
    signal.throwIfAborted();
    if (window.isDestroyed()) throw new DOMException('Aborted', 'AbortError');
    throw Error('无法截取面试窗口所在屏幕，请检查系统屏幕捕获状态后重试。', { cause: error });
  }
}
