import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.join(testRoot, 'interview-font-profile');
await mkdir(profile);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
let app = await electron.launch({ args: [await offlineElectronEntry()], env });
const key = 'voxcue-interview-font-size-v1';
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    ChatGPTService.prototype.stream = async (request, emit) => {
      const answerText =
        '先说明目标，再介绍自己的工作和结果。\n\n### 实现要点\n\n保持清晰的接口与可靠的本地存储。';
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, usage: null, sources: [] };
    };
  });
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const openSettings = async () => {
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page
      .getByRole('dialog', { name: '设置', exact: true })
      .getByRole('button', { name: '面试设置', exact: true })
      .click();
  };
  await openSettings();
  const settings = page.getByRole('region', { name: '面试界面', exact: true });
  const current = async () =>
    Number((await settings.getByLabel('当前面试字号').innerText()).split(' ')[0]);
  const setSize = async (size) => {
    while ((await current()) !== size)
      await settings
        .getByRole('button', {
          name: (await current()) < size ? '字体变大' : '字体变小',
          exact: true,
        })
        .click();
  };
  for (const width of [1280, 960]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.isVisible())
          .setContentSize(width, 800),
      width,
    );
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      for (const size of [24, 12, 14]) {
        await setSize(size);
        const metrics = await settings.evaluate((section) => ({
          preview: [
            ...section.querySelectorAll(
              '.interview-font-sample,.interview-font-preview .markdown-content',
            ),
          ].map((e) => parseFloat(getComputedStyle(e).fontSize)),
          controls: [...section.querySelectorAll('button')].map((e) => ({
            size: parseFloat(getComputedStyle(e).fontSize),
            height: e.getBoundingClientRect().height,
          })),
          overflow: [
            ...section.querySelectorAll(
              '.interview-font-actions,.interview-font-preview,.interview-font-preview > div',
            ),
          ].some((e) => e.scrollWidth > e.clientWidth + 1),
        }));
        assert.ok(
          metrics.preview.every((value) => value === size),
          JSON.stringify(metrics),
        );
        assert.ok(
          metrics.controls.every((value) => value.size === 14 && value.height === 36),
          JSON.stringify(metrics),
        );
        assert.equal(metrics.overflow, false);
        assert.equal(
          await settings.getByRole('button', { name: '字体变大', exact: true }).isDisabled(),
          size === 24,
        );
        assert.equal(
          await settings.getByRole('button', { name: '字体变小', exact: true }).isDisabled(),
          size === 12,
        );
      }
    }
  }
  await setSize(18);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await openSettings();
  assert.equal(await current(), 18);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    globalThis.restoreFontStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw Error('Synthetic storage failure');
      return original.call(this, name, value);
    };
  }, key);
  await settings.getByRole('button', { name: '字体变大', exact: true }).click();
  await settings
    .getByRole('alert')
    .getByText(/保存失败/)
    .waitFor();
  assert.equal(await current(), 18);
  await page.evaluate(() => globalThis.restoreFontStorage());
  await settings.getByRole('button', { name: '重置字体大小', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await current(), 14);
  assert.equal(await settings.getByRole('alert').count(), 0);
  await setSize(24);
  if (process.argv.includes('--preview'))
    console.log(
      'VOXCUE_FONT_PREVIEW:' +
        (await settings.screenshot({ type: 'jpeg', quality: 75, scale: 'css' })).toString('base64'),
    );
  await setSize(18);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    page
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  floating.setDefaultTimeout(15000);
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.locator('.transcript-item > p').first().waitFor();
  await floating.locator('.answer-text h3').first().waitFor();
  const toolbar = await floating.locator('.floating-toolbar').boundingBox();
  for (const size of [18, 24, 12, 14]) {
    await page.evaluate(({ key, size }) => localStorage.setItem(key, String(size)), { key, size });
    await floating.waitForFunction(
      (size) =>
        getComputedStyle(document.querySelector('.floating-question')).fontSize === size + 'px',
      size,
    );
    const metrics = await floating.evaluate(() => ({
      text: [
        ...document.querySelectorAll(
          '.transcript-item > p,.floating-question,.answer-text,.answer-text .markdown-content,.floating-composer textarea',
        ),
      ].map((e) => parseFloat(getComputedStyle(e).fontSize)),
      overflow: [
        ...document.querySelectorAll('.floating-panel,.floating-scroll,.floating-composer'),
      ].some((e) => e.scrollWidth > e.clientWidth + 1),
      heading: parseFloat(getComputedStyle(document.querySelector('.answer-text h3')).fontSize),
      textareaLine: parseFloat(
        getComputedStyle(document.querySelector('.floating-composer textarea')).lineHeight,
      ),
    }));
    assert.ok(
      metrics.text.every((value) => value === size),
      JSON.stringify(metrics),
    );
    assert.equal(metrics.overflow, false);
    assert.ok(metrics.textareaLine >= size);
    assert.ok(Math.abs(metrics.heading - (size * 15) / 14) < 0.01);
    assert.deepEqual(await floating.locator('.floating-toolbar').boundingBox(), toolbar);
    assert.equal(
      await floating.getByRole('button', { name: '字体变大', exact: true }).isDisabled(),
      size === 24,
    );
    assert.equal(
      await floating.getByRole('button', { name: '字体变小', exact: true }).isDisabled(),
      size === 12,
    );
  }
  await floating.getByRole('button', { name: '字体变大', exact: true }).click();
  for (const label of ['字体变大', '字体变小']) {
    assert.equal(
      await floating
        .getByRole('button', { name: label, exact: true })
        .evaluate(
          (button) =>
            button.querySelectorAll('svg').length === 1 && button.textContent.trim() === '',
        ),
      true,
    );
  }
  if (process.argv.includes('--preview-toolbar'))
    console.log(
      JSON.stringify({
        preview: 'floating-font-icons',
        jpeg: (
          await floating
            .locator('.floating-toolbar')
            .screenshot({ type: 'jpeg', quality: 90, scale: 'css' })
        ).toString('base64'),
      }),
    );
  await floating.waitForFunction(
    () => getComputedStyle(document.querySelector('.floating-question')).fontSize === '15px',
  );
  await floating.getByRole('button', { name: '字体变小', exact: true }).click();
  await floating.waitForFunction(
    () => getComputedStyle(document.querySelector('.floating-question')).fontSize === '14px',
  );
  await floating.evaluate((key) => {
    const original = Storage.prototype.setItem;
    globalThis.restoreToolbarFontStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw Error('Synthetic toolbar storage failure');
      return original.call(this, name, value);
    };
  }, key);
  const fontFailure = floating.getByText('面试字号保存失败，请重试。', { exact: true });
  await floating.getByRole('button', { name: '字体变大', exact: true }).click();
  await fontFailure.waitFor();
  assert.equal(
    await floating.locator('.floating-question').evaluate((e) => getComputedStyle(e).fontSize),
    '14px',
  );
  await floating.evaluate(() => globalThis.restoreToolbarFontStorage());
  await floating.getByRole('button', { name: '字体变大', exact: true }).click();
  await floating.waitForFunction(
    () => getComputedStyle(document.querySelector('.floating-question')).fontSize === '15px',
  );
  await fontFailure.waitFor({ state: 'detached', timeout: 2000 });
  await floating.getByRole('button', { name: '字体变小', exact: true }).click();
  await floating.keyboard.press('Control+-');
  if (process.platform === 'darwin') {
    await floating.keyboard.press('Meta+-');
    await floating.keyboard.press('Meta+=');
    await floating.keyboard.press('Meta+0');
  }
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#interview'))
        .webContents.getZoomFactor(),
    ),
    1,
  );
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  assert.equal(
    await floating.locator('.floating-toolbar').evaluate((e) => e.scrollWidth > e.clientWidth + 1),
    false,
  );
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  await page.evaluate(({ key }) => localStorage.setItem(key, '18'), { key });
  await closeUiApp(app);
  app = await electron.launch({ args: [await offlineElectronEntry()], env });
  await installUiAccount(app, { speech: true, components: true });
  const restartLogin = await app.firstWindow();
  const [restarted] = await Promise.all([
    app.waitForEvent('window'),
    restartLogin.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  restarted.on('pageerror', (error) => errors.push(error.message));
  await restarted.getByRole('button', { name: '用户菜单', exact: true }).click();
  await restarted.getByRole('menuitem', { name: '设置', exact: true }).click();
  await restarted
    .getByRole('dialog', { name: '设置', exact: true })
    .getByRole('button', { name: '面试设置', exact: true })
    .click();
  assert.equal(await restarted.getByLabel('当前面试字号').innerText(), '18 px');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: font controls, live preview, limits, reset, persistence, storage failure, light/dark and minimum window; cross-window reading text sync with fixed toolbar and no horizontal overflow. Synthetic account/audio only.',
  );
} finally {
  await closeUiApp(app);
}
