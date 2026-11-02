import { connectUiAccount, installUiAccount } from './install-ui-account.mjs';
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
  await installUiAccount(app);
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const open = async () => {
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    assert.equal(
      await page
        .getByRole('navigation', { name: '设置分类' })
        .getByRole('button', { name: 'VoxCue 账号', exact: true })
        .getAttribute('aria-current'),
      'page',
    );
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '通用', exact: true })
      .click();
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
  const noKnowledgeSettings = async () => {
    assert.equal(await category('知识库').count(), 0);
    assert.equal(
      await settings.getByRole('button', { name: '资料使用方式', exact: true }).count(),
      0,
    );
    await geometry();
  };
  await open();
  await category('通用').click();
  assert.deepEqual(
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button')
      .allTextContents(),
    ['VoxCue 账号', 'AI 服务', '本地组件', '面试设置', '通用', '关于与更新'],
  );
  await category('VoxCue 账号').click();
  await settings.getByRole('region', { name: '云同步', exact: true }).waitFor();
  await settings.getByRole('button', { name: '立即同步', exact: true }).waitFor();
  await settings.getByRole('button', { name: '刷新容量', exact: true }).waitFor();
  await settings.getByRole('button', { name: '删除账号', exact: true }).waitFor();
  await geometry();
  await category('通用').click();
  assert.equal(await settings.getByRole('button', { name: '主题色', exact: true }).count(), 0);
  const languageMenu = settings.getByRole('button', { name: '语言', exact: true });
  const personalInfoBefore = await page.evaluate(() =>
    localStorage.getItem('copilot-personal-info-v1'),
  );
  assert.equal(await languageMenu.innerText(), '简体中文');
  await languageMenu.focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await settings.getByRole('menuitemradio').allTextContents(), [
    '简体中文',
    'English',
  ]);
  assert.equal(
    await settings
      .getByRole('menuitemradio', { name: '简体中文', exact: true })
      .getAttribute('aria-checked'),
    'true',
  );
  await page.keyboard.press('Escape');
  assert.equal(await languageMenu.evaluate((node) => node === document.activeElement), true);
  await languageMenu.click();
  await settings.getByRole('menuitemradio', { name: 'English', exact: true }).click();
  const englishSettings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const englishLanguage = englishSettings.getByRole('button', { name: 'Language', exact: true });
  assert.equal(await englishLanguage.innerText(), 'English');
  assert.equal(await page.evaluate(() => localStorage.getItem('voxcue-language-v1')), 'en');
  await englishSettings.getByRole('heading', { name: 'General', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await englishLanguage.click();
  await englishSettings.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1')),
    personalInfoBefore,
    'UI language preference must not change interview language or personal information',
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await open();
  assert.equal(await languageMenu.innerText(), '简体中文');
  const themeMenu = settings.getByRole('button', { name: '外观主题', exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await themeMenu.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
    assert.equal(await page.getByRole('menu').count(), 1);
    assert.equal(await settings.locator('[aria-haspopup="menu"][aria-expanded="true"]').count(), 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === '外观主题',
    );
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await settings.isVisible(), true);
  }
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
  await page.evaluate(() => localStorage.setItem('copilot-accent-color-v1', '#008c95'));
  await systemColor('#8764b8');
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#8764b8',
  );
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
  await noKnowledgeSettings();
  await category('通用').click();
  await page.screenshot({ animations: 'disabled' });
  await category('AI 服务').click();
  await settings.getByRole('region', { name: '账户额度' }).waitFor();
  assert.equal(await settings.getByRole('button', { name: '重置用量', exact: true }).count(), 0);
  await page.screenshot({ animations: 'disabled' });
  await category('关于与更新').click();
  await settings.getByText('VoxCue', { exact: true }).waitFor();
  await category('通用').click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await noKnowledgeSettings();
  await category('面试设置').click();
  await page.screenshot({ animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    window.setMinimumSize(500, 500);
    window.setSize(600, 600);
  });
  await page.waitForFunction(() => innerWidth <= 620);
  await geometry();
  await noKnowledgeSettings();
  await page.screenshot({ animations: 'disabled' });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await open();
  assert.equal(await languageMenu.innerText(), '简体中文');
  await languageMenu.click();
  assert.equal(
    await settings
      .getByRole('menuitemradio', { name: '简体中文', exact: true })
      .getAttribute('aria-checked'),
    'true',
  );
  await settings.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
  assert.equal(await languageMenu.innerText(), '简体中文');
  assert.equal(await page.evaluate(() => localStorage.getItem('voxcue-language-v1')), 'zh-CN');
  assert.equal(
    await page.locator('html').evaluate((element) => element.classList.contains('dark')),
    true,
  );
  assert.equal(await settings.getByRole('button', { name: '主题色', exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('copilot-accent-color-v1')),
    '#008c95',
  );
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
  console.log(
    'Settings categories, language switching, keyboard, themes, persistence and responsive layout passed',
  );
} finally {
  await closeUiApp(app);
}
