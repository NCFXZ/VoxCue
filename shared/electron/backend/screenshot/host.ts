import { isMarkedAsUntransferable, Worker } from 'node:worker_threads';
import path from 'node:path';
import type { EncodedScreenshot, ScreenshotFrame } from './worker';
import type { ChatFile } from '../../contracts/chat';

type CaptureFrame = Omit<ScreenshotFrame, 'bitmap'> & { bitmap: ArrayBuffer | Uint8Array };

export function transferableScreenshotPixels(bitmap: CaptureFrame['bitmap']) {
  const view = ArrayBuffer.isView(bitmap) ? bitmap : new Uint8Array(bitmap);
  const backing = view.buffer;
  // NativeImage.toBitmap() produces fresh pixels. Never detach a slice, a pool,
  // shared memory or an allocation the host marks as non-transferable.
  if (backing instanceof ArrayBuffer && view.byteOffset === 0 && view.byteLength === backing.byteLength &&
      typeof isMarkedAsUntransferable === 'function' && !isMarkedAsUntransferable(backing)) return backing;
  return new Uint8Array(view).buffer;
}

export function encodeScreenshotBitmap(
  frame: CaptureFrame,
  signal: AbortSignal,
): Promise<{ file: ChatFile; preview: string }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const bitmap = transferableScreenshotPixels(frame.bitmap);
    const worker = new Worker(
      path.join(__dirname, 'worker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'),
      {
        workerData: { ...frame, bitmap },
        transferList: [bitmap],
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      },
    );
    let settled = false;
    const finish = (error?: Error, value?: { file: ChatFile; preview: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      // Keep the task's resource reservation until native encoding has retired.
      void worker.terminate().then(
        () => { if (error) reject(error); else resolve(value!); },
        () => reject(error ?? Error('无法处理截图，请重试。')),
      );
    };
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(Error('截图处理超时，请重试。')), 15000);
    worker.once('message', (value: EncodedScreenshot & { error?: unknown }) => {
      if (signal.aborted) return abort();
      if (typeof value?.error === 'string') return finish(Error(value.error));
      if (
        !['screenshot.png', 'screenshot.jpg'].includes(value?.file?.name) ||
        !(value.file.bytes instanceof Uint8Array) ||
        !value.file.bytes.byteLength ||
        value.file.bytes.byteLength > 8 * 1024 * 1024 ||
        !(value.preview instanceof Uint8Array) ||
        !value.preview.byteLength ||
        value.preview.byteLength > 256 * 1024
      )
        return finish(Error('无法处理截图，请重试。'));
      finish(undefined, {
        file: value.file,
        preview: `data:image/jpeg;base64,${Buffer.from(value.preview).toString('base64')}`,
      });
    });
    worker.once('error', () => finish(Error('无法处理截图，请重试。')));
    worker.once('exit', () => finish(Error('无法处理截图，请重试。')));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
