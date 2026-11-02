import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  connectUiAccount,
  installUiAccount,
} from '../../../shared/test/scripts/install-ui-account.mjs';
import { captureRequested } from '../../../shared/test/scripts/capture-requested.mjs';
import { execFileSync } from 'node:child_process';

const materialProbe = path.join(testRoot, 'window-material-probe.node');
execFileSync('/usr/bin/xcrun', [
  'clang++',
  '-std=c++17',
  '-fobjc-arc',
  '-DNAPI_VERSION=8',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-arch',
  'arm64',
  '-mmacosx-version-min=14.2',
  '-I',
  path.resolve('.cache/node-api-headers'),
  'test/fixtures/window-material-probe.mm',
  '-framework',
  'AppKit',
  '-o',
  materialProbe,
]);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', materialProbe], { stdio: 'pipe' });

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
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  assert.deepEqual(
    await login.locator('.login-drag-region').evaluate((node) => ({
      display: getComputedStyle(node).display,
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
      top: node.getBoundingClientRect().top,
      viewport: innerWidth,
      region: getComputedStyle(node).webkitAppRegion,
      hidden: node.getAttribute('aria-hidden'),
      tabIndex: node.tabIndex,
    })),
    {
      display: 'block',
      width: await login.evaluate(() => innerWidth),
      height: 72,
      top: 0,
      viewport: await login.evaluate(() => innerWidth),
      region: 'drag',
      hidden: 'true',
      tabIndex: -1,
    },
    'Mac login uses only the full-width top drag strip without a focus or accessibility item',
  );
  assert.equal(await login.locator('.window-controls').count(), 0);
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getWindowButtonPosition(),
    ),
    { x: 16, y: 18 },
  );
  await login.screenshot({});
  await captureRequested(login, 'mac-login-native-chrome');
  checks.push('登录窗口使用系统左上角控件，HTML 中没有 Windows 窗口按钮');
  await installUiAccount(app);
  const page = await connectUiAccount(app, login);
  page.on('pageerror', (error) => errors.push(error.message));
  const surface = page;
  const input = () => surface.getByRole('textbox', { name: '聊天消息', exact: true });
  await input().waitFor();
  await surface.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
  const mainWindowId = await (await app.browserWindow(page)).evaluate((win) => win.id);
  const material = await app.evaluate(
    ({ app, BrowserWindow }, { probePath, mainWindowId }) => {
      if (!app.getPath('userData').includes('/test/results/window-native-'))
        throw Error('Non-test profile');
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const win = BrowserWindow.fromId(mainWindowId);
      return require(probePath).probe(win.getNativeWindowHandle());
    },
    { probePath: materialProbe, mainWindowId },
  );
  assert.ok(material.sidebars > 0 && material.visible > 0, JSON.stringify(material));
  assert.equal(
    await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  checks.push('真实原生窗口包含可见的旧版sidebar vibrancy，网页无不透明底板遮挡');
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
  assert.equal(metrics.collapseCenter, 25);
  assert.ok(metrics.brandTop >= 44);
  assert.deepEqual(
    await app.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id).getWindowButtonPosition(),
      mainWindowId,
    ),
    { x: 16, y: 18 },
  );
  assert.ok(
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items.some((item) => item.role === 'windowmenu'),
    ),
  );
  await page.screenshot({ animations: 'disabled' });
  await captureRequested(page, 'mac-main-native-chrome-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.screenshot({ animations: 'disabled' });
  await captureRequested(page, 'mac-main-native-chrome-dark');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('.sidebar');
    const toggle = sidebar.querySelector('.sidebar-toggle-button').getBoundingClientRect();
    return sidebar.classList.contains('collapsed') && Math.abs(toggle.top - 54) < 1;
  });
  assert.equal(await page.locator('.window-controls').count(), 0);
  await captureRequested(page, 'mac-main-native-chrome-collapsed');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  const main = await app.browserWindow(page);
  assert.equal(await main.evaluate((win) => win.isFullScreenable()), true);
  await main.evaluate(
    (win) =>
      new Promise((resolve) => {
        win.once('minimize', () => resolve());
        win.minimize();
      }),
  );
  assert.equal(await main.evaluate((win) => win.isMinimized()), true);
  await main.evaluate(
    (win) =>
      new Promise((resolve) => {
        win.once('restore', () => resolve());
        win.restore();
      }),
  );
  await page.waitForFunction(() => document.visibilityState === 'visible');
  checks.push('原生最小化/恢复可用，侧栏收起不遮挡红绿灯，主窗保留系统全屏能力');
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
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), mainWindowId);
  await closed;
  assert.equal(testProcess.exitCode, null);
  assert.equal(app.windows().length, 0);
  checks.push('取消退出保持窗口；随后关闭主窗口会保存并驻留 Dock');
  const next = app.waitForEvent('window');
  await app.evaluate(({ app }) => app.emit('activate'));
  const reopened = await next;
  const restored = reopened;
  await restored.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await restored.waitForFunction(
    () => document.querySelector('[aria-label="聊天消息"]')?.value === 'Mac 窗口恢复测试草稿',
  );
  assert.equal(
    await restored.getByRole('textbox', { name: '聊天消息', exact: true }).inputValue(),
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
