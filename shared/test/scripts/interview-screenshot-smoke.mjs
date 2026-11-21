import { evaluateHistory } from './stored-history-fixture.mjs';
import { connectUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { verifyContinuousCorners, cornerShapeNames } from './continuous-corners.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import workspace from '../../scripts/workspace.mjs';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(
  path.resolve(path.join(testRoot, 'test/results/interview-screenshot-ui-')),
);
const screenshotDirectory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
const nativeSaveHits = process.platform === 'win32' && process.argv.includes('--native-hits');
assert.ok(
  process.argv.slice(2).every(arg => arg.startsWith('--screenshots=') || (nativeSaveHits && arg === '--native-hits')),
  'Native capture uses screenshot-performance.mjs with owned full-screen covers',
);
if (screenshotDirectory) await mkdir(path.resolve(screenshotDirectory), { recursive: true });
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
let entry = '.';
if (process.platform === 'win32') {
  const fixture = path.join(testRoot, 'screenshot-platform-fixture.cjs');
  await writeFile(
    fixture,
    `
const {desktopCapturer} = require('electron');
desktopCapturer.getSources = async () => { throw Error('Synthetic screenshot source is not installed'); };
const platform = require(${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/windows/electron/platform.js'))}).windows;
platform.captureScreen = async (_window, signal) => {
  signal.throwIfAborted();
  const sources = await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:3840,height:2160},fetchWindowIcons:false});
  signal.throwIfAborted();
  return sources[0].thumbnail;
};
require(${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/shared/electron/main.js'))});
`,
  );
  entry = await offlineElectronEntry(fixture);
}
const app = await electron.launch({ args: [entry], env });
async function checkMouseWheelZoom(page, viewer) {
  const canvas = viewer.locator('.interview-image-canvas');
  await canvas.hover();
  await page.mouse.wheel(0, -100);
  await viewer.locator('.interview-image-canvas[data-zoomed]').waitFor();
  await page.mouse.wheel(0, 200);
  await viewer.locator('.interview-image-canvas:not([data-zoomed])').waitFor();
}
const errors = [],
  checks = [];
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app, globalShortcut }) => {
    globalThis.screenshotShortcuts = new Map();
    globalShortcut.register = (key, callback) => {
      globalThis.screenshotShortcuts.set(key, callback);
      return true;
    };
    globalShortcut.unregister = (key) => globalThis.screenshotShortcuts.delete(key);
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { SpeechHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/speech/host.js',
    );
    const { ChatGPTService, buildInput } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const crypto = require('node:crypto');
    globalThis.screenshotRequests = [];
    globalThis.screenshotFixture = { count: 0, mode: 'normal', providerMode: 'normal' };
    SpeechHost.prototype.call = async function (call) {
      globalThis.screenshotSpeech = (event) => this.emit(event);
      const status = {
        state: call.op === 'start' ? 'running' : 'idle',
        model: 'Synthetic speech',
        devices: [],
      };
      this.emit({ type: 'status', status });
      return status;
    };
    ChatGPTService.prototype.stream = async (request, emit) => {
      if (request.id.startsWith('history-title-'))
        return { answerText: '截图面试记录', usage: null, sources: [] };
      const input = buildInput(request);
      const images = input.flatMap((turn) =>
        Array.isArray(turn.content)
          ? turn.content.filter((item) => item.type === 'input_image')
          : [],
      );
      const record = {
        id: request.id,
        instructions: request.instructions,
        knowledgeBaseId: request.knowledgeBaseId,
        turns: request.turns.map((turn) => ({
          role: turn.role,
          content: turn.content,
          files: turn.files?.map((file) => ({
            name: file.name,
            bytes: file.bytes.byteLength,
            hash: crypto.createHash('sha256').update(file.bytes).digest('hex'),
          })),
        })),
        imageInputs: images.length,
        imageFormat: images[0]?.image_url.startsWith('data:image/png;base64,'),
      };
      globalThis.screenshotRequests.push(record);
      if (globalThis.screenshotFixture.providerMode === 'fail') {
        emit({ id: request.id, type: 'delta', text: '合成未完成回答' });
        throw Error('当前模型不支持图片输入');
      }
      if (globalThis.screenshotFixture.providerMode === 'question-motion') {
        let answerText = '';
        const append = text => {
          answerText += text;
          emit({ id: request.id, type: 'delta', text });
        };
        globalThis.screenshotFixture.appendReply = append;
        append('回答第一段。');
        await new Promise(resolve => { globalThis.screenshotFixture.finishReply = resolve; });
        append('\n\n回答第二段。');
        return { answerText, usage: null, sources: [] };
      }
      const answerText = '截图回归回答 ' + globalThis.screenshotRequests.length;
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, usage: null, sources: [] };
    };
  });
  const login = await app.firstWindow();
  const main = await connectUiAccount(app, login);
  main.setDefaultTimeout(20000);
  const sidebarLogo = main.locator('.sidebar-wordmark .app-logo');
  await sidebarLogo.waitFor();
  assert.equal(await sidebarLogo.getAttribute('width'), '24');
  const brandBounds = await main.locator('.sidebar-heading').evaluate((heading) => {
    const brand = heading.querySelector('.sidebar-wordmark').getBoundingClientRect();
    const control = heading.querySelector('button').getBoundingClientRect();
    const logo = getComputedStyle(heading.querySelector('.app-logo'));
    return {
      gap: control.left - brand.right,
      width: parseFloat(logo.width),
      height: parseFloat(logo.height),
    };
  });
  assert.ok(brandBounds.gap >= 0);
  assert.equal(brandBounds.width, 24);
  assert.equal(brandBounds.height, 24);
  const logoSource = await sidebarLogo.getAttribute('src');
  await app.evaluate(({ desktopCapturer }) => {
    globalThis.screenshotPreparation = 0;
    desktopCapturer.getSources = (options) => {
      if (options.thumbnailSize?.width === 0 && options.thumbnailSize?.height === 0) {
        globalThis.screenshotPreparation++;
        return Promise.resolve([]);
      }
      throw Error('Unexpected screenshot before the synthetic source was installed');
    };
  });
  await main.locator('.interview-start-trigger').click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    main
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  floating.setDefaultTimeout(20000);
  assert.equal(
    await app.evaluate(() => globalThis.screenshotPreparation),
    process.platform === 'win32' ? 0 : 1,
    'Only the Electron fallback prepares screen metadata; native capture needs no warmup',
  );
  assert.equal(
    await floating.locator('.floating-toolbar .app-logo').getAttribute('src'),
    logoSource,
  );
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.getByRole('status', { name: '语音模型：正常', exact: true }).waitFor();
  await floating.waitForFunction(() =>
    document.documentElement.classList.contains('web-materials'),
  );
  await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  await app.evaluate(
    ({ desktopCapturer, screen, nativeImage, BrowserWindow, systemPreferences }) => {
      const mediaStatus = systemPreferences.getMediaAccessStatus.bind(systemPreferences);
      systemPreferences.getMediaAccessStatus = (type) =>
        type === 'screen' ? 'granted' : mediaStatus(type);
      desktopCapturer.getSources = async (options) => {
        const fixture = globalThis.screenshotFixture;
        fixture.count++;
        fixture.options = options;
        if (fixture.mode === 'fail') throw Error('Synthetic capture failure');
        if (fixture.mode === 'hold')
          await new Promise((resolve) => {
            fixture.finish = resolve;
          });
        const pixels = Buffer.alloc(4 * 4 * 4);
        for (let i = 0; i < pixels.length; i += 4) {
          // Include bright and dark screenshots when inspecting overlay controls.
          pixels[i] = fixture.count === 1 ? 255 : fixture.count === 2 ? 0 : fixture.count * 25;
          pixels[i + 1] = fixture.count === 1 ? 255 : fixture.count === 2 ? 0 : 100;
          pixels[i + 2] = fixture.count === 1 ? 255 : fixture.count === 2 ? 0 : 180;
          pixels[i + 3] = 255;
        }
        const window = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().endsWith('#interview'),
        );
        return [
          {
            id: 'screen:fixture',
            display_id: String(screen.getDisplayMatching(window.getBounds()).id),
            thumbnail: nativeImage.createFromBitmap(pixels, { width: 4, height: 4 }),
          },
        ];
      };
    },
  );
  assert.equal(
    await floating.getByRole('button', { name: '发送题目时附当前截图', exact: true }).count(),
    0,
  );
  const camera = floating.getByRole('button', { name: '截取图像', exact: true });
  assert.equal(await camera.locator('.floating-screenshot-text').innerText(), '截图');
  assert.equal(await floating.locator('.floating-composer-options').getByRole('status').count(), 0);
  const verifyCameraContent = async () => {
    const geometry = await camera.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const children = [...button.children].filter((child) => {
        const style = getComputedStyle(child);
        return !child.hidden && style.display !== 'none' && child.getBoundingClientRect().width > 0;
      });
      const first = children[0].getBoundingClientRect();
      const last = children.at(-1).getBoundingClientRect();
      return { left: first.left - box.left, right: box.right - last.right, height: box.height };
    });
    assert.equal(Math.round(geometry.height * 64) / 64, 26);
    assert.ok(geometry.left >= 5 && geometry.right >= 5, JSON.stringify(geometry));
    assert.ok(geometry.left <= 16 && geometry.right <= 16, 'Keep screenshot padding compact: ' + JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.left - geometry.right) < 1, 'Screenshot content is centered');
  };
  const shortcut = 'Control+Shift+s';
  const pressScreenshot = () =>
    app.evaluate(() => {
      const capture = globalThis.screenshotShortcuts.get('Control+Shift+S');
      if (!capture) throw Error('Global screenshot registration is missing');
      capture();
    });
  assert.equal(
    await camera.locator('kbd').innerText(),
    process.platform === 'darwin' ? '⌃⇧S' : 'Ctrl+Shift+S',
  );
  assert.equal(await camera.getAttribute('aria-keyshortcuts'), 'Control+Shift+S');
  const send = floating.getByRole('button', { name: '发送面试问题', exact: true });
  const input = floating.getByRole('textbox', { name: '面试提问', exact: true });
  const previews = floating.locator('.floating-screenshot-preview');
  await floating.evaluate(() => {
    window.syntheticScreenshotEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'click'])
      document.addEventListener(
        type,
        (event) => {
          const button = event.target.closest?.('button');
          if (button)
            window.syntheticScreenshotEvents.push({
              type,
              label: button.getAttribute('aria-label') ?? button.innerText.trim(),
              at: performance.now(),
            });
          window.syntheticScreenshotEvents = window.syntheticScreenshotEvents.slice(-30);
        },
        true,
      );
  });
  const capture = async (name) => {
    if (screenshotDirectory)
      await floating.screenshot({
        path: path.join(path.resolve(screenshotDirectory), name + '.png'),
        animations: 'disabled',
        scale: 'css',
      });
  };
  const requests = () => app.evaluate(() => globalThis.screenshotRequests);
  const captured = () => app.evaluate(() => globalThis.screenshotFixture.count);
  const waitCount = async (count) => {
    await floating.waitForFunction(
      (count) => document.querySelectorAll('.floating-screenshot-preview').length === count,
      count,
    );
    await camera.getByText(count + '/5', { exact: true }).waitFor({ state: 'attached' });
    await floating.waitForFunction(
      () =>
        !document
          .querySelector('.floating-screenshot-button')
          .getAnimations()
          .some((animation) => animation.playState === 'running'),
    );
    const shape = await camera.evaluate((button) => ({
      iconOnly: button.classList.contains('button-icon'),
      radius: getComputedStyle(button).borderTopLeftRadius,
      corner: getComputedStyle(button).cornerShape,
      height: Math.round(button.getBoundingClientRect().height * 100) / 100,
      overflow: button.scrollWidth > button.clientWidth + 1,
    }));
    assert.equal(shape.height, 26);
    assert.equal(shape.overflow, false);
    assert.equal(shape.iconOnly, false);
    assert.equal(shape.radius, '999px');
    assert.equal(cornerShapeNames(shape.corner), 'round');
    assert.equal(await camera.locator('kbd').isVisible(), count === 0);
    await verifyCameraContent();
  };
  const waitAnswer = async (count) => {
    await floating.getByText('截图回归回答 ' + count, { exact: true }).waitFor();
    return (await requests()).at(-1);
  };
  await verifyCameraContent();
  await floating.evaluate(() => {
    for (const extra of [
      { shiftKey: false },
      { ctrlKey: false },
      { altKey: true },
      { metaKey: true },
      { repeat: true },
      { isComposing: true },
      { handled: true },
    ]) {
      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      if (extra.handled) event.preventDefault();
      document.activeElement.dispatchEvent(event);
    }
  });
  assert.equal(
    await captured(),
    0,
    'Renderer-only synthetic key events cannot bypass global shortcut ownership',
  );
  await main.keyboard.press(shortcut);
  assert.equal(await captured(), 0, 'Renderer-only events on the main page do not invoke the global callback');
  await floating.locator('.floating-brand').evaluate((button) => button.click());
  await floating.waitForFunction(
    () =>
      document.querySelector('.floating-shell').classList.contains('is-collapsed') &&
      !document.querySelector('.floating-shell').dataset.panelMotion,
  );
  await floating.keyboard.press(shortcut);
  assert.equal(await captured(), 0, 'Renderer-only events while collapsed do not invoke the global callback');
  await floating.locator('.floating-brand').evaluate((button) => button.click());
  await floating.waitForFunction(
    () =>
      !document.querySelector('.floating-shell').classList.contains('is-collapsed') &&
      !document.querySelector('.floating-shell').dataset.panelMotion,
  );
  await input.fill('解释这些截图，先保留我的草稿');
  await app.evaluate(() => {
    globalThis.screenshotFixture.mode = 'hold';
  });
  await input.press('Control+Alt+Shift+s');
  assert.equal(await captured(), 0, 'Extra modifiers must not trigger the screenshot shortcut');
  await input.press('Alt+s');
  assert.equal(await captured(), 0, 'The old screenshot shortcut must not capture');
  await pressScreenshot();
  await floating.waitForFunction(
    () =>
      document.querySelector('.floating-screenshot-button').getAttribute('aria-busy') === 'true',
  );
  await floating.waitForFunction(
    () =>
      !document
        .querySelector('.floating-screenshot-button')
        .getAnimations()
        .some((animation) => animation.playState === 'running'),
  );
  assert.equal(await camera.isDisabled(), true);
  assert.deepEqual(
    cornerShapeNames(
      await camera.evaluate((button) => ({
        height: Math.round(button.getBoundingClientRect().height),
        iconOnly: button.classList.contains('button-icon'),
        radius: getComputedStyle(button).borderTopLeftRadius,
        corner: getComputedStyle(button).cornerShape,
      })),
    ),
    {
      height: 26,
      iconOnly: false,
      radius: '999px',
      corner: 'round',
    },
  );
  const busyCaptures = await captured();
  await pressScreenshot();
  assert.equal(await captured(), busyCaptures, 'Shortcut obeys the busy button guard');
  await app.evaluate(() => {
    globalThis.screenshotFixture.mode = 'normal';
    globalThis.screenshotFixture.finish();
  });
  await waitCount(1);
  assert.equal(await input.inputValue(), '解释这些截图，先保留我的草稿');
  assert.equal((await requests()).length, 0);
  assert.equal(await captured(), 1);
  await verifyCameraContent();
  assert.equal(
    await previews
      .locator('img')
      .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
    true,
  );
  for (let count = 2; count <= 5; count++) {
    await camera.click();
    await waitCount(count);
  }
  assert.equal(await camera.isDisabled(), true);
  const removeSize = await floating
    .getByRole('button', { name: '移除截图 1', exact: true })
    .boundingBox();
  assert.ok(removeSize.width <= 24 && removeSize.height <= 24);
  const remove = floating.getByRole('button', { name: '移除截图 1', exact: true });
  const removeStyle = await remove.evaluate((node) => {
    const style = getComputedStyle(node);
    return { fill: style.backgroundColor, color: style.color, shadow: style.boxShadow };
  });
  assert.equal(removeStyle.fill, 'rgb(52, 58, 62)');
  assert.equal(removeStyle.color, 'rgb(255, 255, 255)');
  assert.notEqual(removeStyle.shadow, 'none');
  assert.equal(await captured(), 5);
  await pressScreenshot();
  assert.equal(await captured(), 5, 'The five-image limit also rejects the keyboard shortcut');
  await capture('five-staged-images');
  assert.equal((await requests()).length, 0);
  await floating.getByRole('button', { name: '移除截图 2', exact: true }).click();
  await waitCount(4);
  await camera.click();
  await waitCount(5);
  const resize = floating.getByRole('button', { name: '拖动右下角调整尺寸', exact: true });
  for (let i = 0; i < 4; i++) await resize.press('ArrowDown');
  for (const theme of ['light', 'dark']) {
    await floating.emulateMedia({ colorScheme: theme });
    assert.equal(
      await floating.locator('html').evaluate((e) => e.classList.contains('dark')),
      true,
    );
    const bounds = await floating.locator('.floating-composer').evaluate((node) => {
      const form = node.getBoundingClientRect(),
        options = node.querySelector('.floating-composer-options').getBoundingClientRect(),
        actions = node.querySelector('.floating-composer-actions').getBoundingClientRect();
      return {
        left: options.left - form.left,
        right: form.right - actions.right,
        gap: actions.left - options.right,
      };
    });
    assert.ok(bounds.left >= 0 && bounds.right >= 0 && bounds.gap > 0);
  }
  await send.click();
  const multi = await waitAnswer(1);
  await waitCount(0);
  assert.equal(multi.imageInputs, 5);
  assert.equal(multi.turns.at(-1).content, '解释这些截图，先保留我的草稿');
  assert.equal(new Set(multi.turns.at(-1).files.map((file) => file.hash)).size, 5);
  assert.equal(await captured(), 6);
  const sentImages = floating.locator('.floating-question .interview-image-thumbnail');
  assert.equal(await sentImages.count(), 5, 'Sent thumbnails stay inside the question bubble');
  await sentImages.first().click();
  const liveViewer = floating.getByRole('dialog', { name: '截图', exact: true });
  await liveViewer.locator('.interview-image-canvas img').waitFor();
  await checkMouseWheelZoom(floating, liveViewer);
  const viewerCaptures = await captured();
  await liveViewer.press(shortcut);
  assert.equal(await captured(), viewerCaptures, 'Viewer keyboard input must not capture again');
  const overlays = await liveViewer.evaluate((viewer) =>
    ['.is-previous', '.is-next', '.interview-image-position'].map((selector) => {
      const node = viewer.querySelector(selector);
      const style = getComputedStyle(node);
      return {
        fill: style.backgroundColor,
        filter: style.backdropFilter,
        opacity: style.opacity,
        border: style.borderTopColor,
        iconOpacity: node.querySelector('svg')
          ? getComputedStyle(node.querySelector('svg')).opacity
          : null,
      };
    }),
  );
  for (const overlay of overlays) {
    assert.equal(overlay.border, 'rgba(0, 0, 0, 0)');
    assert.equal(overlay.opacity, '1', 'Disabled navigation must not fade its glass backing');
    assert.equal(overlay.fill, overlays[2].fill);
    assert.equal(overlay.filter, overlays[2].filter);
  }
  assert.equal(overlays[0].iconOpacity, '0.42');
  assert.equal(overlays[1].iconOpacity, '1');
  await liveViewer.locator('.is-next').hover();
  assert.equal(
    await liveViewer.locator('.is-next').evaluate((node) => getComputedStyle(node).borderTopColor),
    'rgba(0, 0, 0, 0)',
  );
  await capture('borderless-image-viewer');
  assert.equal(
    await liveViewer.getByRole('button', { name: '上一张截图', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await liveViewer.getAttribute('data-backdrop'), 'transparent');
  assert.deepEqual(
    await liveViewer.evaluate((node) => {
      const style = getComputedStyle(node, '::backdrop');
      return { fill: style.backgroundColor, filter: style.backdropFilter };
    }),
    { fill: 'rgba(0, 0, 0, 0)', filter: 'none' },
  );
  assert.equal(await liveViewer.getByRole('button', { name: '保存图片', exact: true }).count(), 0);
  await liveViewer.press('ArrowRight');
  assert.equal(
    await liveViewer.getByRole('button', { name: '上一张截图', exact: true }).isEnabled(),
    true,
  );
  assert.equal(
    await liveViewer.locator('.is-previous > svg').evaluate((e) => getComputedStyle(e).opacity),
    '1',
  );
  await liveViewer
    .locator('.interview-image-position')
    .getByText('2 / 5', { exact: true })
    .waitFor();
  await liveViewer.press('Escape');
  await liveViewer.waitFor({ state: 'hidden' });
  checks.push(
    'capture stages previews without sending; count expands through 5/5, remove/add works, manual send uses all five original images',
  );
  await input.fill('纯文字问题');
  await send.click();
  const text = await waitAnswer(2);
  assert.equal(text.imageInputs, 0);
  assert.equal(await captured(), 6);
  await input.fill('');
  await camera.click();
  await waitCount(1);
  await send.click();
  const only = await waitAnswer(3);
  await waitCount(0);
  assert.equal(only.turns.length, 1);
  assert.equal(only.imageInputs, 1);
  assert.equal(only.knowledgeBaseId, null);
  assert.ok(!JSON.stringify(only.turns).includes('纯文字问题'));
  const onlyBubble = floating.locator('.floating-question').last();
  assert.ok(!(await onlyBubble.innerText()).includes('截图中的题目'));
  assert.ok((await onlyBubble.innerText()).includes('截图提问'));
  await app.evaluate(() => {
    globalThis.screenshotFixture.mode = 'fail';
  });
  await camera.click();
  await floating
    .getByText(process.platform === 'win32'
      ? '无法截取面试窗口所在屏幕，请检查系统屏幕捕获状态后重试。'
      : '无法截取当前屏幕，请检查屏幕录制权限后重试。', { exact: true })
    .waitFor();
  assert.equal((await requests()).length, 3);
  assert.equal(await previews.count(), 0);
  await app.evaluate(() => {
    globalThis.screenshotFixture.mode = 'normal';
    globalThis.screenshotFixture.providerMode = 'fail';
  });
  await camera.click();
  await waitCount(1);
  const capturesBeforeRetry = await captured();
  await send.click();
  await floating
    .locator('.floating-answer-item:last-child .interview-answer-failure')
    .getByText('当前模型不支持图片输入', { exact: true })
    .waitFor();
  const failedAnswer = floating.locator('.floating-answer-item').last();
  const failureCard = failedAnswer.locator('.interview-answer-failure');
  assert.equal(
    await failureCard.getByRole('button', { name: '重试面试回答', exact: true }).count(),
    1,
  );
  assert.equal(
    await failureCard.locator('.interview-answer-failure-reason').textContent(),
    '当前模型不支持图片输入',
  );
  assert.equal(await failureCard.getAttribute('role'), 'alert');
  assert.equal(await failureCard.getByText('已自动重试 3 次，仍未完成。').count(), 0);
  assert.equal(await failedAnswer.locator('.interview-answer-status').innerText(), '生成失败');
  assert.equal(await failedAnswer.locator('.answer-bubble').innerText(), '合成未完成回答');
  assert.equal(
    await failureCard.evaluate((node) => getComputedStyle(node).borderRadius),
    await failedAnswer
      .locator('.answer-bubble')
      .evaluate((node) => getComputedStyle(node).borderRadius),
  );
  await verifyContinuousCorners(floating, 'interview answer failure');
  await capture('failed-image-retained');
  assert.equal(
    await floating.locator('.floating-notices').getByText('当前模型不支持图片输入').count(),
    0,
  );
  assert.equal(await floating.locator('.floating-composer .interview-answer-failure').count(), 0);
  const answerScroll = floating.locator('.floating-answer .floating-scroll');
  const waitForAnswerEnd = (requireFollowing = false) =>
    answerScroll.evaluate(async (pane, requireFollowing) => {
      const deadline = performance.now() + 20000;
      for (;;) {
        await new Promise(requestAnimationFrame);
        const last = pane.lastElementChild;
        const style = getComputedStyle(pane);
        // scrollHeight and clientHeight round independently. Compare the last
        // answer and its bottom padding directly to the viewport in CSS pixels.
        const viewportBottom = pane.getBoundingClientRect().bottom - parseFloat(style.borderBottomWidth);
        const contentBottom = last && last.getBoundingClientRect().bottom + parseFloat(style.paddingBottom);
        const gap = contentBottom === null ? null : contentBottom - viewportBottom;
        const following = pane.dataset.followingLatest === 'true';
        if (pane.scrollTop > 0 && (!requireFollowing || following) && gap !== null && Math.abs(gap) <= 1) return;
        if (performance.now() >= deadline) throw Error('Answer pane did not reach the bottom: ' + JSON.stringify({
          following, requireFollowing, gap, contentBottom, viewportBottom, scrollTop: pane.scrollTop,
          scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight,
        }));
      }
    }, requireFollowing);
  // The progress row folds away while the failure card opens. Measure the
  // settled layout before moving the real, keyboard-focusable answer pane.
  await failedAnswer.locator('.floating-progress-reveal').waitFor({ state: 'detached' });
  await failedAnswer.locator('.floating-failure-reveal[data-open="true"]').evaluate(async (node) => {
    node.getBoundingClientRect();
    await Promise.allSettled(node.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  const geometry = () => failureCard.evaluate((card) => {
    const answer = card.closest('.floating-answer-item');
    const pane = answer.closest('.floating-scroll');
    const top = pane.getBoundingClientRect().top;
    return {
      scroll: pane.scrollTop,
      answer: answer.getBoundingClientRect().top - top,
      card: card.getBoundingClientRect().top - top,
    };
  });
  await answerScroll.press('End');
  await waitForAnswerEnd();
  const scrollBefore = await geometry();
  const inputBefore = await input.boundingBox();
  await answerScroll.press('Home');
  try {
    await floating.waitForFunction(() => document.querySelector('.floating-answer .floating-scroll').scrollTop === 0);
  } catch (cause) {
    const details = await answerScroll.evaluate(pane => ({
      top: pane.scrollTop, height: pane.clientHeight, content: pane.scrollHeight,
      following: pane.dataset.followingLatest, paneFocused: document.activeElement === pane,
      windowFocused: document.hasFocus(), dpr: devicePixelRatio,
    }));
    throw new Error('Home did not return the answer pane to the top: ' + JSON.stringify(details), { cause });
  }
  const scrollAfter = await geometry();
  const travelled = scrollBefore.scroll - scrollAfter.scroll;
  assert.ok(
    travelled > 0 && Math.abs(scrollAfter.answer - scrollBefore.answer - travelled) < 1 &&
      Math.abs(scrollAfter.card - scrollBefore.card - travelled) < 1,
    'Failure alert and answer must both move by the scrolled distance: ' +
      JSON.stringify({ scrollBefore, scrollAfter }),
  );
  assert.deepEqual(await input.boundingBox(), inputBefore);
  await failureCard
    .getByRole('button', { name: '重试面试回答', exact: true })
    .click({ trial: true });
  if ((await previews.count()) !== 1)
    console.error('Synthetic screenshot retention mismatch', {
      captures: await captured(),
      events: await floating.evaluate(() => window.syntheticScreenshotEvents),
    });
  assert.equal(await previews.count(), 1);
  assert.equal(
    (await requests()).length,
    4,
    'Unsupported/unknown failures are not automatically retried',
  );
  const failedHash = (await requests()).at(-1).turns.at(-1).files[0].hash;
  assert.ok(
    (await requests())
      .slice(3)
      .every((request) => request.turns.at(-1).files[0].hash === failedHash),
  );
  await app.evaluate(() => {
    globalThis.screenshotFixture.providerMode = 'normal';
  });
  await floating.getByRole('button', { name: '重试面试回答', exact: true }).last().click();
  const retried = await waitAnswer(5);
  await waitCount(0);
  assert.equal(await captured(), capturesBeforeRetry);
  assert.equal(retried.turns.at(-1).files[0].hash, failedHash);
  await capture('image-retry-completed');
  checks.push(
    'text sends do not capture; image-only send excludes history; failure alert scrolls with its answer while input stays fixed; retry reuses staged pixels',
  );
  await app.evaluate(() => { globalThis.screenshotFixture.providerMode = 'question-motion'; });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await floating.emulateMedia({ reducedMotion });
    const title = reducedMotion === 'reduce' ? '减少动态时的截图问题' : '查看这张截图并解释';
    await input.fill(title);
    await camera.click();
    await waitCount(1);
    const latest = floating.getByRole('button', { name: /返回最新回答|有新回答 · 返回最新/ });
    if (await latest.isVisible()) await latest.click();
    await waitForAnswerEnd(true);
    await answerScroll.evaluate((pane, title) => {
      const old = [...pane.querySelectorAll('.floating-question')];
      const started = [];
      const onStart = event => {
        if (event.animationName === 'screen-enter') started.push(event.target);
      };
      pane.addEventListener('animationstart', onStart);
      let group, keyframes, timing, children;
      const frames = [];
      let tick;
      const observe = () => {
        const latest = pane.querySelector('.floating-answer-item:last-child .floating-question');
        if (latest?.querySelector(':scope > span')?.textContent === title) {
          group ??= latest;
          const animation = group.getAnimations().find(item => item.animationName === 'screen-enter');
          const style = getComputedStyle(group);
          if (animation && !keyframes) {
            timing = animation.effect.getTiming();
            keyframes = animation.effect.getKeyframes().map(frame => {
              const transform = frame.transform.replace(/var\((--[\w-]+)\)/g,
                (_, name) => style.getPropertyValue(name));
              const matrix = new DOMMatrixReadOnly(transform);
              return [matrix.m41, matrix.m42, Number(frame.opacity)];
            });
          }
          children ??= [':scope > span:first-child', '.interview-image-thumbnail', '.floating-screenshot-label']
            .map(selector => group.querySelector(selector));
          const y = group.getBoundingClientRect().top;
          frames.push({
            moving: !!animation, top: pane.scrollTop, gap: pane.scrollHeight - pane.clientHeight - pane.scrollTop,
            y: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42,
            opacity: Number(style.opacity),
            offsets: children.map(child => child?.isConnected ? child.getBoundingClientRect().top - y : null),
          });
        }
        tick = requestAnimationFrame(observe);
      };
      tick = requestAnimationFrame(observe);
      window.finishQuestionMotionProbe = () => {
        cancelAnimationFrame(tick);
        pane.removeEventListener('animationstart', onStart);
        delete window.finishQuestionMotionProbe;
        return {
          frames, keyframes, duration: timing?.duration, delay: timing?.delay,
          starts: started.length, onlyGroup: started.every(target => target === group),
          retained: old.length > 0 && old.every(row => row.isConnected) && group?.isConnected,
        };
      };
    }, title);
    await send.click();
    const reply = floating.locator('.floating-answer-item').last().locator('.answer-bubble');
    await reply.getByText('回答第一段。', { exact: true }).waitFor();
    // Deliver a later real stream delta after the question's original animation has settled.
    await floating.waitForFunction(() => !document.querySelector('.floating-question.sent-message-enter'));
    const samples = [];
    for (const [addition, selector, ending] of [
      ['', 'p', '回答第一段。'],
      ['\n\n' + '这是会自然折行的回答文本。'.repeat(20) + '软折行尾字', 'p', '软折行尾字'],
      ['\n\n第二段  \n换行尾字', 'p', '换行尾字'],
      ['\n\n> 1. **引用列表尾字**', 'blockquote li strong', '引用列表尾字'],
      ['\n\n```ts\nconst n = 1;\nconst last = 2;\n', 'pre code', 'const last = 2;'],
      ['```\n\n|列一|列二|\n|---|---|\n|数据|表格尾字|', 'td', '表格尾字'],
    ]) {
      if (addition) await app.evaluate((_electron, delta) => globalThis.screenshotFixture.appendReply(delta), addition);
      const tail = reply.locator(selector).filter({ hasText: ending }).last();
      await tail.waitFor();
      const geometry = await tail.evaluate((host, ending) => {
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        let text;
        while ((text = walker.nextNode()) && !text.textContent.trimEnd().endsWith(ending)) {}
        if (!text) throw Error('The final visible glyph is missing: ' + ending);
        const end = text.textContent.trimEnd().length;
        const range = document.createRange();
        range.selectNodeContents(text);
        const textLines = range.getClientRects().length;
        range.setStart(text, end - 1);
        range.setEnd(text, end);
        const glyph = range.getBoundingClientRect();
        const caret = host.closest('.answer-bubble').querySelector('.typing-caret');
        const rect = caret.getBoundingClientRect();
        return { textLines, gap: rect.left - glyph.right, overlap: Math.min(rect.bottom, glyph.bottom) - Math.max(rect.top, glyph.top),
          minHeight: Math.min(rect.height, glyph.height), blinking: caret.getAnimations().length > 0 };
      }, ending);
      assert.ok(geometry.gap >= -1 && geometry.gap <= 5 && geometry.minHeight > 0 &&
        geometry.overlap >= geometry.minHeight * 0.6, `Caret must follow ${ending}: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.blinking, reducedMotion !== 'reduce');
      if (ending === '软折行尾字') assert.ok(geometry.textLines > 1, 'The sampled text actually wraps onto multiple rendered lines');
      samples.push(`${selector} ${geometry.gap.toFixed(1)}px`);
    }
    console.log(`Interview answer caret (${reducedMotion}), final glyph gaps: ${samples.join(', ')}`);
    await app.evaluate(() => globalThis.screenshotFixture.finishReply());
    await reply.getByText('回答第二段。', { exact: true }).waitFor();
    await reply.locator('.typing-caret').waitFor({ state: 'detached' });
    const sample = await floating.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.finishQuestionMotionProbe();
    });
    const { frames } = sample;
    assert.ok(frames.length > 1 && sample.retained && sample.onlyGroup,
      'Existing questions stay mounted and answer deltas never replay an entrance');
    const first = frames[0], last = frames.at(-1);
    assert.ok(frames.every(frame => frame.offsets.every((offset, i) =>
      offset !== null && Math.abs(offset - first.offsets[i]) <= 0.75)),
    'Text, thumbnail and screenshot label move together inside the question');
    assert.equal(last.y, 0);
    assert.equal(last.opacity, 1);
    if (reducedMotion === 'reduce') {
      assert.equal(sample.starts, 0);
      assert.ok(frames.every(frame => !frame.moving && frame.y === 0 && frame.opacity === 1),
        'Reduced motion shows the full question and its accessories from their first frame');
    } else {
      assert.equal(sample.starts, 1);
      assert.deepEqual(sample.keyframes, [[0, 8, 0], [0, 0, 1]]);
      assert.deepEqual([sample.duration, sample.delay], [240, 0]);
      assert.ok(first.moving && !last.moving && frames.some(frame =>
        frame.y > 0 && frame.opacity > 0 && frame.opacity < 1), 'The question animates from its first frame');
      assert.ok(frames.some((frame, i) => i > 0 && frame.moving && frame.gap > 1 &&
        frame.top > frames[i - 1].top), 'The answer pane advances partway while the question is still entering');
    }
  }
  await floating.emulateMedia({ reducedMotion: null });
  await app.evaluate(() => {
    globalThis.screenshotFixture.providerMode = 'normal';
    delete globalThis.screenshotFixture.finishReply;
    delete globalThis.screenshotFixture.appendReply;
  });
  checks.push('new text and attached screenshot enter together across 8px and 240ms while the list follows; existing questions and streamed replies stay in place; reduced motion displays immediately');
  assert.equal(await camera.getAttribute('aria-label'), '截取图像');
  assert.equal(await send.getAttribute('aria-label'), '发送面试问题');
  assert.equal(await camera.getAttribute('title'), null);
  assert.equal(await send.getAttribute('title'), null);
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  const history = await evaluateHistory(main, async () => JSON.stringify(await fixtureHistory.read()));
  assert.ok(history?.includes('"screenshot":"only"'));
  assert.ok(!history.match(/data:image|iVBORw0KGgo|"bytes"|"preview"|screenshotIds/));
  const imageIds = [
    ...new Set(
      JSON.parse(history).flatMap((record) =>
        record.answers.flatMap((answer) => answer.images?.map((image) => image.id) ?? []),
      ),
    ),
  ];
  assert.ok(imageIds.length > 0, 'Sent screenshots remain referenced in the archived record');
  const owner = await main.evaluate(async () => 'account:' + (await window.desktop.cloudAccount({ action: 'status' })).state.user.id);
  const imageDirectory = await app.evaluate(({ app }, owner) => {
    const path = process.getBuiltinModule('path');
    const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { profileDirectory } = load('./dist-electron/shared/electron/accountProfilePaths.js');
    return path.join(profileDirectory(app.getPath('userData'), owner), 'interview-images-v1');
  }, owner);
  const originals = await app.evaluate(async (_electron, { folder, ids }) => {
    const fs = process.getBuiltinModule('fs/promises');
    const path = process.getBuiltinModule('path');
    const crypto = process.getBuiltinModule('crypto');
    const results = [];
    for (const id of ids) {
      const bytes = await fs.readFile(path.join(folder, id + '.image'));
      const preview = await fs.readFile(path.join(folder, id + '.preview'), 'utf8');
      results.push({
        id,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        preview: preview.startsWith('data:image/jpeg;base64,'),
      });
    }
    return results;
  }, { folder: imageDirectory, ids: imageIds });
  assert.ok(originals.every((image) => image.preview));
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main
    .locator('.history-row')
    .first()
    .locator('.history-row-open')
    .click({ position: { x: 16, y: 16 } });
  const firstImage = main.locator('.record-images-section .interview-image-thumbnail').first();
  await firstImage.locator('img').waitFor();
  await firstImage.click();
  const viewer = main.getByRole('dialog', { name: '截图', exact: true });
  await viewer.locator('.interview-image-canvas img').waitFor();
  await checkMouseWheelZoom(main, viewer);
  const displayedOriginal = await evaluateHistory(main, async () => {
    const record = (await fixtureHistory.read())[0];
    const reference = record.answers.find((answer) => answer.images?.length).images[0];
    const result = await window.desktop.interviewImage({ op: 'read', id: reference.id });
    return (
      result.ok &&
      document.querySelector('.interview-image-canvas img').getAttribute('src') === result.dataUrl
    );
  });
  assert.equal(
    displayedOriginal,
    true,
    'The viewer receives stored original bytes, not the thumbnail',
  );
  assert.equal(await viewer.getByRole('button', { name: '原始大小', exact: true }).count(), 0);
  assert.equal(
    await viewer.getByRole('button', { name: '保存图片', exact: true }).isEnabled(),
    true,
  );
  const save = viewer.getByRole('button', { name: '保存图片', exact: true });
  const close = viewer.getByRole('button', { name: '关闭截图', exact: true });
  const saveBox = await save.boundingBox(),
    closeBox = await close.boundingBox();
  assert.equal(saveBox.width, closeBox.width);
  assert.equal(saveBox.height, closeBox.height);
  assert.equal(saveBox.y, closeBox.y);
  assert.ok(saveBox.x + saveBox.width <= closeBox.x, 'Save stays beside close at the top right');
  const canvas = viewer.locator('.interview-image-canvas');
  const transform = () =>
    canvas.locator('img').evaluate((image) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
      return { scale: matrix.a, x: matrix.e, y: matrix.f };
    });
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(
      new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -80,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await main.waitForFunction(() =>
    document.querySelector('.interview-image-canvas').hasAttribute('data-zoomed'),
  );
  const zoomed = await transform();
  assert.ok(zoomed.scale > 1);
  const canvasBox = await canvas.boundingBox();
  await main.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await main.mouse.wheel(40, 30);
  await main.waitForFunction(() => {
    const matrix = new DOMMatrixReadOnly(
      getComputedStyle(document.querySelector('.interview-image-canvas img')).transform,
    );
    return matrix.e !== 0 || matrix.f !== 0;
  });
  const panned = await transform();
  assert.equal(panned.scale, zoomed.scale, 'Two-finger pixel scrolling pans without zoom');
  await main.mouse.down();
  await main.mouse.move(
    canvasBox.x + canvasBox.width / 2 + 30,
    canvasBox.y + canvasBox.height / 2 + 20,
  );
  await main.mouse.up();
  const dragged = await transform();
  assert.ok(dragged.x !== panned.x || dragged.y !== panned.y);
  await canvas.dblclick();
  await main.waitForFunction(
    () => !document.querySelector('.interview-image-canvas').hasAttribute('data-zoomed'),
  );
  assert.deepEqual(await transform(), { scale: 1, x: 0, y: 0 });
  await viewer.press('ArrowRight');
  await viewer.locator('.interview-image-position').getByText('2 / 5', { exact: true }).waitFor();
  await viewer.press('ArrowLeft');
  await viewer.locator('.interview-image-position').getByText('1 / 5', { exact: true }).waitFor();
  const exportPath = await app.evaluate(({ app, dialog }) => {
    const target = process
      .getBuiltinModule('path')
      .join(app.getPath('userData'), 'synthetic-image-export.png');
    globalThis.imageRealSaveDialog = dialog.showSaveDialog.bind(dialog);
    dialog.showSaveDialog = async (owner) => {
      if (owner.getTitle() !== 'VoxCue') throw Error('Wrong save owner');
      globalThis.imageExportCalls = (globalThis.imageExportCalls ?? 0) + 1;
      return { canceled: false, filePath: target };
    };
    return target;
  });
  await save.click();
  await main.waitForFunction(
    () => document.querySelector('.interview-image-save').getAttribute('aria-busy') === 'false',
  );
  const exportedHash = await app.evaluate(async (_electron, target) => {
    const bytes = await process.getBuiltinModule('fs/promises').readFile(target);
    return process.getBuiltinModule('crypto').createHash('sha256').update(bytes).digest('hex');
  }, exportPath);
  const firstReference = await evaluateHistory(main,
    async () =>
      (await fixtureHistory.read())[0].answers.find(
        (answer) => answer.images?.length,
      ).images[0].id,
  );
  assert.equal(exportedHash, originals.find((image) => image.id === firstReference).sha256);
  if (nativeSaveHits) {
    const { checkImageSaveHit } = await import(
      pathToFileURL(path.resolve('test/scripts/image-save-hit-check.mjs')).href
    );
    await checkImageSaveHit(app, main, viewer);
  }
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await save.click();
  await main.waitForFunction(
    () => document.querySelector('.interview-image-save').getAttribute('aria-busy') === 'false',
  );
  assert.equal(await viewer.locator('.danger-text').count(), 0);
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw Error('Synthetic export failure');
    };
  });
  await save.click();
  await viewer.getByText('保存图片失败，请检查目标位置权限和可用空间。', { exact: true }).waitFor();
  await viewer.press('Escape');
  await viewer.waitFor({ state: 'hidden' });
  await firstImage.click();
  await close.click();
  await viewer.waitFor({ state: 'hidden' });
  // Exercise real missing/corrupt archived bytes, only in this owned profile.
  const requestsBeforeImageFailures = (await requests()).length;
  await app.evaluate(async (_electron, { directory, id }) => {
    const fs = process.getBuiltinModule('fs/promises'),
      path = process.getBuiltinModule('path');
    const file = path.join(directory, id + '.image');
    globalThis.imageReadFixture = { file, bytes: await fs.readFile(file) };
  }, { directory: imageDirectory, id: firstReference });
  for (const mode of ['missing', 'corrupt']) {
    await app.evaluate(async (_electron, mode) => {
      const fs = process.getBuiltinModule('fs/promises'),
        fixture = globalThis.imageReadFixture;
      if (mode === 'missing') await fs.unlink(fixture.file);
      else await fs.writeFile(fixture.file, Buffer.from('synthetic corrupt image'));
    }, mode);
    await firstImage.click();
    await viewer
      .getByRole('alert')
      .getByText('无法读取图片，文件可能已移除。', { exact: true })
      .waitFor();
    assert.equal(await viewer.locator('.interview-image-canvas img').count(), 0);
    await viewer.press('Escape');
    await viewer.waitFor({ state: 'hidden' });
    await app.evaluate(async () => {
      const fixture = globalThis.imageReadFixture;
      await process.getBuiltinModule('fs/promises').writeFile(fixture.file, fixture.bytes);
    });
  }
  await app.evaluate(({ app }, id) => {
    const load = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { InterviewImageStore } = load(
      './dist-electron/shared/electron/backend/interview/images.js',
    );
    const read = InterviewImageStore.prototype.read;
    globalThis.restoreImageRead = () => {
      InterviewImageStore.prototype.read = read;
    };
    InterviewImageStore.prototype.read = function (current) {
      if (current === id)
        return new Promise((resolve, reject) => {
          globalThis.releaseImageRead = () => read.call(this, current).then(resolve, reject);
        });
      return read.call(this, current);
    };
  }, firstReference);
  await firstImage.click();
  await viewer.getByText('正在读取原图…', { exact: true }).waitFor();
  await viewer.press('ArrowRight');
  const secondOriginal = viewer.getByRole('img', { name: '截图 2 原图', exact: true });
  await secondOriginal.waitFor();
  const secondSource = await secondOriginal.getAttribute('src');
  await app.evaluate(async () => {
    await globalThis.releaseImageRead();
    globalThis.restoreImageRead();
  });
  await main.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await secondOriginal.getAttribute('src'),
    secondSource,
    'Late first-image read cannot replace the current image',
  );
  await viewer.press('Escape');
  await viewer.waitFor({ state: 'hidden' });
  assert.equal(
    (await requests()).length,
    requestsBeforeImageFailures,
    'Image read failures and paging never submit model requests',
  );
  checks.push(
    'bubble thumbnails, durable originals, live/history viewers, keyboard paging, pinch zoom, pixel pan, drag/reset, exact-byte export, cancel/error, missing/corrupt bytes, late reads and close/reopen',
  );
  // Interrupt cleanup after the history commit, then reopen the same synthetic profile.
  await app.evaluate(({ app }) => {
    const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const store = load('./dist-electron/shared/electron/backend/interview/images.js').InterviewImageStore.prototype;
    const remove = store.remove;
    globalThis.resumeImageRemoval = () => { store.remove = remove; };
    store.remove = async () => { throw Error('Synthetic image storage unavailable'); };
  });
  const removeRecord = main.locator('.record-toolbar-actions .confirm-delete');
  await removeRecord.click();
  await removeRecord.click();
  await main.getByText(/部分截图清理失败/).waitFor();
  assert.equal(await evaluateHistory(main, async () => (await fixtureHistory.read()).length), 0);
  assert.ok((await main.evaluate(id => window.desktop.interviewImage({ op: 'read', id }), firstReference)).ok);
  await app.evaluate(() => globalThis.resumeImageRemoval());
  await main.reload();
  await main.getByRole('button', { name: '面试记录', exact: true }).waitFor();
  await waitForAsync(main, async id => !(await window.desktop.interviewImage({ op: 'read', id })).ok, firstReference);
  const filesLeft = await app.evaluate(async (_electron, directory) =>
    process.getBuiltinModule('fs/promises').readdir(directory), imageDirectory);
  assert.ok(imageIds.every(id => !filesLeft.includes(id + '.image') && !filesLeft.includes(id + '.preview')));
  checks.push('reopening after interrupted history deletion clears the remaining originals and previews');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks,
        requests: (await requests()).length,
        captures: await captured(),
        liveAccount: false,
        nativeAudio: false,
        realScreenCapture: false,
        screenshotPixelsSaved: true,
        archivedImages: originals.length,
      },
      null,
      2,
    ),
  );
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await closeUiApp(app);
}
