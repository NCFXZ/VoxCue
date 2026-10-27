import { enterPrimaryUiAccount, installUiAccount } from './install-ui-account.mjs';
import { enterDemoUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { createServer } = workspace.platformRequire('vite');
const profile = path.resolve(path.join(testRoot, 'test/results'), `login-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const dev = process.argv.includes('--dev');
const server = dev
  ? await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } })
  : undefined;
await server?.listen();
const fixture = path.join(testRoot, 'managed-login.cjs');
await writeFile(
  fixture,
  `
const {app}=require('electron');
const root=process.cwd();app.setAppPath(root);
const {CodexUsageRuntime}=require(root+'/dist-electron/shared/electron/backend/chat/codexUsage.js');
// Exercise the current managed login port, never the retired SIWC callback.
// Real runtime protocol and URL validation have their own isolated checks.
CodexUsageRuntime.prototype.login=async function(open,signal){
 await open('https://auth.openai.com/oauth/authorize?client_id=synthetic-managed-client&state=synthetic&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback');
 await new Promise((resolve,reject)=>{
  globalThis.__declineManagedLogin=()=>reject(Error('未完成 ChatGPT 授权'));
  if(signal.aborted)reject(Error('登录已取消'));
  else signal.addEventListener('abort',()=>reject(Error('登录已取消')),{once:true});
 });
};
CodexUsageRuntime.prototype.cancel=function(){};
CodexUsageRuntime.prototype.logout=async function(){};
require(root+'/dist-electron/shared/electron/main.js');
`,
);
const app = await electron.launch({
  args: [
    await offlineElectronEntry(fixture, dev ? { loopbackPort: 5174 } : {}),
    ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
  ],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: profile,
    VITE_DEV_SERVER_URL: dev ? 'http://127.0.0.1:5174' : '',
  },
});
try {
  let page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  const assertWindowSize = async (expected) => {
    const actual = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getSize(),
    );
    // Windows DPI conversion may round a requested logical dimension and frameless window borders by a few pixels.
    const workArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize);
    expected.forEach((value, index) => {
      const bounded = Math.min(value, index === 0 ? workArea.width : workArea.height);
      assert.ok(
        Math.abs(actual[index] - bounded) <= 5,
        `${actual} should match ${expected} within screen ${JSON.stringify(workArea)}`,
      );
    });
  };
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  assert.equal(await page.locator('.sidebar').count(), 0);
  const assertNoOuterMargin = async () => {
    const body = await page.locator('.app-body').boundingBox();
    const card = await page.locator('.login-card').boundingBox();
    for (const key of ['x', 'y', 'width', 'height'])
      assert.ok(Math.abs(body[key] - card[key]) < 1, `Login card fills body: ${key}`);
  };
  await assertNoOuterMargin();
  await assertWindowSize([1000, 660]);
  assert.equal(await page.locator('.titlebar').count(), 0);
  assert.equal(await page.locator('.login-brand').innerText(), 'VoxCue');
  const loginId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  assert.equal(
    await page
      .locator('.login-card')
      .evaluate((element) => getComputedStyle(element).backdropFilter),
    'none',
  );
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => window.desktop.authSession()), null);
  await page.screenshot({});
  page = await enterPrimaryUiAccount(app, page);
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'AI 服务', exact: true }).click();
  const ai = page.locator('.ai-service-row').filter({ hasText: 'ChatGPT' });
  // Intercept only the operating-system browser launch in this isolated process.
  // No production OAuth endpoint, real account or credentials are used by this UI test.
  await app.evaluate(({ shell }) => {
    globalThis.__loginURL = '';
    shell.openExternal = async (url) => {
      globalThis.__loginURL = url;
    };
  });
  await ai.getByRole('button', { name: '连接', exact: true }).click();
  await page.getByRole('button', { name: '取消授权', exact: true }).waitFor();
  let address;
  for (let attempt = 0; attempt < 100; attempt++) {
    address = await app.evaluate(() => globalThis.__loginURL);
    if (address) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(address);
  const authorization = new URL(address);
  assert.equal(authorization.origin, 'https://auth.openai.com');
  assert.equal(authorization.searchParams.get('client_id'), 'synthetic-managed-client');
  const callback = new URL(authorization.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname, '127.0.0.1');
  await page.getByRole('button', { name: '取消授权', exact: true }).click();
  await ai.getByRole('button', { name: '连接', exact: true }).waitFor();
  await page.getByRole('alert').getByText('登录已取消', { exact: false }).waitFor();
  await app.evaluate(() => {
    globalThis.__loginURL = '';
  });
  await ai.getByRole('button', { name: '连接', exact: true }).click();
  for (let attempt = 0; attempt < 100; attempt++) {
    address = await app.evaluate(() => globalThis.__loginURL);
    if (address) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const deniedAuth = new URL(address);
  const denied = new URL(deniedAuth.searchParams.get('redirect_uri'));
  denied.search = new URLSearchParams({
    state: deniedAuth.searchParams.get('state'),
    error: 'access_denied',
  }).toString();
  assert.equal(denied.hostname, '127.0.0.1');
  await app.evaluate(() => globalThis.__declineManagedLogin());
  await page.getByRole('alert').getByText('未完成 ChatGPT 授权', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.desktop.authSession()), null);
  // DPAPI on Windows, Chromium's synthetic Keychain on Mac. Never access a real
  // Safe Storage password merely because userData is an isolated directory.
  const nativeStorage = await app.evaluate(async ({ app, safeStorage }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(process.cwd() + '/package.json');
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const { createAuthStorage } = require(
      path.join(process.cwd(), 'dist-electron/shared/electron/backend/auth/storage.js'),
    );
    const storage = createAuthStorage();
    const hostId = await storage.hostId();
    const record = {
      version: 1,
      hostId,
      clientId: 'oaiapp_storage_test',
      subject: 'test-only',
      name: 'Storage test',
      email: '',
      expiresAt: 0,
      idToken: 'TEST_TOKEN_DO_NOT_USE',
    };
    await storage.write(record);
    const raw = await fs.readFile(path.join(app.getPath('userData'), 'auth-data/credentials.bin'));
    const decoded = await storage.read();
    await fs.unlink(path.join(app.getPath('userData'), 'auth-data/credentials.bin'));
    return {
      available: safeStorage.isEncryptionAvailable(),
      opaque: !raw.includes(Buffer.from(record.idToken)),
      roundTrip: decoded.subject === record.subject,
      sameHost: (await storage.hostId()) === hostId,
    };
  });
  assert.deepEqual(nativeStorage, {
    available: true,
    opaque: true,
    roundTrip: true,
    sameHost: true,
  });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await installUiAccount(app);
  await page.evaluate(() => window.desktop.signInWithChatGPT());
  await page.reload();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '今天想准备哪一部分面试？' }).waitFor();
  assert.notEqual(
    await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().endsWith('#login'))
          .id,
    ),
    loginId,
  );
  await assertWindowSize([1280, 800]);
  await page.getByRole('button', { name: '聊天模型', exact: true }).click();
  await page.screenshot({});
  await page.getByRole('menuitemradio', { name: /Test Model/ }).click();
  await page.getByRole('button', { name: '聊天模型', exact: true }).click();
  assert.equal(
    await page.getByRole('menuitemradio', { name: /Test Model/ }).getAttribute('aria-checked'),
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '个性化', exact: true })
    .click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '聊天模型', exact: true }).click();
  await page.screenshot({});
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '用户菜单' }).click();
  const oldMain = page;
  [page] = await Promise.all([
    app.waitForEvent('window'),
    (async () => {
      await oldMain.getByRole('menuitem', { name: '退出登录', exact: true }).click();
      await oldMain.getByRole('button', { name: '退出登录', exact: true }).click();
    })(),
  ]);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await assertNoOuterMargin();
  await assertWindowSize([1000, 660]);
  assert.equal(await page.locator('.titlebar').count(), 0);
  await page.screenshot({});
  assert.equal(await page.locator('.sidebar').count(), 0);
  assert.equal(
    (await page.evaluate(() => window.desktop.cloudAccount({ action: 'status' }))).state.user,
    null,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: login gate, browser OAuth initiation, cancel/decline, native encrypted storage, internal fixture session, logout and custom model menu.',
  );
} finally {
  await closeUiApp(app);
  await server?.close();
}
