import { electron, testRoot } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const native = process.argv.includes('--native');
const prewarm = process.argv.includes('--prewarm');
const platformCapture = process.argv.includes('--platform');
assert.ok(!platformCapture || native, 'Platform capture requires the owned native desktop');
if (native)
  assert.equal(process.platform, 'win32', 'Native probe requires verified Windows screen covers');
const entry = path.join(testRoot, 'screenshot-performance.cjs');
await writeFile(
  entry,
  `
const {app, BrowserWindow, screen} = require('electron');
app.whenReady().then(async () => {
  globalThis.captureCovers = [];
  for (const display of screen.getAllDisplays()) {
    const win = new BrowserWindow({
      ...display.bounds, show:false, frame:false, fullscreen:${native},
      backgroundColor:'#345c6b',
      webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}
    });
    globalThis.captureCovers.push(win);
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<style>html{background:#345c6b;color:#f1f4f8;font:18px monospace}body{margin:32px}p{padding:6px;border-bottom:1px solid #7b98a2}h1{color:#efd9aa}</style><h1>VoxCue synthetic capture benchmark</h1>' +
      Array.from({length:60},(_,i)=>'<p>Synthetic row '+i+' / interface boundary / 0123456789 ABCDEF</p>').join('')
    ));
    win.setAlwaysOnTop(true, 'screen-saver');
    win.show();
  }
  globalThis.captureCoversReady = true;
});
`,
);
const app = await electron.launch({
  args: [await offlineElectronEntry(entry)],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
try {
  await app.firstWindow();
  const result = await app.evaluate(
    async (
      { app, BrowserWindow, screen, desktopCapturer, nativeImage },
      { native, prewarm, platformCapture },
    ) => {
      const until = performance.now() + 5000;
      while (!globalThis.captureCoversReady && performance.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 20));
      const covers = globalThis.captureCovers;
      const displays = screen.getAllDisplays();
      if (
        native &&
        (covers.length !== displays.length ||
          covers.some((win, i) => {
            const bounds = win.getBounds(),
              expected = displays[i].bounds;
            return (
              !win.isVisible() ||
              !win.isFullScreen() ||
              ['x', 'y', 'width', 'height'].some((key) => bounds[key] !== expected[key])
            );
          }))
      )
        throw Error(
          'Every display must be fully covered by an owned opaque synthetic window: ' +
            JSON.stringify({
              displays: displays.map((d) => d.bounds),
              covers: covers.map((win) => ({
                visible: win.isVisible(),
                fullscreen: win.isFullScreen(),
                bounds: win.getBounds(),
              })),
            }),
        );
      for (const win of covers)
        await win.webContents.executeJavaScript(
          'document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))',
        );
      await new Promise((resolve) => setTimeout(resolve, 150));
      const require = process
        .getBuiltinModule('node:module')
        .createRequire(app.getAppPath() + '/package.json');
      const { captureInterviewScreenshot, prepareInterviewScreenshot } = require(
        app.getAppPath() + '/dist-electron/shared/electron/screenshot.js',
      );
      const captureScreen = platformCapture
        ? require(app.getAppPath() + '/dist-electron/windows/electron/platform.js').windows
            .captureScreen
        : undefined;
      const originals = {
        sources: desktopCapturer.getSources,
        fromBuffer: nativeImage.createFromBuffer,
        fromBitmap: nativeImage.createFromBitmap,
        matching: screen.getDisplayMatching,
      };
      let events = [];
      const wrap = (image) => ({
        isEmpty: () => image.isEmpty(),
        getSize: () => image.getSize(),
        resize(options) {
          const start = performance.now();
          const resized = image.resize(options);
          events.push({ stage: 'resize', ms: performance.now() - start, size: resized.getSize() });
          return wrap(resized);
        },
        toPNG() {
          const start = performance.now();
          const bytes = image.toPNG();
          events.push({ stage: 'png', ms: performance.now() - start, bytes: bytes.length });
          return bytes;
        },
        toJPEG(quality) {
          const start = performance.now();
          const bytes = image.toJPEG(quality);
          events.push({ stage: 'jpeg', ms: performance.now() - start, bytes: bytes.length });
          return bytes;
        },
      });
      nativeImage.createFromBuffer = (bytes) => {
        const start = performance.now();
        const image = originals.fromBuffer(bytes);
        events.push({ stage: 'decode', ms: performance.now() - start });
        return wrap(image);
      };
      nativeImage.createFromBitmap = (bytes, options) => {
        const image = originals.fromBitmap(bytes, options);
        events.push({ stage: 'bitmap', size: image.getSize() });
        return wrap(image);
      };
      let synthetic;
      if (!native) {
        const width = 3840,
          height = 2160,
          bitmap = Buffer.alloc(width * height * 4);
        let seed = 73519;
        for (let i = 0; i < bitmap.length; i += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          bitmap[i] = seed & 255;
          bitmap[i + 1] = (seed >>> 8) & 255;
          bitmap[i + 2] = (seed >>> 16) & 255;
          bitmap[i + 3] = 255;
        }
        synthetic = nativeImage.createFromBitmap(bitmap, { width, height });
        screen.getDisplayMatching = () => ({ id: 1, size: { width, height }, scaleFactor: 1 });
      }
      desktopCapturer.getSources = async (options) => {
        const start = performance.now();
        const sources = native
          ? await originals.sources.call(desktopCapturer, options)
          : [{ display_id: '1', thumbnail: synthetic }];
        events.push({
          stage: 'capture',
          ms: performance.now() - start,
          count: sources.length,
          ids: sources.map(({ id, display_id }) => ({ id, display_id })),
          size: sources[0].thumbnail.getSize(),
        });
        return sources.map((source) => ({ ...source, thumbnail: wrap(source.thumbnail) }));
      };
      const runs = [];
      let prewarmMs;
      try {
        if (prewarm) {
          const start = performance.now();
          await prepareInterviewScreenshot(covers[0], process.platform);
          prewarmMs = performance.now() - start;
        }
        for (let run = 0; run < 3; run++) {
          const color = ['#345c6b', '#6b4034', '#3f6b34'][run];
          await covers[0].webContents.executeJavaScript(
            `document.documentElement.style.backgroundColor = '${color}'`,
          );
          await new Promise((resolve) => setTimeout(resolve, 150));
          events = [];
          const start = performance.now();
          const result = await captureInterviewScreenshot(
            covers[0],
            process.platform,
            new AbortController().signal,
            captureScreen,
          );
          const totalMs = performance.now() - start;
          if (native) {
            const image = originals.fromBuffer(Buffer.from(result.file.bytes));
            const size = image.getSize();
            const bitmap = image.toBitmap();
            const offset = (20 * size.width + 20) * 4;
            const expected = [color.slice(5, 7), color.slice(3, 5), color.slice(1, 3)].map(
              (value) => parseInt(value, 16),
            );
            if (expected.some((value, index) => Math.abs(bitmap[offset + index] - value) > 1))
              throw Error(
                'Capture must contain the current synthetic frame, with correct BGRA channels',
              );
          }
          runs.push({
            totalMs,
            bytes: result.file.bytes.length,
            previewBytes: result.preview.length,
            events: [...events],
          });
        }
        if (platformCapture) {
          const controller = new AbortController();
          const pending = captureInterviewScreenshot(
            covers[0],
            process.platform,
            controller.signal,
            captureScreen,
          );
          controller.abort();
          await pending.then(
            () => {
              throw Error('Cancelled capture returned pixels');
            },
            (error) => {
              if (error.name !== 'AbortError') throw error;
            },
          );
          const bounds = covers[0].getBounds();
          const overlay = new BrowserWindow({
            x: bounds.x + bounds.width - 300,
            y: bounds.y + 100,
            width: 240,
            height: 160,
            frame: false,
            show: false,
            backgroundColor: '#ff00ff',
            webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
          });
          try {
            await overlay.loadURL('data:text/html,<style>html{background:%23ff00ff}</style>');
            overlay.setAlwaysOnTop(true, 'screen-saver');
            const pixel = async () => {
              await new Promise((resolve) => setTimeout(resolve, 150));
              const result = await captureInterviewScreenshot(
                covers[0],
                process.platform,
                new AbortController().signal,
                captureScreen,
              );
              const image = originals.fromBuffer(Buffer.from(result.file.bytes));
              const size = image.getSize(),
                rect = overlay.getBounds();
              const x = Math.floor(((rect.x + 20 - bounds.x) * size.width) / bounds.width);
              const y = Math.floor(((rect.y + 20 - bounds.y) * size.height) / bounds.height);
              const pixels = image.toBitmap(),
                offset = (y * size.width + x) * 4;
              return [...pixels.subarray(offset, offset + 3)];
            };
            const behind = await pixel();
            overlay.show();
            if ((await pixel()).join(',') !== '255,0,255')
              throw Error('Unprotected synthetic overlay must be captured');
            overlay.setContentProtection(true);
            const protectedPixel = await pixel();
            if (protectedPixel.some((value, index) => Math.abs(value - behind[index]) > 1))
              throw Error(
                'Protected overlay must reveal the underlying frame, without a black patch: ' +
                  JSON.stringify({ behind, protectedPixel }),
              );
          } finally {
            overlay.destroy();
          }
        }
      } finally {
        desktopCapturer.getSources = originals.sources;
        nativeImage.createFromBuffer = originals.fromBuffer;
        nativeImage.createFromBitmap = originals.fromBitmap;
        screen.getDisplayMatching = originals.matching;
      }
      return {
        kind: native ? 'native-owned-synthetic-desktop' : 'synthetic-4k-pixels',
        platformCapture,
        currentFramesVerified: native,
        cancellationAndProtectionVerified: platformCapture,
        runtime: process.versions.electron,
        prewarmMs,
        runs,
      };
    },
    { native, prewarm, platformCapture },
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((win) => win.destroy()))
    .catch(() => {});
  await app.close().catch(() => {});
}
