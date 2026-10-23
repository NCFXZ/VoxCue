import { waitForAsync } from './wait-for-async.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { assertInitialDownloadProgress, assertDownloadButton } from './assert-download-button.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.join(testRoot, 'profile');
for (const name of ['profile', 'tmp', 'home'])
  await mkdir(path.join(testRoot, name), { recursive: true });
const preference = path.join(profile, 'update-settings.json');
await writeFile(preference, JSON.stringify({ schemaVersion: 1, autoDownload: false }));
const fixture = path.join(testRoot, 'updates-sidebar.cjs');
await writeFile(
  fixture,
  `
const {app,dialog}=require('electron');
const {EventEmitter}=require('node:events');
app.setAppPath(${JSON.stringify(process.cwd())});
app.getVersion=()=>require(${JSON.stringify(path.resolve('package.json'))}).version;
const driver=new EventEmitter();
driver.downloads=0;
driver.checkForUpdates=async()=>{driver.emit('update-available',{version:'9.9.9'});return null;};
driver.downloadUpdate=signal=>new Promise((resolve,reject)=>{
 driver.downloads++;
 driver.finishDownload=()=>{driver.emit('update-downloaded');resolve();};
 signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});
});
driver.quitAndInstall=()=>{
 require('node:fs').writeFileSync(require('node:path').join(app.getPath('userData'),'installed.json'),JSON.stringify({explicit:true}));
 app.quit();
};
globalThis.updateDriver=driver;
globalThis.updateConfirmation=0;
const show=dialog.showMessageBox.bind(dialog);
dialog.showMessageBox=(...args)=>args.at(-1)?.title==='重启并更新 VoxCue'
 ?Promise.resolve({response:globalThis.updateConfirmation}):show(...args);
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/updates/driver.js'))}).createUpdateDriver=()=>driver;
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: profile,
  VITE_DEV_SERVER_URL: '',
  HOME: path.join(testRoot, 'home'),
  CFFIXED_USER_HOME: path.join(testRoot, 'home'),
  TMPDIR: path.join(testRoot, 'tmp'),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const launch = async () => {
  app = await electron.launch({ args: [await offlineElectronEntry(fixture)], env });
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  await installUiAccount(app);
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(20000);
  await page.getByRole('button', { name: '聊天模型', exact: true }).waitFor();
  assert.equal(await page.locator('.sidebar-service-status').count(), 0);
  return page;
};
const phase = (page, expected) =>
  waitForAsync(
    page,
    async (expected) => (await window.desktop.updates({ op: 'status' })).phase === expected,
    expected,
  );
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
const closeSettings = async (settings) => {
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
};
const aligned = async (page) => {
  const geometry = await page.locator('.sidebar-status-row').evaluate((element) => {
    const icon = element.querySelector('.sidebar-update');
    const row = element.getBoundingClientRect(),
      button = icon.getBoundingClientRect();
    return {
      fits: button.right <= row.right + 1,
      left: button.left - row.left,
      width: button.width,
      height: button.height,
    };
  });
  assert.ok(geometry.fits && geometry.left >= 0 && geometry.left <= 1, JSON.stringify(geometry));
  assert.equal(geometry.width, 36);
  assert.equal(geometry.height, 36);
};
try {
  let page = await launch();
  const sidebar = page.locator('.sidebar-bottom');
  await phase(page, 'available');
  assert.equal(await app.evaluate(() => globalThis.updateDriver.downloads), 0);
  await sidebar.getByRole('button', { name: '下载更新', exact: true }).waitFor();
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await aligned(page);
    await page.screenshot(); // Buffer only.
  }
  const progress = sidebar.locator('.download-button');
  await assertInitialDownloadProgress(progress, async () => {
    await sidebar.getByRole('button', { name: '下载更新', exact: true }).click();
    await phase(page, 'downloading');
  });
  await page.locator('.breadcrumb').hover();
  await app.evaluate(() => globalThis.updateDriver.emit('download-progress', { percent: 37.8 }));
  await progress.locator('[role="progressbar"][aria-valuenow="37.8"]').waitFor();
  await aligned(page);
  await progress.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  );
  if (process.argv.includes('--preview'))
    console.log(
      JSON.stringify({
        preview: '侧栏下载：固定图标大小，仅显示进度圆环',
        jpeg: (
          await page
            .locator('.sidebar-status-row')
            .screenshot({ type: 'jpeg', quality: 85, scale: 'device' })
        ).toString('base64'),
      }),
    );
  assert.equal(
    await progress.locator('.download-ring').evaluate((el) => getComputedStyle(el).color),
    await progress.evaluate((el) => getComputedStyle(el).color),
  );
  await assertDownloadButton(page, progress, { iconOnly: true });
  if (process.argv.includes('--preview')) {
    await page.keyboard.press('Tab');
    await progress.focus();
    await progress.locator('.download-button-cancel').waitFor({ state: 'visible' });
    await progress.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))),
    );
    console.log(
      JSON.stringify({
        preview: '侧栏取消：固定图标大小，仅显示红色取消图标',
        jpeg: (
          await page
            .locator('.sidebar-status-row')
            .screenshot({ type: 'jpeg', quality: 85, scale: 'device' })
        ).toString('base64'),
      }),
    );
  }
  await progress.click();
  await phase(page, 'available');
  let settings = await openUpdates(page);
  const toggle = () => settings.getByRole('switch', { name: '自动下载更新' });
  assert.equal(await toggle().getAttribute('aria-checked'), 'false');
  await toggle().click();
  await phase(page, 'downloading');
  assert.equal(await toggle().getAttribute('aria-checked'), 'true');
  assert.equal(JSON.parse(await readFile(preference, 'utf8')).autoDownload, true);
  assert.match(await settings.locator('.download-button-progress').innerText(), /\d+%/);
  if (process.argv.includes('--preview'))
    console.log(
      JSON.stringify({
        preview: '更新设置中的自动下载开关',
        jpeg: (
          await toggle().locator('..').screenshot({ type: 'jpeg', quality: 80, scale: 'css' })
        ).toString('base64'),
      }),
    );
  await closeSettings(settings);
  await app.evaluate(() => globalThis.updateDriver.emit('download-progress', { percent: 72 }));
  await sidebar.locator('[role="progressbar"][aria-valuenow="72"]').waitFor();
  await aligned(page);
  settings = await openUpdates(page);
  await toggle().click();
  assert.equal(JSON.parse(await readFile(preference, 'utf8')).autoDownload, false);
  await phase(page, 'downloading'); // Turning off future downloads keeps an active download.
  await closeSettings(settings);
  await app.evaluate(() => globalThis.updateDriver.finishDownload());
  await phase(page, 'downloaded');
  const install = sidebar.getByRole('button', { name: '重启并更新', exact: true });
  await install.waitFor();
  await aligned(page);
  await page.evaluate(() => window.desktop.updateSessionState(true));
  await install.click();
  await phase(page, 'downloaded');
  assert.equal(page.isClosed(), false, 'Default save confirmation cancels installation');
  await page.evaluate(() => window.desktop.updateSessionState(false));
  const exited = app.waitForEvent('close');
  await install.click();
  await exited;
  app = undefined;
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'installed.json'), 'utf8')), {
    explicit: true,
  });
  page = await launch();
  await phase(page, 'available');
  assert.equal(await app.evaluate(() => globalThis.updateDriver.downloads), 0);
  settings = await openUpdates(page);
  assert.equal(await toggle().getAttribute('aria-checked'), 'false');
  console.log(
    'PASS: sidebar fixed 32px icon across update states, themed ring without visible percentage, icon-only red cancel with first-second feedback, settings percentage, automatic download opt-in, background progress, persistent opt-out and explicit save-protected install.',
  );
} finally {
  if (app) await closeUiApp(app);
}
