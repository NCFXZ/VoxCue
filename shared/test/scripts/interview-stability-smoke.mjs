import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { testRoot, electron } from './test-workspace.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';

const profile = path.join(testRoot, 'profile');
await mkdir(profile);
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
const errors = [];
const memory = [];
async function nativeReady(predicate, label) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (await app.evaluate(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error(label);
}
try {
  await app.evaluate(({ app }) => {
    globalThis.stabilityDockTrace = [];
    if (!app.dock) return;
    const dock = app.dock,
      hide = dock.hide.bind(dock),
      show = dock.show.bind(dock);
    dock.hide = () => {
      globalThis.stabilityDockTrace.push({ op: 'hide', at: Date.now(), visible: dock.isVisible() });
      return hide();
    };
    dock.show = async () => {
      globalThis.stabilityDockTrace.push({ op: 'show', at: Date.now(), visible: dock.isVisible() });
      const value = await show();
      globalThis.stabilityDockTrace.push({
        op: 'shown',
        at: Date.now(),
        visible: dock.isVisible(),
      });
      return value;
    };
  });
  await installUiAccount(app, { speech: true });
  const login = await app.firstWindow();
  const [main] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  main.on('pageerror', (error) => errors.push(error.message));
  await main.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const slider = main.getByRole('slider', { name: '毛玻璃透明度', exact: true });
  await slider.focus();
  await main.keyboard.press('Home');
  await main.waitForFunction(() => localStorage.getItem('voxcue-frosted-transparency-v2') === '0');
  await main.keyboard.press('End');
  await main.waitForFunction(
    () => localStorage.getItem('voxcue-frosted-transparency-v2') === '100',
  );
  await main.getByRole('button', { name: '关闭设置', exact: true }).click();
  for (let cycle = 0; cycle < 20; cycle++) {
    await main.getByRole('button', { name: '开始面试', exact: true }).click();
    const [floating] = await Promise.all([
      app.waitForEvent('window'),
      main
        .getByRole('dialog', { name: '开始面试', exact: true })
        .getByRole('button', { name: '确认开始', exact: true })
        .click(),
    ]);
    floating.on('pageerror', (error) => errors.push(error.message));
    await floating.locator('.answer-text').first().waitFor();
    assert.equal(
      await floating
        .getByRole('button', { name: '发送题目时附当前截图', exact: true })
        .getAttribute('aria-pressed'),
      'false',
    );
    const status = await floating.evaluate(() => window.desktop.interviewState());
    assert.equal(status.pinned, true);
    assert.equal(status.configuration.mode, 'local');
    if (process.platform === 'darwin')
      await nativeReady(({ app }) => !app.dock.isVisible(), 'Dock did not hide');
    if (process.platform === 'win32')
      await nativeReady(({ BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows();
        const current = windows.find((w) => w.webContents.getURL().endsWith('#interview'));
        const main = windows.find((w) => !w.webContents.getURL().includes('#'));
        return !!current?.isVisible() && current.isAlwaysOnTop() && !!main && !main.isVisible();
      }, 'Windows interview must stay topmost with main hidden');
    const value = [0, 50, 100][cycle % 3];
    await floating.evaluate((value) => {
      localStorage.setItem('voxcue-frosted-transparency-v2', JSON.stringify(value));
      window.dispatchEvent(new StorageEvent('storage', { key: 'voxcue-frosted-transparency-v2' }));
    }, value);
    await floating.waitForFunction(
      (value) => document.documentElement.dataset.frostedTransparency === String(value),
      value,
    );
    assert.equal(
      await floating
        .locator('.floating-question')
        .first()
        .evaluate((e) => getComputedStyle(e).textShadow),
      'none',
    );
    await floating.getByRole('button', { name: '转写面板', exact: true }).click();
    await floating.waitForFunction(() => document.querySelectorAll('.floating-panel').length === 1);
    await floating.getByRole('button', { name: '转写面板', exact: true }).click();
    await floating.waitForFunction(() => document.querySelectorAll('.floating-panel').length === 2);
    if (cycle % 5 === 0) {
      await floating.reload();
      await floating.locator('.answer-text').first().waitFor();
      assert.equal(
        (await floating.evaluate(() => window.desktop.interviewState())).configuration.mode,
        'local',
      );
    }
    const closed = floating.waitForEvent('close');
    await floating.getByRole('button', { name: '结束面试', exact: true }).click();
    await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
    await closed;
    await main.waitForFunction(() => document.visibilityState === 'visible');
    await nativeReady(
      ({ BrowserWindow, app }) =>
        BrowserWindow.getAllWindows().length === 1 &&
        BrowserWindow.getAllWindows()[0].isVisible() &&
        (process.platform !== 'darwin' || app.dock.isVisible()),
      'Interview window or hidden Dock leaked',
    );
    memory.push(await app.evaluate(() => process.memoryUsage().rss));
    assert.deepEqual(errors, []);
    console.log(`Interview cycle ${cycle + 1}/20 passed`);
  }
  assert.ok(
    memory.at(-1) - memory[4] < 256 * 1024 * 1024,
    'Main-process growth exceeded 256 MiB after warmup',
  );
  console.log(
    JSON.stringify({
      cycles: 20,
      reloads: 4,
      errors,
      memoryStart: memory[4],
      memoryEnd: memory.at(-1),
      syntheticAudioAndProvider: true,
      nativeBrowserWindows: true,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      await app.evaluate(({ BrowserWindow, app }) => ({
        dock: app.dock?.isVisible(),
        trace: globalThis.stabilityDockTrace,
        windows: BrowserWindow.getAllWindows().map((win) => ({
          id: win.id,
          visible: win.isVisible(),
          url: win.webContents.getURL().split('#')[1] ?? 'main',
        })),
      })),
    ),
  );
  throw error;
} finally {
  await closeUiApp(app);
}
