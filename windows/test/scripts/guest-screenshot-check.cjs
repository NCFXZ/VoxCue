const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { app, BrowserWindow, nativeImage, screen } = require('electron');

const execute = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const webPreferences = { sandbox: true, nodeIntegration: false, contextIsolation: true };

module.exports = async function checkGuestCapture(load, helper) {
  assert.equal(os.userInfo().username.toLowerCase(), 'wdagutilityaccount');
  assert.equal(os.homedir().toLowerCase(), 'c:\\users\\wdagutilityaccount');
  assert.equal(path.dirname(__filename).toLowerCase(), 'c:\\voxcuestoreinput');
  assert.equal(path.basename(helper), 'VoxCue.Screenshot.exe');
  const { captureInterviewScreenshot } = load('./dist-electron/shared/electron/screenshot.js');
  const { encodeScreenshotBitmap } = load(
    './dist-electron/shared/electron/backend/screenshot/host.js',
  );
  const covers = [];
  let overlay;
  let step = 'initializing',
    paint = 'background';
  function captureStep(name) {
    step = name;
  }
  function covered() {
    const displays = screen.getAllDisplays();
    assert.equal(covers.length, displays.length);
    for (const { displayId, win } of covers) {
      assert.ok(win.isVisible(), 'hidden-cover');
      assert.ok(win.isFullScreen(), 'non-fullscreen-cover');
      assert.ok(win.isAlwaysOnTop(), 'non-topmost-cover');
      assert.equal(win.getOpacity(), 1, 'translucent-cover');
      const bounds = displays.find((d) => d.id === displayId)?.bounds;
      assert.deepEqual(win.getBounds(), bounds, 'wrong-cover-bounds');
      assert.deepEqual(win.getContentBounds(), bounds, 'wrong-content-bounds');
    }
  }
  async function readMonitor(win, signal) {
    captureStep('cover-before-capture');
    covered();
    assert.ok(covers.some((cover) => cover.win === win));
    const handle = win.getNativeWindowHandle().readBigUInt64LE().toString();
    captureStep('helper-execute');
    const { stdout } = await execute(helper, [handle], {
      windowsHide: true,
      encoding: 'buffer',
      signal,
      timeout: 10000,
      maxBuffer: 3840 * 3840 * 4 + 8,
    });
    captureStep('cover-after-capture');
    covered();
    captureStep('helper-frame');
    const width = stdout.readUInt32LE(0),
      height = stdout.readUInt32LE(4);
    assert.ok(width > 0 && height > 0 && width <= 3840 && height <= 3840);
    assert.equal(stdout.length, 8 + width * height * 4);
    const image = nativeImage.createFromBitmap(stdout.subarray(8), { width, height });
    captureStep('encoding');
    return image;
  }
  try {
    // Verification still needs to write its result after destroying the last test window.
    app.once('window-all-closed', () => {});
    for (const display of screen.getAllDisplays()) {
      captureStep('create-cover');
      const win = new BrowserWindow({
        ...display.bounds,
        show: false,
        frame: false,
        fullscreen: true,
        enableLargerThanScreen: true,
        backgroundColor: '#345c6b',
        webPreferences,
      });
      covers.push({ displayId: display.id, win });
      captureStep('cover-navigation');
      await win.loadURL('data:text/html,<style>html{background:%23345c6b}</style>');
      win.setAlwaysOnTop(true, 'screen-saver');
      win.show();
    }
    assert.ok(covers.length, 'Missing guest display');
    const target = covers[0].win;
    target.focus();
    const capture = (signal = new AbortController().signal) =>
      captureInterviewScreenshot(target, 'win32', signal, encodeScreenshotBitmap, readMonitor);
    async function checkPixels(rgb, paintedWindow = target) {
      captureStep('paint');
      await paintedWindow.webContents.executeJavaScript(
        'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))',
      );
      // A renderer paint precedes DWM's presentation of the redirected guest surface.
      // Re-read the real helper until the three selected points show the requested frame.
      const until = performance.now() + 3000;
      do {
        const { file } = await capture();
        captureStep('compare-pixels');
        const image = nativeImage.createFromBuffer(Buffer.from(file.bytes));
        const { width, height } = image.getSize(),
          pixels = image.toBitmap();
        assert.ok(width > 0 && height > 0 && pixels.length === width * height * 4);
        if (
          [0.4, 0.5, 0.6].every((fraction) => {
            const offset = 4 * (Math.floor(height / 2) * width + Math.floor(width * fraction));
            return rgb.every(
              (value, channel) => Math.abs(pixels[offset + 2 - channel] - value) <= 1,
            );
          })
        )
          return;
        await wait(100);
      } while (performance.now() < until);
      throw Error('guest-frame-color-mismatch');
    }
    const colors = [
      [52, 92, 107],
      [107, 64, 52],
      [63, 107, 52],
    ];
    for (const [index, rgb] of colors.entries()) {
      paint = 'color-' + index;
      captureStep('paint');
      await target.webContents.executeJavaScript(
        `document.documentElement.style.backgroundColor = 'rgb(${rgb.join(',')})'`,
      );
      await checkPixels(rgb);
    }
    const controller = new AbortController();
    paint = 'cancel';
    const pending = capture(controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });

    // The center stripe of the magenta window must disappear from the helper's frame.
    paint = 'overlay-visible';
    captureStep('create-overlay');
    const bounds = target.getBounds();
    overlay = new BrowserWindow({
      parent: target,
      x: bounds.x + Math.floor(bounds.width / 4),
      y: bounds.y + Math.floor(bounds.height / 4),
      width: Math.floor(bounds.width / 2),
      height: Math.floor(bounds.height / 2),
      show: false,
      frame: false,
      focusable: false,
      backgroundColor: '#ff00ff',
      webPreferences,
    });
    await overlay.loadURL('data:text/html,<style>html{background:%23ff00ff}</style>');
    overlay.setAlwaysOnTop(true, 'screen-saver');
    // An independent foreground window lets Windows restore the fullscreen
    // owner's bounds on blur. Paint this owned overlay without activating it.
    overlay.showInactive();
    assert.equal(overlay.getParentWindow(), target);
    assert.ok(target.isFocused() && !overlay.isFocused(), 'cover-lost-focus');
    await checkPixels([255, 0, 255], overlay);
    overlay.setContentProtection(true);
    paint = 'overlay-protected';
    await checkPixels(colors.at(-1), overlay);
  } catch (error) {
    // Share only fixed operation names. Never emit screen contents or raw child output.
    error.guestCaptureStep = paint + '-' + step;
    throw error;
  } finally {
    overlay?.destroy();
    for (const { win } of covers) win.destroy();
  }
};
