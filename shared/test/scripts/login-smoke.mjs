import { testRoot, electron } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';

import { mkdir } from 'node:fs/promises';
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
const app = await electron.launch({
  args: ['.', ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : [])],
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
  await page.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }).waitFor();
  assert.equal(await page.locator('.sidebar').count(), 0);
  const assertNoOuterMargin = async () => {
    const body = await page.locator('.app-body').boundingBox();
    const card = await page.locator('.login-card').boundingBox();
    for (const key of ['x', 'y', 'width', 'height'])
      assert.ok(Math.abs(body[key] - card[key]) < 1, `Login card fills body: ${key}`);
  };
  await assertNoOuterMargin();
  await assertWindowSize([960, 580]);
  assert.equal(await page.locator('.titlebar').count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: '使用 ChatGPT 继续', exact: true })
      .locator('img.service-brand-icon')
      .evaluate((icon) => icon.complete && icon.naturalWidth > 0),
    true,
  );
  const loginId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  assert.equal(
    await page
      .locator('.login-shell')
      .evaluate((element) => getComputedStyle(element).backdropFilter),
    'none',
  );
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => window.desktop.authSession()), null);
  await page.screenshot({});
  // Intercept only the operating-system browser launch in this isolated process.
  // No production OAuth endpoint, real account or credentials are used by this UI test.
  await app.evaluate(({ shell }) => {
    globalThis.__loginURL = '';
    shell.openExternal = async (url) => {
      globalThis.__loginURL = url;
    };
  });
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click();
  await page.getByRole('button', { name: '取消登录', exact: true }).waitFor();
  let address;
  for (let attempt = 0; attempt < 100; attempt++) {
    address = await app.evaluate(() => globalThis.__loginURL);
    if (address) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(address);
  const authorization = new URL(address);
  assert.equal(authorization.origin, 'https://auth.openai.com');
  assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client');
  const callback = new URL(authorization.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname, '127.0.0.1');
  await page.getByRole('button', { name: '取消登录', exact: true }).click();
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  await page.getByRole('alert').getByText('登录已取消', { exact: false }).waitFor();
  await app.evaluate(() => {
    globalThis.__loginURL = '';
  });
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click();
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
  await fetch(denied);
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
  const oldLogin = page;
  [page] = await Promise.all([
    app.waitForEvent('window'),
    oldLogin.evaluate(() => window.desktop.enterDemo()),
  ]);
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
  await page.getByRole('menuitemradio', { name: /GPT · 推理/ }).click();
  await page.getByRole('button', { name: '聊天模型', exact: true }).click();
  assert.equal(
    await page.getByRole('menuitemradio', { name: /GPT · 推理/ }).getAttribute('aria-checked'),
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
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
  await page.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }).waitFor();
  await assertNoOuterMargin();
  await assertWindowSize([960, 580]);
  assert.equal(await page.locator('.titlebar').count(), 0);
  await page.screenshot({});
  assert.equal(await page.locator('.sidebar').count(), 0);
  assert.equal(await page.evaluate(() => window.desktop.authSession()), null);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: login gate, browser OAuth initiation, cancel/decline, native encrypted storage, internal fixture session, logout and custom model menu.',
  );
} finally {
  await closeUiApp(app);
  await server?.close();
}
