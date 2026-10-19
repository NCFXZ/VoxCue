import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const output = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/window-native-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: output, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const testProcess = app.process();
const checks = [],
  errors = [];
try {
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  assert.equal(await login.locator('.window-controls').count(), 0);
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getWindowButtonPosition(),
    ),
    { x: 16, y: 18 },
  );
  await login.screenshot({});
  checks.push('登录窗口使用系统左上角控件，HTML 中没有 Windows 窗口按钮');
  await installUiAccount(app);
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.on('pageerror', (error) => errors.push(error.message));
  const input = () => page.getByRole('textbox', { name: '聊天消息', exact: true });
  await input().waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
  assert.equal(await page.locator('.window-controls').count(), 0);
  assert.equal(await page.locator('.titlebar').count(), 0);
  const metrics = await page.locator('.app-body').evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    height: element.getBoundingClientRect().height,
    viewportHeight: innerHeight,
    brandTop: element.querySelector('.sidebar-wordmark').getBoundingClientRect().top,
    brandHeight: element.querySelector('.sidebar-wordmark').getBoundingClientRect().height,
    headingTop: element.querySelector('.sidebar-heading').getBoundingClientRect().top,
    collapseCenter: (() => {
      const box = element.querySelector('.sidebar-heading button').getBoundingClientRect();
      return box.top + box.height / 2;
    })(),
  }));
  assert.equal(metrics.top, 0);
  assert.equal(metrics.height, metrics.viewportHeight);
  assert.equal(metrics.headingTop, 44);
  assert.equal(metrics.brandTop + metrics.brandHeight / 2, metrics.collapseCenter);
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === 'VoxCue')
        .getWindowButtonPosition(),
    ),
    { x: 16, y: 18 },
  );
  assert.ok(
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items.some((item) => item.role === 'windowmenu'),
    ),
  );
  await page.screenshot({ animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.screenshot({ animations: 'disabled' });
  checks.push('主窗口内容从顶部铺满，品牌紧接原生红绿灯下方，菜单和浅深主题正常');
  // Cancel Cmd+Q while an unsaved operation exists. A later red-button close
  // must still leave the Mac app resident rather than replaying the canceled quit.
  await page.evaluate(() => window.desktop.updateSessionState(true));
  await app.evaluate(({ app, dialog }) => {
    if (!app.getPath('userData').includes('/test/results/window-native-'))
      throw Error('Non-test profile');
    dialog.showMessageBox = async () => {
      globalThis.nativeQuitCancelled = true;
      return { response: 0, checkboxChecked: false };
    };
    app.quit();
  });
  await page.waitForFunction(() => document.visibilityState === 'visible');
  assert.equal(await app.evaluate(() => globalThis.nativeQuitCancelled), true);
  await page.evaluate(() => window.desktop.updateSessionState(false));
  await input().fill('Mac 窗口恢复测试草稿');
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle() === 'VoxCue')
      .close(),
  );
  await closed;
  assert.equal(testProcess.exitCode, null);
  assert.equal(app.windows().length, 0);
  checks.push('取消退出保持窗口；随后关闭主窗口会保存并驻留 Dock');
  const next = app.waitForEvent('window');
  await app.evaluate(({ app }) => app.emit('activate'));
  const reopened = await next;
  await reopened.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await reopened.waitForFunction(
    () => document.querySelector('[aria-label="聊天消息"]')?.value === 'Mac 窗口恢复测试草稿',
  );
  assert.equal(
    await reopened.getByRole('textbox', { name: '聊天消息', exact: true }).inputValue(),
    'Mac 窗口恢复测试草稿',
  );
  checks.push('Dock 激活恢复已登录主窗口和本机草稿');
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Cmd+Q did not quit after save')), 20000);
    testProcess.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  assert.equal(await exited, 0);
  checks.push('退出操作完成保存后真正结束进程');
  assert.deepEqual(errors, []);
  await console.log(JSON.stringify({ status: 'passed', checks, errors }, null, 2));
  console.log(JSON.stringify({ status: 'passed', output, checks }));
} catch (error) {
  await console.log(
    JSON.stringify({ status: 'failed', error: String(error), checks, errors }, null, 2),
  );
  throw error;
} finally {
  if (testProcess.exitCode === null) testProcess.kill();
}
