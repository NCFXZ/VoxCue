import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/settings-profile-'));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const login = await app.firstWindow();
  await login.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).waitFor();
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
  await open();
  assert.equal(await category('常规').getAttribute('aria-current'), 'page');
  assert.equal(await settings.getByRole('navigation').getByRole('button').count(), 4);
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
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/settings-general-light.png',
  });
  await category('账户与用量').click();
  await settings.getByRole('region', { name: '本应用用量' }).waitFor();
  assert.equal(
    await settings.getByRole('button', { name: '重置用量', exact: true }).isDisabled(),
    true,
  );
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/settings-account-light.png',
  });
  await category('关于').click();
  await settings.getByText('VoxCue', { exact: true }).waitFor();
  await category('常规').click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await category('面试设置').click();
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/settings-interview-dark.png',
  });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    window.setMinimumSize(500, 500);
    window.setSize(600, 600);
  });
  await page.waitForFunction(() => innerWidth <= 620);
  await geometry();
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/settings-interview-narrow.png',
  });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await open();
  assert.equal(await page.locator('html').getAttribute('class'), 'dark');
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
  await app.close();
}
