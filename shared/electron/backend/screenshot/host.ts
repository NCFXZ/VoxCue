import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { EncodedScreenshot, ScreenshotFrame } from './worker';
import type { ChatFile } from '../../contracts/chat';

export function encodeScreenshotBitmap(
  frame: ScreenshotFrame,
  signal: AbortSignal,
): Promise<{ file: ChatFile; preview: string }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(__dirname, 'worker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'),
      {
        workerData: frame,
        transferList: [frame.bitmap],
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
