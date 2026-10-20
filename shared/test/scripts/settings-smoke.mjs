import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/settings-profile-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [await offlineElectronEntry()], env });
try {
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.evaluate(() => window.desktop.enterDemo()),
  ]);
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const open = async () => {
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  };
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const category = (name) =>
    settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name, exact: true });
  const geometry = async () => {
    assert.equal(
      await settings.evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight &&
          [...dialog.querySelectorAll('.settings-sidebar, .settings-content')].every(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          )
        );
      }),
      true,
      'Settings and document rows must fit the window',
    );
  };
  const knowledgeMenu = async (theme) => {
    await category('知识库').click();
    const trigger = settings.getByRole('button', { name: '资料使用方式', exact: true });
    assert.equal(await settings.locator('select').count(), 0);
    assert.equal(
      await settings.locator('.settings-value').evaluate((e) => getComputedStyle(e).fontSize),
      '14px',
    );
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const selected = settings.getByRole('menuitemradio', {
      name: '自动查找相关资料（默认）',
      exact: true,
    });
    await selected.waitFor();
    assert.equal(await selected.getAttribute('aria-checked'), 'true');
    assert.equal(await selected.evaluate((e) => getComputedStyle(e).fontSize), '14px');
    assert.equal(
      await selected.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
      true,
      'Menu must be visible above the native dialog',
    );
    await geometry();
    await page.screenshot({ animations: 'disabled' });
    await page.keyboard.press('Escape');
    await selected.waitFor({ state: 'detached' });
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === '资料使用方式',
    );
    assert.equal(await trigger.evaluate((e) => document.activeElement === e), true);
    assert.equal(await settings.isVisible(), true);
  };
  await open();
  assert.equal(await category('个性化').getAttribute('aria-current'), 'page');
  assert.equal(await settings.getByRole('navigation').getByRole('button').count(), 7);
  const accent = settings.getByRole('button', { name: '主题色', exact: true });
  await accent.getByText('跟随系统', { exact: true }).waitFor();
  assert.equal(
    await settings
      .getByRole('button', { name: /调整聊天模型|调整聊天思考强度|调整回答风格/ })
      .count(),
    0,
  );
  assert.equal(await settings.getByText(/聊天偏好用于后续准备聊天/).count(), 0);
  const systemColor = async (color) =>
    app.evaluate(({ BrowserWindow }, value) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('appearance:accent-changed', value);
    }, color);
  await systemColor('#0078d4');
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#0078d4',
  );
  await accent.click();
  await settings.getByRole('menuitemradio', { name: '紫色', exact: true }).click();
  await systemColor('#16835d');
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#8764b8',
  );
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.restoreAccentStorage = () => (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (key, value) {
      if (key === 'copilot-accent-color-v1') throw Error('Synthetic storage failure');
      return original.call(this, key, value);
    };
  });
  await accent.click();
  await settings.getByRole('menuitemradio', { name: '橙色', exact: true }).click();
  await settings.getByRole('alert').getByText('主题色保存失败', { exact: false }).waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('copilot-accent-color-v1')),
    '#8764b8',
  );
  await page.evaluate(() => globalThis.restoreAccentStorage());
  await accent.click();
  await settings.getByRole('menuitemradio', { name: '蓝色', exact: true }).click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(
    await settings.isVisible(),
    true,
    'Escape closes theme menu before the settings dialog',
  );
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '浅色', exact: true }).click();
  await geometry();
  await knowledgeMenu('light');
  await category('个性化').click();
  await page.screenshot({ animations: 'disabled' });
  await category('账户与用量').click();
  await settings.getByRole('region', { name: '本应用用量' }).waitFor();
  assert.equal(
    await settings.getByRole('button', { name: '重置用量', exact: true }).isDisabled(),
    true,
  );
  await page.screenshot({ animations: 'disabled' });
  await category('关于').click();
  await settings.getByText('VoxCue', { exact: true }).waitFor();
  await category('个性化').click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await knowledgeMenu('dark');
  await category('面试设置').click();
  await page.screenshot({ animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    window.setMinimumSize(500, 500);
    window.setSize(600, 600);
  });
  await page.waitForFunction(() => innerWidth <= 620);
  await geometry();
  await knowledgeMenu('narrow');
  await page.screenshot({ animations: 'disabled' });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await open();
  assert.equal(
    await page.locator('html').evaluate((element) => element.classList.contains('dark')),
    true,
  );
  await accent.getByText('蓝色', { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#0078d4',
  );
  await accent.click();
  await settings.getByRole('menuitemradio', { name: '跟随系统', exact: true }).click();
  await systemColor('#c74a85');
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#c74a85',
  );
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  assert.deepEqual(errors, []);
  console.log('Settings categories, themes, persistence and responsive layout passed');
} finally {
  await closeUiApp(app);
}
