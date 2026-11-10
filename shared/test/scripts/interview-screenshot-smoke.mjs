import { connectUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { verifyContinuousCorners, cornerShapeNames } from './continuous-corners.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import workspace from '../../scripts/workspace.mjs';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(
  path.resolve(path.join(testRoot, 'test/results/interview-screenshot-ui-')),
);
const screenshotDirectory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
assert.ok(
  process.argv.slice(2).every((arg) => arg.startsWith('--screenshots=')),
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
    const original = desktopCapturer.getSources.bind(desktopCapturer);
    globalThis.screenshotPreparation = 0;
    desktopCapturer.getSources = (options) => {
      if (options.thumbnailSize?.width === 0 && options.thumbnailSize?.height === 0) {
        globalThis.screenshotPreparation++;
        return Promise.resolve([]);
      }
      return original(options);
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
  const pressScreenshot = () => app.evaluate(() => {
    const capture = globalThis.screenshotShortcuts.get('Control+Shift+S');
    if (!capture) throw Error('Global screenshot registration is missing');
    capture();
  });
  assert.equal(await camera.locator('kbd').innerText(), 'Ctrl+Shift+S');
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
    const preview = await floating.locator('.floating-composer').screenshot({});
    if (process.argv.includes('--preview') && theme === 'light')
      console.log('VOXCUE_PREVIEW:' + preview.toString('base64'));
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
    .getByText('无法截取当前屏幕，请检查屏幕录制权限后重试。', { exact: true })
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
  // Viewer focus restoration can leave this pane at the top; establish a
  // scrollable starting point before checking that the failure card moves.
  await answerScroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event('scroll'));
  });
  const scrollBefore = await answerScroll.evaluate((node) => ({
    top: node.scrollTop,
    cardTop: node.querySelector('.interview-answer-failure').getBoundingClientRect().top,
  }));
  const inputBefore = await input.boundingBox();
  await answerScroll.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  const scrollAfter = await answerScroll.evaluate((node) => ({
    top: node.scrollTop,
    cardTop: node.querySelector('.interview-answer-failure').getBoundingClientRect().top,
  }));
  assert.ok(scrollBefore.top > scrollAfter.top);
  assert.ok(
    Math.abs(scrollAfter.cardTop - scrollBefore.cardTop - (scrollBefore.top - scrollAfter.top)) < 1,
    'failure alert must move with its answer when scrolling',
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
  assert.equal(await camera.getAttribute('aria-label'), '截取图像');
  assert.equal(await send.getAttribute('aria-label'), '发送面试问题');
  assert.equal(await camera.getAttribute('title'), null);
  assert.equal(await send.getAttribute('title'), null);
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  const history = await main.evaluate(() => localStorage.getItem('copilot-interview-history-v1'));
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
  const originals = await app.evaluate(async ({ app }, ids) => {
    const fs = process.getBuiltinModule('fs/promises');
    const path = process.getBuiltinModule('path');
    const crypto = process.getBuiltinModule('crypto');
    const folder = path.join(app.getPath('userData'), 'interview-images-v1');
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
  }, imageIds);
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
  const displayedOriginal = await main.evaluate(async () => {
    const record = JSON.parse(localStorage.getItem('copilot-interview-history-v1'))[0];
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
  const firstReference = await main.evaluate(
    () =>
      JSON.parse(localStorage.getItem('copilot-interview-history-v1'))[0].answers.find(
        (answer) => answer.images?.length,
      ).images[0].id,
  );
  assert.equal(exportedHash, originals.find((image) => image.id === firstReference).sha256);
  if (process.argv.includes('--native-hits')) {
    assert.equal(process.platform, 'win32', 'Native Windows hit checks require Windows');
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
  await app.evaluate(async ({ app }, id) => {
    const fs = process.getBuiltinModule('fs/promises'),
      path = process.getBuiltinModule('path');
    const file = path.join(app.getPath('userData'), 'interview-images-v1', id + '.image');
    globalThis.imageReadFixture = { file, bytes: await fs.readFile(file) };
  }, firstReference);
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
