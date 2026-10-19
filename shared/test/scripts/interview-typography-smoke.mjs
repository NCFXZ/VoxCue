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
const opacityKey = 'voxcue-interview-background-transparency-v1';
const errors = [];
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
  page.on('pageerror', (error) => errors.push(error.message));
  const openSettings = async (target = page) => {
    await target.getByRole('button', { name: '用户菜单', exact: true }).click();
    await target.getByRole('menuitem', { name: '设置', exact: true }).click();
    await target
      .getByRole('dialog', { name: '设置', exact: true })
      .getByRole('button', { name: '面试设置', exact: true })
      .click();
  };
  await openSettings();
  const settings = page.getByRole('region', { name: '面试界面', exact: true });
  const slider = settings.getByRole('slider', { name: '面试字体大小', exact: true });
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
        await slider.fill(String(size));
        const metrics = await settings.evaluate((section) => ({
          preview: [
            ...section.querySelectorAll(
              '.interview-font-sample,.interview-font-preview .markdown-content',
            ),
          ].map((e) => parseFloat(getComputedStyle(e).fontSize)),
          overflow: [
            ...section.querySelectorAll(
              '.interview-display-controls,.frosted-slider,.interview-preview-scene,.interview-font-preview,.interview-font-preview > section,.interview-preview-shell .floating-composer',
            ),
          ].some((e) => e.scrollWidth > e.clientWidth + 1),
        }));
        assert.ok(
          metrics.preview.every((value) => value === size),
          JSON.stringify(metrics),
        );
        assert.equal(metrics.overflow, false);
      }
    }
  }
  const opacity = settings.getByRole('slider', { name: '面试背景透明度', exact: true });
  const previewStyle = async () =>
    settings
      .locator('.interview-font-preview > section')
      .first()
      .evaluate((e) => getComputedStyle(e).backgroundColor);
  await opacity.fill('0');
  const solid = await previewStyle();
  await opacity.fill('100');
  const clear = await previewStyle();
  assert.notEqual(solid, clear);
  assert.equal(
    await settings
      .locator('.interview-preview-scene')
      .evaluate((e) => getComputedStyle(e).backgroundImage === 'none'),
    false,
  );
  assert.equal(await settings.locator('.display-slider-icon').count(), 4);
  const thumb = await slider.evaluate((e) => ({
    color: getComputedStyle(e, '::-webkit-slider-thumb').backgroundColor,
    track: parseFloat(
      getComputedStyle(e.closest('.frosted-slider-control').querySelector('.frosted-slider-track'))
        .height,
    ),
  }));
  assert.equal(thumb.track, 6);
  await slider.fill('18');
  await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).fill('37');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await openSettings();
  assert.equal(await slider.inputValue(), '18');
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).inputValue(),
    '37',
  );
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    globalThis.restoreStorage = () => (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw Error('Synthetic storage failure');
      return original.call(this, name, value);
    };
  }, key);
  await slider.fill('19');
  await settings.getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
  assert.equal(await slider.inputValue(), '18');
  await page.evaluate(() => globalThis.restoreStorage());
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await slider.inputValue(), '17');
  assert.equal(await settings.getByRole('alert').count(), 0);
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
      icons: [...document.querySelectorAll('.floating-question > svg')].map((e) => ({
        width: e.getBoundingClientRect().width,
        text: parseFloat(getComputedStyle(e.parentElement).fontSize),
      })),
      overflow: [
        ...document.querySelectorAll('.floating-panel,.floating-scroll,.floating-composer'),
      ].some((e) => e.scrollWidth > e.clientWidth + 1),
      heading: parseFloat(getComputedStyle(document.querySelector('.answer-text h3')).fontSize),
    }));
    assert.ok(
      metrics.text.every((value) => value === size),
      JSON.stringify(metrics),
    );
    assert.ok(
      metrics.icons.every((m) => m.width / m.text >= 1.19),
      JSON.stringify(metrics),
    );
    assert.equal(metrics.overflow, false);
    assert.ok(Math.abs(metrics.heading - (size * 15) / 14) < 0.01);
    assert.deepEqual(await floating.locator('.floating-toolbar').boundingBox(), toolbar);
  }
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const floatSettings = floating.getByRole('dialog', { name: '面试设置', exact: true });
  await floatSettings.getByRole('slider', { name: '面试字体大小', exact: true }).fill('18');
  await floatSettings.getByRole('slider', { name: '面试背景透明度', exact: true }).fill('62');
  await page.waitForFunction(
    ({ key, opacityKey }) =>
      localStorage.getItem(key) === '18' && localStorage.getItem(opacityKey) === '62',
    { key, opacityKey },
  );
  assert.equal(
    await floating.evaluate(() => localStorage.getItem('voxcue-frosted-transparency-v2')),
    null,
  );
  assert.equal(await floatSettings.getByRole('button', { name: '完成', exact: true }).count(), 0);
  await floatSettings.getByRole('button', { name: '关闭对话框', exact: true }).click();
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
  await closeUiApp(app);
  app = await electron.launch({ args: [await offlineElectronEntry()], env });
  await installUiAccount(app, { speech: true, components: true });
  const restartedLogin = await app.firstWindow();
  const [restarted] = await Promise.all([
    app.waitForEvent('window'),
    restartedLogin.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  await openSettings(restarted);
  assert.equal(
    await restarted.getByRole('slider', { name: '面试字体大小', exact: true }).inputValue(),
    '18',
  );
  assert.equal(
    await restarted.getByRole('slider', { name: '面试背景透明度', exact: true }).inputValue(),
    '62',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: display sliders, preview, keyboard and limits, storage failures, persistence, font/icon scaling, independent opacity, cross-window sync, light/dark and minimum bounds; synthetic account/audio only.',
  );
} finally {
  await closeUiApp(app);
}
