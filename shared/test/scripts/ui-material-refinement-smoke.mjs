import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';

// Real renderer and pointer events; synthetic account, speech and content only.
// Ordinary runs save no images; explicit captures use the requested directory.
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'refinement'),
    VITE_DEV_SERVER_URL: '',
  },
});
const errors = [];
const settle = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.effect?.getTiming().iterations === Infinity || a.playState !== 'running'),
  );
const theme = async (page, dark) => {
  await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
  await settle(page);
};
const modalStyle = async (dialog, backdrop = 'rgba(0, 0, 0, 0.4)') => {
  const style = await dialog.evaluate((e) => ({
    shadow: getComputedStyle(e).boxShadow,
    backdrop: getComputedStyle(e, '::backdrop').backgroundColor,
    filter: getComputedStyle(e, '::backdrop').backdropFilter,
  }));
  assert.deepEqual(style, { shadow: 'none', backdrop, filter: 'none' });
};
const hoverOnly = async (page, button) => {
  await page.mouse.move(1, 1);
  await button.evaluate((e) => e.blur());
  await settle(page);
  assert.equal(
    await button.evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  assert.equal(await button.evaluate((e) => getComputedStyle(e).boxShadow), 'none');
  const before = await button.boundingBox();
  await button.hover();
  await settle(page);
  assert.equal(await button.evaluate((e) => e.matches(':hover')), true);
  assert.notEqual(
    await button.evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  assert.deepEqual(await button.boundingBox(), before);
  await page.keyboard.press('Tab');
  await button.focus();
  await page.mouse.move(1, 1);
  await settle(page);
  assert.equal(await button.evaluate((e) => e.matches(':focus-visible')), true);
  assert.notEqual(
    await button.evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  assert.deepEqual(await button.boundingBox(), before);
};
const centeredFont = async (scope) => {
  assert.equal(await scope.getByRole('slider', { name: '面试背景透明度', exact: true }).count(), 0);
  assert.equal(await scope.getByRole('slider', { name: '面试字体大小', exact: true }).count(), 1);
  const bounds = await scope.locator('.interview-display-controls').evaluate((e) => {
    const a = e.getBoundingClientRect(),
      b = e.parentElement.getBoundingClientRect();
    return { center: a.x + a.width / 2, parent: b.x + b.width / 2 };
  });
  assert.ok(Math.abs(bounds.center - bounds.parent) < 1, JSON.stringify(bounds));
};
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    ChatGPTService.prototype.stream = async (request) => ({
      answerText: '合成控件回归',
      usage: null,
      sources: [],
      ...(request.id.startsWith('history-title-')
        ? {}
        : {
            profileChanges: {
              background: '合成摘要',
              skills: [
                { id: 'synthetic', title: '合成技能', content: '只用于控件验证', sources: [] },
              ],
            },
          }),
    });
  });
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluate(() => {
    localStorage.setItem('voxcue-frosted-transparency-v2', '0');
    localStorage.setItem('voxcue-frosted-strength-v1', 'off');
    localStorage.setItem('voxcue-interview-background-transparency-v1', '100');
  });
  await page.reload();
  await page
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Model', { exact: true })
    .waitFor();
  for (const dark of [false, true]) {
    await theme(page, dark);
    for (const name of ['添加附件', '聊天模型', '思考强度'])
      await hoverOnly(page, page.getByRole('button', { name, exact: true }));
  }
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('合成控件检查');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.proposal-view').first().waitFor();
  for (const dark of [false, true]) {
    await theme(page, dark);
    for (const button of await page.locator('.proposal-view').all()) await hoverOnly(page, button);
  }
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  for (const dark of [false, true]) {
    await theme(page, dark);
    await modalStyle(settings);
    await captureRequested(page, 'main-settings-' + (dark ? 'dark' : 'light'));
  }
  assert.equal(
    await settings.getByRole('slider', { name: '毛玻璃透明度', exact: true }).count(),
    0,
  );
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  await centeredFont(settings);
  assert.equal(
    await settings
      .locator('.interview-preview-scene')
      .evaluate((e) => e.classList.contains('dark')),
    true,
  );
  await settings.getByRole('slider', { name: '面试字体大小', exact: true }).fill('18');
  await captureRequested(page, 'settings-centered-font');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();

  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: '创建知识库', exact: true }).first().click();
  const create = page.getByRole('dialog', { name: '创建知识库', exact: true });
  for (const dark of [false, true]) {
    await theme(page, dark);
    await modalStyle(create);
  }
  await create.getByRole('textbox', { name: '知识库名称', exact: true }).fill('合成材质验证');
  await create.getByRole('button', { name: '保存', exact: true }).click();
  await create.waitFor({ state: 'hidden' });
  const library = page.locator('.knowledge-detail-dialog');
  await library.waitFor();
  for (const dark of [false, true]) {
    await theme(page, dark);
    await modalStyle(library);
  }
  await captureRequested(page, 'knowledge-detail-dimmed');
  await library.getByRole('button', { name: '关闭对话框', exact: true }).click();

  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.evaluate(() => {
    const start = Date.now() - 600000;
    const record = {
      id: 'material-history',
      title: '合成搜索记录',
      titleStatus: 'ready',
      startedAt: start,
      endedAt: Date.now(),
      status: 'ended',
      mock: false,
      transcripts: Array.from({ length: 70 }, (_, i) => ({
        id: 't' + i,
        source: 'system',
        text: '第' + i + '条合成转写，用于检查滚动覆盖。',
        time: '10:00',
        startMs: start + i * 1000,
        final: true,
      })),
      answers: [],
    };
    localStorage.setItem('copilot-interview-history-v1', JSON.stringify([record]));
    window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
  });
  await page.locator('.history-row').waitFor();
  const search = page.getByRole('searchbox', { name: '搜索标题' });
  const searchStyle = await search.evaluate((e) => ({
    left: getComputedStyle(e).paddingLeft,
    height: Math.round(e.getBoundingClientRect().height),
  }));
  assert.deepEqual(searchStyle, { left: '20px', height: 44 });
  await search.fill('合成');
  const searchBox = await search.boundingBox();
  const clearInset = await search.evaluate((e) => parseFloat(getComputedStyle(e).paddingRight) + 6);
  await page.mouse.click(
    searchBox.x + searchBox.width - clearInset,
    searchBox.y + searchBox.height / 2,
  );
  assert.equal(await search.inputValue(), '');
  await page.locator('.history-row').click();
  await page.locator('.record-transcript-scroll').evaluate((e) => (e.scrollTop = 320));
  await page.waitForFunction(
    () => Number(document.documentElement.style.getPropertyValue('--web-header-opacity')) === 1,
  );
  const header = await page.locator('.record-detail-toolbar').evaluate((e) => ({
    filter: getComputedStyle(e, '::before').backdropFilter,
    opacity: getComputedStyle(e, '::before').opacity,
    width: e.getBoundingClientRect().width,
    parent: e.parentElement.getBoundingClientRect().width,
    height: e.getBoundingClientRect().height,
    materialHeight: parseFloat(getComputedStyle(e, '::before').height),
  }));
  assert.match(header.filter, /blur\(24px\)/);
  assert.equal(header.opacity, '1');
  assert.equal(header.width, header.parent);
  assert.ok(Math.abs(header.height - header.materialHeight) < 1, JSON.stringify(header));
  const bodyClip = await page.locator('.record-transcript-scroll').evaluate((e) => {
    const rect = e.getBoundingClientRect();
    const header = document.querySelector('.record-detail-toolbar').getBoundingClientRect();
    return { x: rect.x + 4, y: header.bottom + 12, width: Math.floor(rect.width - 8), height: 180 };
  });
  const visibleBody = await page.screenshot({ clip: bodyClip, scale: 'css' });
  const materialOff = await page.addStyleTag({
    content: '.record-detail-toolbar::before { content: none !important; }',
  });
  assert.equal(
    visibleBody.equals(await page.screenshot({ clip: bodyClip, scale: 'css' })),
    true,
    'Header material must not cover or blur transcript pixels below the toolbar',
  );
  await materialOff.evaluate((e) => e.remove());
  const coveredHeader = await page.locator('.record-detail-toolbar').screenshot({ scale: 'css' });
  await page.locator('.record-transcript-scroll').evaluate((e) => (e.style.visibility = 'hidden'));
  assert.equal(
    coveredHeader.equals(await page.locator('.record-detail-toolbar').screenshot({ scale: 'css' })),
    false,
    'Scrolled transcript content must actually render behind the frosted header',
  );
  await page.locator('.record-transcript-scroll').evaluate((e) => {
    e.style.visibility = '';
  });
  await captureRequested(page, 'history-detail-scrolled');
  await page.locator('.record-transcript-scroll').evaluate((e) => (e.scrollTop = 0));
  await page.waitForFunction(
    () => Number(document.documentElement.style.getPropertyValue('--web-header-opacity')) === 0,
  );
  await page.getByRole('heading', { name: '合成搜索记录', exact: true }).waitFor();

  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  floating.on('pageerror', (e) => errors.push(e.message));
  await floating.locator('.transcript-item > p').first().waitFor();
  for (const colorScheme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      localStorage.setItem('copilot-theme', theme);
      window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-theme' }));
    }, colorScheme);
    await floating.emulateMedia({ colorScheme });
    assert.equal(
      await floating.locator('html').evaluate((e) => e.classList.contains('dark')),
      true,
    );
  }
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const dialog = floating.getByRole('dialog', { name: '面试设置', exact: true });
  await modalStyle(dialog, 'rgba(0, 0, 0, 0)');
  await centeredFont(dialog);
  await captureRequested(floating, 'interview-settings-clear');
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
  const end = floating.getByRole('button', { name: '结束面试', exact: true });
  const beforeEnd = await end.boundingBox();
  await end.click();
  const confirm = floating.getByRole('button', { name: '确认结束面试', exact: true });
  await settle(floating);
  const endStyle = await confirm.evaluate((e) => ({
    shadow: getComputedStyle(e).boxShadow,
    filter: getComputedStyle(e).filter,
    color: getComputedStyle(e).color,
    danger: getComputedStyle(e).getPropertyValue('--danger').trim(),
    height: e.getBoundingClientRect().height,
    overflow: e.scrollWidth > e.clientWidth + 1,
    radius: getComputedStyle(e).borderTopLeftRadius,
    corner: getComputedStyle(e).cornerShape,
    iconOnly: e.classList.contains('button-icon'),
  }));
  assert.equal(endStyle.shadow, 'none');
  assert.equal(endStyle.filter, 'none');
  assert.equal(endStyle.color, 'rgb(255, 133, 139)');
  assert.equal(Math.round(endStyle.height * 100) / 100, Math.round(beforeEnd.height * 100) / 100);
  assert.equal(endStyle.overflow, false);
  assert.equal(endStyle.radius, '999px');
  assert.equal(endStyle.corner, 'round');
  assert.equal(endStyle.iconOnly, false);
  await captureRequested(floating, 'end-confirm-capsule');
  assert.deepEqual(
    await page.evaluate(() => ({
      main: document.documentElement.dataset.frostedTransparency,
      interview: document.documentElement.dataset.interviewTransparency,
      saved: localStorage.getItem('voxcue-frosted-transparency-v2'),
    })),
    { main: '60', interview: '60', saved: '0' },
  );
  await Promise.all([floating.waitForEvent('close'), confirm.click()]);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: all ten UI refinements, hover-only controls, dim/no-glow dialogs, search inset/clear, frozen 60% curves, centered font, dark interview, end confirmation and frosted record header; synthetic data only.',
  );
} finally {
  await app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((win) => win.destroy()))
    .catch(() => {});
  await closeUiApp(app);
}
