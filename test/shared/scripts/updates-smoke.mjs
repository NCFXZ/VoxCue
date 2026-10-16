import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { closeUiApp, installUiAccount } from './install-ui-account.mjs';

await mkdir('test/results', { recursive: true });
const profile = await mkdtemp(path.resolve('test/results/updates-'));
const fixture = path.join(profile, 'main.cjs');
const executable = process.argv
  .find((arg) => arg.startsWith('--app-executable='))
  ?.slice('--app-executable='.length);
if (process.argv.includes('--packaged-bootstrap') && !executable)
  throw Error('Packaged bootstrap requires an executable from the platform runner');
// Only the updater transport/installer is replaced, outside the production app.
// IPC, window/session lifecycle, React and IndexedDB all run unchanged.
await writeFile(
  fixture,
  `
const {app, dialog} = require('electron');
const {EventEmitter} = require('node:events');
app.setAppPath(${JSON.stringify(process.cwd())});
app.getVersion = () => require(${JSON.stringify(path.resolve('package.json'))}).version;
const driver = new EventEmitter();
driver.behavior = 'latest';
driver.checkForUpdates = async () => {
  if (driver.behavior === 'pending') await new Promise(resolve => { driver.finishCheck = resolve; });
  if (driver.behavior === 'error') throw Error('synthetic network failure');
  driver.emit(driver.behavior === 'latest' ? 'update-not-available' : 'update-available', {version:'0.2.0'});
  return null;
};
driver.downloadUpdate = () => new Promise((resolve, reject) => { driver.finishDownload = resolve; driver.failDownload = reject; });
driver.quitAndInstall = () => {
  require('node:fs').writeFileSync(require('node:path').join(app.getPath('userData'), 'installed.json'), JSON.stringify({saved:true}));
  app.quit();
};
globalThis.updateDriver = driver;
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/updates/driver.js'))}).createUpdateDriver = () => driver;
globalThis.updateConfirmation = 0;
const originalDialog = dialog.showMessageBox.bind(dialog);
dialog.showMessageBox = (...args) => args.at(-1).title === '重启并更新 VoxCue'
  ? Promise.resolve({response:globalThis.updateConfirmation}) : originalDialog(...args);
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const launch = async () => {
  app = await electron.launch({ args: [fixture], env });
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  assert.equal(
    await login.evaluate(() =>
      window.desktop.updates({ op: 'install' }).then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.evaluate(() => window.desktop.enterDemo()),
  ]);
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
  return page;
};
const openUpdates = async (page) => {
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '更新', exact: true })
    .click();
  return settings;
};
const waitPhase = (page, phase) =>
  page.waitForFunction(
    async (phase) => (await window.desktop.updates({ op: 'status' })).phase === phase,
    phase,
  );
const assertLoadingMotion = async (page, button) => {
  assert.equal(await button.isDisabled(), true);
  const spinner = button.locator('span:has(> svg)');
  const initial = await spinner.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      name: style.animationName,
      duration: parseFloat(style.animationDuration),
      transform: style.transform,
    };
  });
  assert.notEqual(initial.name, 'none', 'Busy update icon must have a CSS animation');
  assert.ok(initial.duration > 0, 'Busy update animation must have a positive duration');
  await page.waitForFunction(
    ({ initial }) => {
      const spinner = document.querySelector('.settings-entry button:disabled span:has(> svg)');
      return (
        spinner &&
        getComputedStyle(spinner).transform !== initial &&
        getComputedStyle(spinner).transform !== 'none'
      );
    },
    { initial: initial.transform },
  );
  return initial.duration;
};
try {
  let page = await launch();
  await page
    .getByRole('textbox', { name: '聊天消息', exact: true })
    .fill('更新后需要恢复的合成草稿');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'update.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('synthetic attachment'),
    });
  let settings = await openUpdates(page);
  await settings.getByText('当前已是最新版本。', { exact: true }).waitFor();
  await app.evaluate(() => {
    globalThis.updateDriver.behavior = 'pending';
  });
  await settings.getByRole('button', { name: '检查更新', exact: true }).click();
  const checking = settings.getByRole('button', { name: '检查中…', exact: true });
  await checking.waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await assertLoadingMotion(page, checking);
    await page.screenshot({ path: path.join(profile, `checking-${theme}.png`) });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await checking
        .locator('span:has(> svg)')
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
      'Honor the existing system reduced-motion preference',
    );
    assert.equal(
      await checking.isVisible(),
      true,
      'Reduced motion keeps the checking status visible',
    );
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(() => {
    globalThis.updateDriver.behavior = 'latest';
    globalThis.updateDriver.finishCheck();
  });
  await settings.getByRole('button', { name: '检查更新', exact: true }).waitFor();
  assert.equal(
    await settings.locator('button span:has(> svg)').count(),
    0,
    'Completed check removes its spinner',
  );
  await app.evaluate(() => {
    globalThis.updateDriver.behavior = 'error';
  });
  await settings.getByRole('button', { name: '检查更新', exact: true }).click();
  await settings
    .getByRole('alert')
    .getByText('检查更新失败，请检查网络连接或稍后重试。', { exact: true })
    .waitFor();
  await app.evaluate(() => {
    globalThis.updateDriver.behavior = 'available';
  });
  await settings.getByRole('button', { name: '检查更新', exact: true }).click();
  await settings.getByText('发现新版本 0.2.0', { exact: true }).waitFor();
  await settings.getByRole('button', { name: '下载更新', exact: true }).click();
  await waitPhase(page, 'downloading');
  await assertLoadingMotion(page, settings.getByRole('button', { name: '下载中…', exact: true }));
  await app.evaluate(() => globalThis.updateDriver.emit('download-progress', { percent: 37.8 }));
  await settings.getByText('正在下载更新 37%', { exact: true }).waitFor();
  await app.evaluate(() =>
    globalThis.updateDriver.failDownload(Error('synthetic checksum failure')),
  );
  await settings
    .getByRole('alert')
    .getByText('更新下载或校验失败，请重试下载。', { exact: true })
    .waitFor();
  await settings.getByRole('button', { name: '下载更新', exact: true }).click();
  await waitPhase(page, 'downloading');
  await app.evaluate(() => {
    globalThis.updateDriver.emit('update-downloaded');
    globalThis.updateDriver.finishDownload();
  });
  await settings.getByRole('button', { name: '重启并更新', exact: true }).waitFor();
  const configuration = {
    mode: 'mock',
    options: { sources: ['system'] },
    aiEnabled: false,
    modelId: '',
    effort: 'auto',
    autoAnswer: true,
  };
  const [interview] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate((configuration) => window.desktop.openInterview(configuration), configuration),
  ]);
  await interview.waitForLoadState();
  await page.waitForFunction(
    async () => (await window.desktop.updates({ op: 'status' })).interviewActive,
  );
  assert.equal(
    await settings.getByRole('button', { name: '重启并更新', exact: true }).isDisabled(),
    true,
  );
  assert.match(
    (await page.evaluate(() => window.desktop.updates({ op: 'install' }))).error,
    /面试进行中/,
  );
  assert.equal(
    await interview.evaluate(() =>
      window.desktop.updates({ op: 'install' }).then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  const interviewClosed = interview.waitForEvent('close');
  await interview.evaluate(() => window.desktop.confirmInterviewEnd());
  await interviewClosed;
  await page.waitForFunction(
    async () => !(await window.desktop.updates({ op: 'status' })).interviewActive,
  );
  await page.evaluate(() => window.desktop.updateSessionState(true));
  await settings.getByRole('button', { name: '重启并更新', exact: true }).click();
  await waitPhase(page, 'downloaded');
  assert.equal(page.isClosed(), false, 'Default confirmation cancels install');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'state') throw Error('synthetic save failure');
      return put.apply(this, args);
    };
    window.restoreUpdateWrites = () => {
      IDBObjectStore.prototype.put = put;
    };
  });
  await page
    .getByRole('textbox', { name: '聊天消息', exact: true })
    .fill('更新保存失败后恢复的合成草稿');
  await page.getByRole('button', { name: '重试保存聊天', exact: true }).waitFor();
  settings = await openUpdates(page);
  await app.evaluate(() => {
    globalThis.updateConfirmation = 1;
  });
  await settings.getByRole('button', { name: '重启并更新', exact: true }).click();
  await settings
    .getByRole('alert')
    .getByText('更新尚未安装，窗口已保留。请确认聊天已保存后重试。', { exact: true })
    .waitFor();
  assert.equal(page.isClosed(), false);
  await page.evaluate(() => window.restoreUpdateWrites());
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await page.screenshot({
      path: path.join(profile, `updates-${theme}.png`),
      animations: 'disabled',
    });
  }
  const restarted = app.waitForEvent('close');
  await settings.getByRole('button', { name: '重启并更新', exact: true }).click();
  await restarted;
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'installed.json'), 'utf8')), {
    saved: true,
  });
  page = await launch();
  assert.equal(
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).inputValue(),
    '更新保存失败后恢复的合成草稿',
  );
  await page.locator('.chat-attachment').getByText('update.txt', { exact: false }).waitFor();
  if (process.argv.includes('--packaged-bootstrap')) {
    await closeUiApp(app);
    app = await electron.launch({
      executablePath: path.resolve(executable),
      args: [],
      env,
    });
    await installUiAccount(app);
    await app.evaluate(({ app }) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdates = async () => {
        autoUpdater.emit('update-not-available', { version: app.getVersion() });
        return null;
      };
    });
    const login = await app.firstWindow();
    [page] = await Promise.all([
      app.waitForEvent('window'),
      login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
    ]);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
    assert.equal(
      await page.getByRole('textbox', { name: '聊天消息', exact: true }).inputValue(),
      '更新保存失败后恢复的合成草稿',
    );
    await page.locator('.chat-attachment').getByText('update.txt', { exact: false }).waitFor();
    const bytes = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('voxcue-preparation-chats', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const files = await new Promise((resolve, reject) => {
        const request = db.transaction('files').objectStore('files').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return Promise.all(files.map((file) => file.blob.text()));
    });
    assert.deepEqual(bytes, ['synthetic attachment']);
    const version = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).version;
    assert.equal(
      (await page.evaluate(() => window.desktop.updates({ op: 'status' }))).currentVersion,
      version,
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(profile, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'checking/download animation advances in light/dark themes, reduced motion respected, completion removes spinner',
          'settings check/download/progress/retry',
          'main-frame authorization',
          'interview blocks install',
          'cancel preserves window',
          'save failure blocks install',
          'successful save before restart',
          'draft and attachment survive restart',
        ],
        rendererErrors: errors.length,
        packagedBootstrap: process.argv.includes('--packaged-bootstrap'),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, profile }));
} finally {
  if (app) await closeUiApp(app).catch(() => {});
}
