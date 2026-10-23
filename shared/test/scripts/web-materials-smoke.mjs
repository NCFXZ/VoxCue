import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';

const entry = path.join(testRoot, 'web-materials.cjs');
await writeFile(
  entry,
  `
const {app,dialog}=require('electron');
dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(91);};
const platform=require(${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/shared/electron/platform/index.js'))});
const select=platform.selectDesktopPlatform;
platform.selectDesktopPlatform=(...args)=>({...select(...args),presentationBindingFile:undefined,
  ...(process.env.VOXCUE_TEST_WEB_RENDERER ? {nativeWindowControls:false} : {})});
require(${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/shared/electron/main.js'))});
`,
);
await mkdir(path.join(testRoot, 'profile'));
const app = await electron.launch({
  args: [await offlineElectronEntry(entry)],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
try {
  await installUiAccount(app, { components: true, speech: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    ChatGPTService.prototype.stream = async (request, emit) => {
      const answerText = Array.from(
        { length: 36 },
        (_, i) => `第${i + 1}段合成回答：用于核对共享毛玻璃的内容覆盖、滚动和阅读对比度。`,
      ).join('\n\n');
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
  await page.waitForFunction(() => document.documentElement.classList.contains('web-materials'));
  assert.equal(await page.evaluate(() => window.desktop.presentation.liquidGlass), false);
  assert.equal(await page.locator('.macos-content-native,.macos-composer-slot').count(), 0);
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const start = page.getByRole('button', { name: '开始面试', exact: true });
    const shape = await start.evaluate((node) => ({
      radius: getComputedStyle(node).borderRadius,
      curve: getComputedStyle(node).getPropertyValue('corner-shape'),
      height: node.getBoundingClientRect().height,
    }));
    assert.deepEqual(shape, { radius: '999px', curve: 'round', height: 36 });
    const composer = page.locator('.composer');
    const idle = await composer.evaluate((node) => ({
      radius: getComputedStyle(node).borderRadius,
      curve: getComputedStyle(node).getPropertyValue('corner-shape'),
      filter: getComputedStyle(node).backdropFilter,
    }));
    assert.equal(idle.radius, '40px');
    assert.match(idle.curve, /superellipse|squircle/);
    assert.match(idle.filter, /blur\(24px\)/);
    await page.getByRole('button', { name: '聊天模型', exact: true }).click();
    const menu = page.getByRole('menu');
    assert.match(
      await menu.evaluate((node) => getComputedStyle(node).backdropFilter),
      /blur\(24px\)/,
    );
    assert.equal(
      await menu
        .locator('[role="menuitemradio"]')
        .first()
        .evaluate((node) => getComputedStyle(node).borderRadius),
      '999px',
    );
    await page.keyboard.press('Escape');
  }
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('共享回退材质检查');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-copy').waitFor();
  const copyAlignment = await page.locator('.chat-message.assistant').evaluate((node) => ({
    text: node.querySelector('.chat-answer').getBoundingClientRect().left,
    icon: node.querySelector('.chat-copy svg').getBoundingClientRect().left,
  }));
  assert.ok(Math.abs(copyAlignment.text - copyAlignment.icon) < 1, JSON.stringify(copyAlignment));
  await page.locator('.chat-scroll').evaluate((node) => {
    node.scrollTop = 400;
  });
  await page.waitForFunction(
    () => Number(document.documentElement.style.getPropertyValue('--web-header-opacity')) === 1,
  );
  const latest = page.getByRole('button', { name: /返回最新/ });
  await latest.waitFor();
  assert.equal(await latest.evaluate((node) => getComputedStyle(node).borderRadius), '50%');
  const before = await latest.evaluate((node) => getComputedStyle(node).backgroundColor);
  await latest.hover();
  assert.notEqual(await latest.evaluate((node) => getComputedStyle(node).backgroundColor), before);
  await latest.click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('slider', { name: '毛玻璃透明度', exact: true }).waitFor();
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).waitFor();
  assert.equal(
    await settings.evaluate((node) => getComputedStyle(node, '::backdrop').backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  for (const [width, dark] of [
    [1280, false],
    [960, true],
  ]) {
    await (await app.browserWindow(page)).evaluate((win, width) => win.setSize(width, 800), width);
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const overflow = await page
      .locator('.composer')
      .evaluate(
        (node) =>
          node.getBoundingClientRect().left < 0 || node.getBoundingClientRect().right > innerWidth,
      );
    assert.equal(overflow, false);
    if (process.argv.includes('--preview')) {
      const file = path.join(testRoot, `web-materials-${width}-${dark ? 'dark' : 'light'}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(JSON.stringify({ preview: file }));
      process.stdin.resume();
      await new Promise((resolve) => process.stdin.once('data', resolve));
      process.stdin.pause();
    }
  }
  console.log(
    'PASS: shared fallback capsules/circles, 40px composer, frosted menus/header/follow, hover, settings and narrow layout.',
  );
} finally {
  await closeUiApp(app);
}
