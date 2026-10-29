import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp, focusUiWindow } from './install-ui-account.mjs';

const desktop =
  process.platform === 'darwin'
    ? await import(
        pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/desktop-session.mjs')).href
      )
    : undefined;
const releaseDesktop = desktop?.holdDesktopAwake();
const guard =
  desktop &&
  setInterval(() => {
    try {
      desktop.requireUnlockedDesktop();
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }, 2000);
const profile = path.join(testRoot, 'local-mode-profile');
await mkdir(profile);
const fixture = path.join(testRoot, 'local-mode-entry.cjs');
await writeFile(
  fixture,
  `
const path = require('node:path');
const root = ${JSON.stringify(workspace.platformRoot)};
const {CloudAccountClient} = require(path.join(root, 'dist-electron/shared/electron/backend/cloud/client.js'));
const original = CloudAccountClient.prototype.call;
globalThis.localCloudCalls = [];
CloudAccountClient.prototype.call = function(call) { globalThis.localCloudCalls.push(call.action); return original.call(this, call); };
require(path.join(root, 'dist-electron/shared/electron/main.js'));
`,
);
const entry = await offlineElectronEntry(fixture);
const launch = () =>
  electron.launch({
    args: [entry],
    env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
  });
let app;
const errors = [];
const settle = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.effect?.getTiming().iterations === Infinity || a.playState !== 'running'),
  );
