import {
  desktopCapturer,
  nativeImage,
  screen,
  systemPreferences,
  type BrowserWindow,
} from 'electron';
import type { ChatFile } from './contracts/chat';

// Capture only when an authenticated interview request explicitly asks for it.
// Draft image bytes remain in main-process memory; only a small preview enters
// Renderer. Explicitly sent images are archived separately for local history.
export async function captureInterviewScreenshot(
  window: BrowserWindow,
  platform: NodeJS.Platform,
  signal: AbortSignal,
): Promise<{ file: ChatFile; preview: string }> {
  const file = await captureInterviewScreen(window, platform, signal);
  const image = nativeImage.createFromBuffer(Buffer.from(file.bytes));
  const size = image.getSize();
  const ratio = Math.min(1, 240 / Math.max(size.width, size.height));
  const preview = image
    .resize({
      width: Math.max(1, Math.round(size.width * ratio)),
      height: Math.max(1, Math.round(size.height * ratio)),
      quality: 'best',
    })
    .toJPEG(75);
  signal.throwIfAborted();
  return { file, preview: `data:image/jpeg;base64,${preview.toString('base64')}` };
}

export async function captureInterviewScreen(
  window: BrowserWindow,
  platform: NodeJS.Platform,
  signal: AbortSignal,
): Promise<ChatFile> {
  signal.throwIfAborted();
  if (window.isDestroyed()) throw new DOMException('Aborted', 'AbortError');
  if (platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted')
    throw Error('请先在“设置 → 面试设置”中允许捕获屏幕，再发送截图。');
  const display = screen.getDisplayMatching(window.getBounds());
  const width = display.size.width * display.scaleFactor;
  const height = display.size.height * display.scaleFactor;
  const ratio = Math.min(1, 3840 / Math.max(width, height));
  let sources: Electron.DesktopCapturerSource[];
  try {
    sources = await new Promise<Electron.DesktopCapturerSource[]>((resolve, reject) => {
      let settled = false;
      const finish = (result: Electron.DesktopCapturerSource[] | Error, failed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (failed) reject(result);
        else resolve(result as Electron.DesktopCapturerSource[]);
      };
      const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'), true);
      const timer = setTimeout(() => finish(Error('Screen capture timed out'), true), 10000);
      signal.addEventListener('abort', abort, { once: true });
      try {
        desktopCapturer
          .getSources({
            types: ['screen'],
            thumbnailSize: { width: Math.round(width * ratio), height: Math.round(height * ratio) },
            fetchWindowIcons: false,
          })
          .then(
            (value) => finish(value, false),
            (error) => finish(error, true),
          );
      } catch (error) {
        finish(error as Error, true);
      }
    });
  } catch (error) {
    signal.throwIfAborted();
    throw Error('无法截取当前屏幕，请检查屏幕录制权限后重试。');
  }
  signal.throwIfAborted();
  if (window.isDestroyed()) throw new DOMException('Aborted', 'AbortError');
  const source =
    sources.find((item) => item.display_id === String(display.id)) ??
    (sources.length === 1 && screen.getAllDisplays().length === 1 ? sources[0] : undefined);
  if (!source || source.thumbnail.isEmpty())
    throw Error('未能获取面试窗口所在屏幕的截图，请重试。');
  // Electron can return a thumbnail larger than thumbnailSize at fractional DPI.
  let image = source.thumbnail;
  const size = image.getSize();
  const imageRatio = Math.min(1, 3840 / Math.max(size.width, size.height));
  if (imageRatio < 1)
    image = image.resize({
      width: Math.round(size.width * imageRatio),
      height: Math.round(size.height * imageRatio),
      quality: 'best',
    });
  let bytes = image.toPNG();
  let name = 'screenshot.png';
  if (bytes.byteLength > 8 * 1024 * 1024) {
    bytes = image.toJPEG(90);
    name = 'screenshot.jpg';
  }
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024)
    throw Error('当前屏幕截图过大或无效，请调整屏幕分辨率后重试。');
  signal.throwIfAborted();
  return { name, bytes: new Uint8Array(bytes) };
}
