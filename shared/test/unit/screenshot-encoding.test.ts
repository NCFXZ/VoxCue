import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import sharp from 'sharp';
import type { encodeScreenshotBitmap } from '../../electron/backend/screenshot/host';

let directory: string;
let encode: typeof encodeScreenshotBitmap;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'voxcue-screenshot-worker-'));
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  for (const name of ['host', 'worker']) {
    const source = await readFile(
      path.resolve('../shared/electron/backend/screenshot', name + '.ts'),
      'utf8',
    );
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      })
      .outputText.replace(
        'require("sharp")',
        `require(${JSON.stringify(require.resolve('sharp'))})`,
      );
    await writeFile(path.join(directory, name + '.js'), compiled);
  }
  encode = require(path.join(directory, 'host.js')).encodeScreenshotBitmap;
});
afterAll(async () => {
  if (!directory) return;
  if (
    path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) ||
    !path.basename(directory).startsWith('voxcue-screenshot-worker-')
  )
    throw Error('Unexpected screenshot fixture directory');
  await rm(directory, { recursive: true, force: true });
});

function frame(width: number, height: number, random = false) {
  const bitmap = new ArrayBuffer(width * height * 4);
  const pixels = new Uint8Array(bitmap);
  let seed = 7153;
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = random ? seed & 255 : 10;
    pixels[i + 1] = random ? (seed >>> 8) & 255 : 30;
    pixels[i + 2] = random ? (seed >>> 16) & 255 : 200;
    pixels[i + 3] = 255;
  }
  return { width, height, bitmap };
}

it('encodes transferred BGRA losslessly as PNG and returns only a bounded JPEG preview', async () => {
  const input = frame(64, 32);
  const pixels = new Uint8Array(input.bitmap);
  pixels.set([10, 20, 50, 128]);
  const result = await encode(input, new AbortController().signal);
  expect(input.bitmap.byteLength).toBe(0);
  expect(result.file.name).toBe('screenshot.png');
  const decoded = await sharp(result.file.bytes).raw().toBuffer({ resolveWithObject: true });
  expect(decoded.info).toMatchObject({ width: 64, height: 32, channels: 4 });
  expect([...decoded.data.subarray(0, 8)]).toEqual([100, 40, 20, 128, 200, 30, 10, 255]);
  const preview = Buffer.from(result.preview.split(',')[1], 'base64');
  expect(await sharp(preview).metadata()).toMatchObject({ width: 64, height: 32, format: 'jpeg' });
});

it('resizes oversized native pixels in the worker and leaves the main event loop available', async () => {
  const input = frame(4000, 20);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    const result = await encode(input, new AbortController().signal);
    expect(ticks).toBeGreaterThan(0);
    expect(await sharp(result.file.bytes).metadata()).toMatchObject({ width: 3840, height: 19 });
    const preview = await sharp(Buffer.from(result.preview.split(',')[1], 'base64')).metadata();
    expect(Math.max(preview.width!, preview.height!)).toBe(240);
  } finally {
    clearInterval(timer);
  }
});

it('uses the existing JPEG fallback only when a lossless 4K image exceeds 8 MiB', async () => {
  const result = await encode(frame(3840, 2160, true), new AbortController().signal);
  expect(result.file.name).toBe('screenshot.jpg');
  expect(result.file.bytes.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(await sharp(result.file.bytes).metadata()).toMatchObject({
    width: 3840,
    height: 2160,
    format: 'jpeg',
  });
}, 20000);

it('terminates a cancelled encoding and rejects malformed pixel buffers explicitly', async () => {
  const controller = new AbortController();
  const pending = encode(frame(3840, 2160), controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await expect(
    encode({ width: 2, height: 2, bitmap: new ArrayBuffer(1) }, new AbortController().signal),
  ).rejects.toThrow('过大或无效');
});

it('does not release a cancelled task before its worker has retired', async () => {
  const terminate = Worker.prototype.terminate;
  let release!: () => void;
  let retired!: () => void;
  const retirement = new Promise<void>((resolve) => { retired = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const spy = vi.spyOn(Worker.prototype, 'terminate').mockImplementation(function (this: Worker) {
    return terminate.call(this).then(async (code) => { retired(); await gate; return code; });
  });
  const controller = new AbortController();
  let state = 'pending';
  const pending = encode(frame(64, 32), controller.signal).then(
    () => { state = 'resolved'; },
    (error) => { state = error.name; },
  );
  try {
    controller.abort();
    await retirement;
    expect(state).toBe('pending');
    release();
    await pending;
    expect(state).toBe('AbortError');
  } finally { release(); spy.mockRestore(); await pending; }
});

it('bounds native memory across repeated real encodings and retires failures, cancellation and a stalled worker', async () => {
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const check = require(path.resolve('../shared/test/scripts/screenshot-worker-checks.cjs'));
  const result = await check({
    hostPath: path.join(directory, 'host.js'),
    sharpPath: require.resolve('sharp'),
  });
  expect(result.encodings).toBe(23);
  expect(result.created).toBe(27);
  expect(result.exited).toBe(result.created);
  expect(require('node:worker_threads').Worker).toBe(Worker);
}, 45000);
