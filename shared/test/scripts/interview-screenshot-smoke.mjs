import { testRoot, electron } from './test-workspace.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { verifyContinuousCorners } from './continuous-corners.mjs';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(
  path.resolve(path.join(testRoot, 'test/results/interview-screenshot-ui-')),
);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const errors = [],
  checks = [];
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
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
  const [main] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
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
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    main
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  floating.setDefaultTimeout(20000);
  assert.equal(
    await floating.locator('.floating-toolbar .app-logo').getAttribute('src'),
    logoSource,
  );
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.getByRole('status', { name: '语音模型：正常', exact: true }).waitFor();
  await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  let nativeCapture;
  if (process.argv.includes('--native-capture')) {
    nativeCapture = await app.evaluate(
      async ({ app, BrowserWindow, nativeImage, screen, desktopCapturer, systemPreferences }) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(app.getAppPath() + '/package.json');
        const { captureInterviewScreen } = require(
          app.getAppPath() + '/dist-electron/shared/electron/screenshot.js',
        );
        const window = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().endsWith('#interview'),
        );
        let file;
        try {
          file = await captureInterviewScreen(
            window,
            process.platform,
            new AbortController().signal,
          );
        } catch (error) {
          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 160, height: 100 },
          });
          return {
            error: String(error),
            permission: systemPreferences.getMediaAccessStatus('screen'),
            displays: screen
              .getAllDisplays()
              .map((d) => ({ id: d.id, size: d.size, scale: d.scaleFactor })),
            sources: sources.map((s) => ({
              id: s.id,
              displayId: s.display_id,
              empty: s.thumbnail.isEmpty(),
              size: s.thumbnail.getSize(),
            })),
          };
        }
        const image = nativeImage.createFromBuffer(Buffer.from(file.bytes));
        // Return metadata only: actual desktop pixels are never saved or sent to a provider.
        return {
          name: file.name,
          bytes: file.bytes.byteLength,
          size: image.getSize(),
          empty: image.isEmpty(),
        };
      },
    );
    assert.equal(nativeCapture.error, undefined, JSON.stringify(nativeCapture));
    assert.equal(nativeCapture.empty, false);
    assert.ok(nativeCapture.bytes > 0 && nativeCapture.bytes <= 8 * 1024 * 1024);
    assert.ok(nativeCapture.size.width > 100 && nativeCapture.size.height > 100);
    checks.push(
      'actual native display capture returned a bounded image; pixels stayed local and were discarded',
    );
  }
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
          pixels[i] = fixture.count * 25;
          pixels[i + 1] = 100;
          pixels[i + 2] = 180;
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
  const send = floating.getByRole('button', { name: '发送面试问题', exact: true });
  const input = floating.getByRole('textbox', { name: '面试提问', exact: true });
  const previews = floating.locator('.floating-screenshot-preview');
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
  };
  const waitAnswer = async (count) => {
    await floating.getByText('截图回归回答 ' + count, { exact: true }).waitFor();
    return (await requests()).at(-1);
  };
  const collapsedWidth = (await camera.boundingBox()).width;
  assert.ok(collapsedWidth <= 36);
  await input.fill('解释这些截图，先保留我的草稿');
  await camera.click();
  await waitCount(1);
  assert.equal(await input.inputValue(), '解释这些截图，先保留我的草稿');
  assert.equal((await requests()).length, 0);
  assert.equal(await captured(), 1);
  assert.ok((await camera.boundingBox()).width > collapsedWidth + 20);
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
  assert.equal(await captured(), 5);
  assert.equal((await requests()).length, 0);
  await floating.getByRole('button', { name: '移除截图 2', exact: true }).click();
  await waitCount(4);
  await camera.click();
  await waitCount(5);
  const resize = floating.getByRole('button', { name: '拖动右下角调整尺寸', exact: true });
  for (let i = 0; i < 4; i++) await resize.press('ArrowDown');
  for (const theme of ['light', 'dark']) {
    await floating.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
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
  assert.equal(await failureCard.getByText('已自动重试 3 次，仍未完成。').count(), 1);
  assert.equal(await failedAnswer.locator('.interview-answer-status').innerText(), '生成失败');
  assert.equal(await failedAnswer.locator('.answer-bubble').innerText(), '合成未完成回答');
  assert.equal(
    await failureCard.evaluate((node) => getComputedStyle(node).borderRadius),
    await failedAnswer
      .locator('.answer-bubble')
      .evaluate((node) => getComputedStyle(node).borderRadius),
  );
  await verifyContinuousCorners(floating, 'interview answer failure');
  assert.equal(
    await floating.locator('.floating-notices').getByText('当前模型不支持图片输入').count(),
    0,
  );
  assert.equal(await floating.locator('.floating-composer .interview-answer-failure').count(), 0);
  const answerScroll = floating.locator('.floating-answer .floating-scroll');
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
  assert.equal(await previews.count(), 1);
  assert.equal((await requests()).length, 7);
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
  const retried = await waitAnswer(8);
  await waitCount(0);
  assert.equal(await captured(), capturesBeforeRetry);
  assert.equal(retried.turns.at(-1).files[0].hash, failedHash);
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
        realScreenCapture: !!nativeCapture,
        nativeCapture,
        screenshotPixelsSaved: false,
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
