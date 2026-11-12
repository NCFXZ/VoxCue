import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import type { ChatFile } from '../../contracts/chat';

export interface ScreenshotFrame {
  width: number;
  height: number;
  bitmap: ArrayBuffer;
}
export interface EncodedScreenshot {
  file: ChatFile;
  preview: Uint8Array;
}
const tooLarge = '当前屏幕截图过大或无效，请调整屏幕分辨率后重试。';

/** NativeImage supplies premultiplied BGRA pixels on the supported LE platforms. */
export async function encodeScreenshotFrame(frame: ScreenshotFrame): Promise<EncodedScreenshot> {
  const { width, height, bitmap } = frame;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 64 * 1024 * 1024 ||
    !(bitmap instanceof ArrayBuffer) ||
    bitmap.byteLength !== width * height * 4
  )
    throw Error(tooLarge);
  const pixels = new Uint8Array(bitmap);
  for (let i = 0; i < pixels.length; i += 4) {
    const blue = pixels[i],
      red = pixels[i + 2],
      alpha = pixels[i + 3];
    pixels[i] = red;
    pixels[i + 2] = blue;
    if (alpha && alpha < 255) {
      const scale = 255 / alpha;
      pixels[i] = Math.min(255, Math.round(red * scale));
      pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * scale));
      pixels[i + 2] = Math.min(255, Math.round(blue * scale));
    }
  }
  sharp.cache(false);
  sharp.concurrency(1);
  const image = sharp(Buffer.from(bitmap), { raw: { width, height, channels: 4 } });
  const ratio = Math.min(1, 3840 / Math.max(width, height));
  const boundedWidth = Math.max(1, Math.round(width * ratio));
  const boundedHeight = Math.max(1, Math.round(height * ratio));
  if (ratio < 1) image.resize(boundedWidth, boundedHeight, { kernel: 'lanczos3' });
  let bytes = await image.clone().png().toBuffer();
  let name = 'screenshot.png';
  if (bytes.byteLength > 8 * 1024 * 1024) {
    bytes = await image.clone().jpeg({ quality: 90 }).toBuffer();
    name = 'screenshot.jpg';
  }
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw Error(tooLarge);
  const previewRatio = Math.min(1, 240 / Math.max(boundedWidth, boundedHeight));
  const preview = await image
    .clone()
    .resize(
      Math.max(1, Math.round(boundedWidth * previewRatio)),
      Math.max(1, Math.round(boundedHeight * previewRatio)),
      { kernel: 'lanczos3' },
    )
    .jpeg({ quality: 75 })
    .toBuffer();
  return { file: { name, bytes: new Uint8Array(bytes) }, preview: new Uint8Array(preview) };
}

if (!isMainThread) {
  void encodeScreenshotFrame(workerData)
    .then(
      (result) =>
        parentPort!.postMessage(result, [
          result.file.bytes.buffer as ArrayBuffer,
          result.preview.buffer as ArrayBuffer,
        ]),
      (error) =>
        parentPort!.postMessage({
          error:
            error instanceof Error && error.message === tooLarge
              ? tooLarge
              : '无法处理截图，请重试。',
        }),
    )
    .finally(() => parentPort!.close());
}