const settingsFor = async (page) => {
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  return page.getByRole('dialog', { name: '设置', exact: true });
};
try {
  app = await launch();
  const login = await app.firstWindow();
  login.on('pageerror', (e) => errors.push(e.message));
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await focusUiWindow(app, login);
  const loginWindow = await app.browserWindow(login);
  for (const dark of [false, true]) {
    await login.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    for (const size of [
      { width: 1280, height: 800 },
      { width: 880, height: 600 },
    ]) {
      await loginWindow.evaluate((win, size) => win.setSize(size.width, size.height), size);
      await settle(login);
      const geometry = await login.locator('.cloud-account-form').evaluate((form) => {
        const submit = form.querySelector('button[type="submit"]');
        const skip = form.querySelector('.login-skip-button');
        const a = submit.getBoundingClientRect(),
          b = skip.getBoundingClientRect();
        return {
          width: a.width - b.width,
          height: a.height - b.height,
          radius: getComputedStyle(submit).borderRadius === getComputedStyle(skip).borderRadius,
          below: b.top >= a.bottom,
          visible: b.bottom <= innerHeight,
        };
      });
      assert.deepEqual(geometry, { width: 0, height: 0, radius: true, below: true, visible: true });
    }
  }
  // Skipping does not submit or validate the email/password form.
  await login.getByLabel('邮箱', { exact: true }).fill('invalid');
  const opened = app.waitForEvent('window');
  await login.getByRole('button', { name: '跳过登录', exact: true }).click();
  let main = await opened;
  main.on('pageerror', (e) => errors.push(e.message));
  await main.getByRole('textbox', { name: '聊天消息' }).waitFor();
  assert.equal(await main.locator('.user-info strong').innerText(), '本地账户');
  assert.equal(await main.evaluate(() => window.desktop.authSession()), null);
  const local = await main.evaluate(() => window.desktop.cloudAccount({ action: 'status' }));
  assert.equal(local.state.user, null);
  assert.equal(local.state.localMode, true);
  assert.equal(local.state.verified, false);
  assert.deepEqual(await app.evaluate(() => globalThis.localCloudCalls), ['status', 'status']);
  await assert.rejects(
    () => main.evaluate(() => window.desktop.setLocalMode(true)),
    /Unauthorized/,
  );
  const denied = await main.evaluate(() =>
    window.desktop.cloudSync({ action: 'list', userId: 'a0000000-0000-4000-8000-000000000001' }),
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 401);
  const deletion = await main.evaluate(() =>
    window.desktop.cloudAccount({ action: 'delete', password: 'synthetic', confirm: 'DELETE' }),
  );
  assert.equal(deletion.ok, false);
  let settings = await settingsFor(main);
  await settings
    .getByText('尚未登录 VoxCue，资料保存在当前电脑。登录后可启用云备份。', { exact: true })
    .waitFor();
  assert.equal(await settings.getByRole('switch').count(), 0);
  assert.equal(await settings.getByRole('button', { name: '删除账号', exact: true }).count(), 0);
  assert.equal(await settings.getByRole('button', { name: '导出资料', exact: true }).count(), 1);
  await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
  assert.equal(await settings.getByRole('button', { name: '连接', exact: true }).count(), 2);
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.getByRole('textbox', { name: '聊天消息' }).fill('合成草稿，重启后保留');
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '返回登录', exact: true }).click();
  const returning = app.waitForEvent('window');
  await main
    .getByRole('dialog', { name: '返回登录', exact: true })
    .getByRole('button', { name: '返回登录', exact: true })
    .click();
  const returnedLogin = await returning;
  await returnedLogin.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(path.join(profile, 'local-mode.json'), 'utf8')), false);
  const reentered = app.waitForEvent('window');
  await returnedLogin.getByRole('button', { name: '跳过登录', exact: true }).click();
  main = await reentered;
  await main.getByRole('textbox', { name: '聊天消息' }).waitFor();
  assert.equal(
    await main.getByRole('textbox', { name: '聊天消息' }).inputValue(),
    '合成草稿，重启后保留',
  );
  await closeUiApp(app);
  app = undefined;
  assert.equal(JSON.parse(await readFile(path.join(profile, 'local-mode.json'), 'utf8')), true);

  // A fresh process restores local access without any account API calls.
  app = await launch();
  main = await app.firstWindow();
  main.on('pageerror', (e) => errors.push(e.message));
  await main.getByRole('textbox', { name: '聊天消息' }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.localCloudCalls), []);
  assert.equal(
    await main.getByRole('textbox', { name: '聊天消息' }).inputValue(),
    '合成草稿，重启后保留',
  );
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { KnowledgeHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js',
    );
    KnowledgeHost.prototype.listDocuments = async () => [];
    KnowledgeHost.prototype.indexDocument = async ({ documentId }) => ({ documentId });
    const { CloudSyncClient } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/cloud/sync.js',
    );
    const totals = { profile: 30000, history: 820000, knowledgebase: 9330000 };
    CloudSyncClient.prototype.call = async () => ({
      ok: true,
      value: {
        items: [],
        nextCursor: null,
        storage: {
          currentBytes: totals,
          reservedBytes: { profile: 0, history: 0, knowledgebase: 0 },
          storedBytes: totals,
          capacityBytes: 200000000,
          knowledgeCapacityBytes: 200000000,
        },
      },
    });
  });
  await main.reload();
  settings = await settingsFor(main);
  const exportPanel = settings.getByRole('region', { name: '导出资料', exact: true });
  const destination = path.join(testRoot, '本机资料.zip');
  await app.evaluate(({ dialog }, destination) => {
    let count = 0;
    dialog.showSaveDialog = async (_win, options) => {
      if (options.title !== '导出资料') throw Error('Unexpected save dialog');
      return ++count === 1 ? { canceled: true } : { canceled: false, filePath: destination };
    };
  }, destination);
  await exportPanel.getByRole('button', { name: '导出资料', exact: true }).click();
  await main.waitForFunction(
    () => !document.querySelector('.account-export-panel button')?.disabled,
  );
  assert.equal(await exportPanel.getByRole('status').count(), 0);
  assert.equal(await stat(destination).catch(() => null), null);
  await exportPanel.getByRole('button', { name: '导出资料', exact: true }).click();
  await exportPanel.getByText('资料已导出。', { exact: true }).waitFor();
  const AdmZip = workspace.platformRequire('adm-zip');
  const archive = new AdmZip(destination);
  assert.deepEqual(
    [...new Set(archive.getEntries().map((e) => e.entryName.split('/')[0]))].sort(),
    ['个人信息', '面试记录', '知识库'].sort(),
  );
  assert.ok(archive.getEntry('个人信息/个人信息.txt'));
  assert.deepEqual(await app.evaluate(() => globalThis.localCloudCalls), []);

  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await exportPanel.getByRole('button', { name: '导出资料', exact: true }).click();
  await main.waitForFunction(
    () => !document.querySelector('.account-export-panel button')?.disabled,
  );
  assert.equal(
    await exportPanel.getByRole('status').count(),
    0,
    'Cancel clears an earlier success without showing a cancellation notice',
  );

  // A known unrestored cloud object must not silently disappear from a local export.
  await main.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('voxcue-cloud-sync', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('accounts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      tx.objectStore('accounts').put(
        {
          preferences: {
            enabled: { profile: false, history: false, knowledgebase: false },
            knowledgeLimitBytes: 100000000,
          },
          baselines: {
            'file:missing': {
              id: 'b0000000-0000-4000-8000-000000000001',
              revision: 1,
              hash: 'a'.repeat(64),
              unrestored: true,
            },
          },
        },
        'synthetic-unrestored-owner',
      );
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem('voxcue-sync-owner', 'synthetic-unrestored-owner');
  });
  await exportPanel.getByRole('button', { name: '导出资料', exact: true }).click();
  await exportPanel
    .getByRole('alert')
    .filter({ hasText: '有尚未恢复到本机的云端资料，请登录原账号并完成下载后再导出。' })
    .waitFor();
  await main.evaluate(() => localStorage.removeItem('voxcue-sync-owner'));
  assert.deepEqual(await app.evaluate(() => globalThis.localCloudCalls), []);

  // Local mode can connect an AI provider, without a VoxCue account or demo mode.
  await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
  await settings
    .locator('.ai-service-row')
    .first()
    .getByRole('button', { name: '连接', exact: true })
    .click();
  assert.equal((await main.evaluate(() => window.desktop.authSession())).mode, 'chatgpt');
  assert.equal(
    (await main.evaluate(() => window.desktop.cloudAccount({ action: 'status' }))).state.user,
    null,
  );
  await settings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
  assert.equal(await settings.locator('.cloud-account-form, .cloud-account-modes').count(), 0);
  const loginOpened = app.waitForEvent('window');
  await settings
    .locator('.cloud-account-panel')
    .getByRole('button', { name: '登录', exact: true })
    .click();
  const originalLogin = await loginOpened;
  await originalLogin.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  assert.ok(originalLogin.url().endsWith('#login'));
  assert.equal(await originalLogin.locator('.login-preview').count(), 1);
  await originalLogin.getByLabel('邮箱', { exact: true }).fill('synthetic@example.test');
  await originalLogin.getByLabel('密码', { exact: true }).fill('Synthetic passphrase8!');
  const accountOpened = app.waitForEvent('window');
  await originalLogin.getByRole('button', { name: '登录', exact: true }).click();
  main = await accountOpened;
  main.on('pageerror', (e) => errors.push(e.message));
  await main.getByRole('textbox', { name: '聊天消息' }).waitFor();
  settings = await settingsFor(main);
  await settings.getByText('synthetic@example.test', { exact: true }).waitFor();
  await settings.getByRole('switch', { name: '同步个人信息', exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(path.join(profile, 'local-mode.json'), 'utf8')), false);
  await main
    .locator('.cloud-storage-details > span')
    .getByText('可用 189.82 MB · 已用 10.18 MB', { exact: true })
    .waitFor();
  const win = await app.browserWindow(main);
  for (const width of [1280, 880]) {
    await win.evaluate((win, width) => win.setSize(width, 800), width);
    await settle(main);
    const order = await settings.evaluate((e) => {
      const sync = e.querySelector('.cloud-sync-actions').getBoundingClientRect();
      const exported = e.querySelector('[aria-label="导出资料"]').getBoundingClientRect();
      const remove = e.querySelector('.account-deletion-panel').getBoundingClientRect();
      const details = e.querySelector('.cloud-storage-details').getBoundingClientRect();
      const total = e.querySelector('.cloud-storage-details > span').getBoundingClientRect();
      return {
        exportOrder: exported.top >= sync.bottom && remove.top >= exported.bottom,
        right: Math.abs(details.right - total.right),
      };
    });
    assert.equal(order.exportOrder, true);
    assert.ok(order.right < 1, JSON.stringify(order));
  }
  await settings.getByRole('button', { name: '删除账号', exact: true }).click();
  const modal = main.getByRole('dialog', { name: '删除 VoxCue 账号', exact: true });
  assert.equal(await modal.getByRole('button', { name: '导出资料', exact: true }).count(), 0);
  assert.equal(await modal.getByText(/后台仅保留邮箱|其他设备副本/).count(), 0);
  assert.equal(
    await modal.getByRole('button', { name: '永久删除账号', exact: true }).isDisabled(),
    true,
  );
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS local entry geometry, no fake cloud identity/demo, cloud guards, persisted offline entry/draft, local ZIP export/cancel, independent AI, original login from local account settings, sync/export/delete order and right-aligned capacity',
  );
} finally {
  if (app) await closeUiApp(app);
  if (guard) clearInterval(guard);
  releaseDesktop?.();
}
