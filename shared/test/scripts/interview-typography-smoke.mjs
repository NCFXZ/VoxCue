import { connectUiAccount } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.join(testRoot, 'interview-font-profile');
const screenshotDirectory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
if (screenshotDirectory) await mkdir(path.resolve(screenshotDirectory), { recursive: true });
const capture = async (target, name) => {
  if (screenshotDirectory)
    await target.screenshot({
      path: path.join(path.resolve(screenshotDirectory), name + '.png'),
      animations: 'disabled',
      scale: 'css',
    });
};
await mkdir(profile);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
let app = await electron.launch({ args: [await offlineElectronEntry()], env });
const key = 'voxcue-interview-font-size-v1';
const errors = [];
const fixedTextStyles = (scope) =>
  scope.evaluate((root) => {
    const bubbles = '.transcript-item > p,.floating-question,.answer-bubble';
    return [...root.querySelectorAll('*')]
      .filter(
        (element) =>
          element instanceof HTMLElement &&
          element.getClientRects().length &&
          !element.closest(bubbles) &&
          (element.matches('input,textarea') ||
            [...element.childNodes].some(
              (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
            )),
      )
      .map((element) => {
        const path = [];
        for (let current = element; current !== root; current = current.parentElement)
          path.unshift([...current.parentElement.children].indexOf(current));
        return {
          path: path.join('/'),
          font: getComputedStyle(element).fontSize,
          placeholder: element.matches('input,textarea')
            ? getComputedStyle(element, '::placeholder').fontSize
            : undefined,
        };
      });
  });
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(async ({ app, session }) => {
    // Fixed branding must remain available when a separate image asset fails.
    // Keep this regression offline while denying only that local SVG resource.
    session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
      const url = new URL(request.url);
      callback({
        cancel:
          ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
          (url.protocol === 'file:' && /\/chatgpt[^/]*\.svg$/.test(url.pathname)),
      });
    });
    await session.defaultSession.clearCache();
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
      return {
        provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
        answerText,
        usage: null,
        sources: [],
      };
    };
  });
  const login = await app.firstWindow();
  await login.reload();
  const checkBrandImage = async (target, selector) => {
    const image = target.locator(selector).first();
    await image.evaluate(async (image) => image.decode());
    assert.equal(
      await image.evaluate((image) => image.naturalWidth > 0 && image.naturalHeight > 0),
      true,
    );
  };
  await checkBrandImage(login, '.service-brand-icon');
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  const openSettings = async (target = page) => {
    await target.getByRole('button', { name: '用户菜单', exact: true }).click();
    await target.getByRole('menuitem', { name: '设置', exact: true }).click();
    await target
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '个性化', exact: true })
      .click();
    await target
      .getByRole('dialog', { name: '设置', exact: true })
      .getByRole('button', { name: '面试设置', exact: true })
      .click();
  };
  await openSettings();
  const settings = page.getByRole('region', { name: '面试界面', exact: true });
  await checkBrandImage(settings, '.provider-avatar img');
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
      await checkBrandImage(settings, '.provider-avatar img');
      const fixedPreview = await fixedTextStyles(settings);
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
        assert.deepEqual(await fixedTextStyles(settings), fixedPreview);
        assert.equal(
          await settings
            .getByRole('textbox', { name: '预览输入框', exact: true })
            .evaluate((element) => getComputedStyle(element).fontSize),
          '14px',
        );
        if (screenshotDirectory && width === 1280 && size === 24) {
          const content = page.locator('.settings-content');
          const top = await content.evaluate((node) => node.scrollTop);
          await capture(
            page.getByRole('dialog', { name: '设置', exact: true }),
            'font-preview-24px-' + theme,
          );
          await settings
            .getByRole('textbox', { name: '预览输入框', exact: true })
            .scrollIntoViewIfNeeded();
          await capture(
            page.getByRole('dialog', { name: '设置', exact: true }),
            'font-preview-input-24px-' + theme,
          );
          await content.evaluate((node, top) => {
            node.scrollTop = top;
          }, top);
        }
      }
    }
  }
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.interviewTransparency),
    '100',
  );
  assert.equal(
    await settings
      .locator('.interview-preview-scene')
      .evaluate((e) => getComputedStyle(e).backgroundImage === 'none'),
    false,
  );
  assert.equal(await settings.locator('.display-slider-icon').count(), 2);
  const thumb = await slider.evaluate((e) => ({
    color: getComputedStyle(e, '::-webkit-slider-thumb').backgroundColor,
    track: parseFloat(
      getComputedStyle(e.closest('.frosted-slider-control').querySelector('.frosted-slider-track'))
        .height,
    ),
  }));
  assert.equal(thumb.track, 6);
  await slider.fill('18');
  await page.evaluate(() =>
    localStorage.setItem('voxcue-interview-background-transparency-v1', '37'),
  );
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await openSettings();
  assert.equal(await slider.inputValue(), '18');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('voxcue-interview-background-transparency-v1')),
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
  await checkBrandImage(floating, '.provider-avatar img');
  await floating.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.querySelectorAll('img')].map((image) => image.decode().catch(() => {})),
    );
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await floating.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
  const toolbar = await floating.locator('.floating-toolbar').boundingBox();
  const fixedInterview = await fixedTextStyles(floating.locator('body'));
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
          '.transcript-item > p,.floating-question,.answer-bubble,.answer-bubble .markdown-content',
        ),
      ].map((e) => parseFloat(getComputedStyle(e).fontSize)),
      icons: [...document.querySelectorAll('.floating-question > svg')].map((e) => ({
        width: e.getBoundingClientRect().width,
        size: parseFloat(e.style.getPropertyValue('--icon-size')),
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
      metrics.icons.every((m) => Math.abs(m.width - m.size) < 0.01),
      JSON.stringify(metrics),
    );
    assert.equal(metrics.overflow, false);
    assert.deepEqual(await fixedTextStyles(floating.locator('body')), fixedInterview);
    assert.equal(
      await floating
        .getByRole('textbox', { name: '面试提问', exact: true })
        .evaluate((element) => getComputedStyle(element).fontSize),
      '14px',
    );
    assert.ok(Math.abs(metrics.heading - (size * 15) / 14) < 0.01);
    assert.deepEqual(
      await floating.locator('.floating-toolbar').boundingBox(),
      toolbar,
      JSON.stringify(
        await floating.locator('.floating-toolbar').evaluate((node) =>
          [...node.querySelectorAll('*')].map((item) => ({
            class: item.className,
            width: item.getBoundingClientRect().width,
            font: getComputedStyle(item).font,
            transform: getComputedStyle(item).transform,
          })),
        ),
      ),
    );
    await capture(floating, 'font-actual-' + size + 'px');
  }
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const floatSettings = floating.getByRole('dialog', { name: '面试设置', exact: true });
  await floatSettings.getByRole('slider', { name: '面试字体大小', exact: true }).fill('18');
  assert.equal(
    await floatSettings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    0,
  );
  await page.waitForFunction((key) => localStorage.getItem(key) === '18', key);
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
  const restarted = await connectUiAccount(app, restartedLogin);
  await openSettings(restarted);
  assert.equal(
    await restarted.getByRole('slider', { name: '面试字体大小', exact: true }).inputValue(),
    '18',
  );
  assert.equal(
    await restarted.evaluate(() => document.documentElement.dataset.interviewTransparency),
    '100',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: bubble-only font scaling, fixed input/placeholder and all text outside bubbles, centered font slider, preview, keyboard and limits, storage failures, persistence, icons, fixed 60% material, cross-window sync, dark interview and minimum bounds; synthetic account/audio only.',
  );
} finally {
  await closeUiApp(app);
}
