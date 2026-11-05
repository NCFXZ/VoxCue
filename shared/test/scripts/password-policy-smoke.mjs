import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';
import {
  Store,
  Auth,
  loadConfig,
  createApi,
  Outbox,
  Services,
  routes,
} from './server-reference.mjs';

const directory = path.join(testRoot, 'password-policy');
await mkdir(directory);
let now = Date.now();
const config = loadConfig({
  AUTH_KEY: 'cd'.repeat(32),
  DATABASE_FILE: path.join(directory, 'accounts.sqlite'),
  FEATURE_BACKUPS: '1',
});
const store = new Store(config.database);
const auth = new Auth(store, config, true, () => now);
const messages = [];
const outbox = new Outbox(auth, {
  enabled: true,
  async send(message) {
    messages.push(message);
  },
});
const services = new Services(auth);
await services.start();
const api = createApi(auth, () => {}, routes(services));
api.server.listen(0, '127.0.0.1');
await once(api.server, 'listening');
const port = api.server.address().port;
const email = 'password-policy@example.test';
const fixture = path.join(testRoot, 'password-policy.cjs');
await writeFile(
  fixture,
  `
const {app,safeStorage}=require('electron'),path=require('node:path');
const root=${JSON.stringify(workspace.platformRoot)};app.setAppPath(root);
app.commandLine.appendSwitch('use-mock-keychain');
if(process.platform==='darwin'){
 const credentials=require(path.join(root,'dist-electron/macos/electron/credentials.js'));
 credentials.createCredentialEncryption=()=>({encrypt:value=>safeStorage.encryptString(value),decrypt:value=>safeStorage.decryptString(value)});
 const childProcess=require('node:child_process'),spawn=childProcess.spawn;
 childProcess.spawn=function(executable,...args){if(String(executable).endsWith('/VoxCue.Credentials'))throw Error('Password UI fixture forbids production credential helper');return spawn.call(this,executable,...args);};
}
const base=path.join(root,'dist-electron/shared/electron');
for(const [module,name] of [['backend/auth/service.js','ChatGPTAuthService'],['backend/copilot/auth.js','CopilotAuthService']]) require(path.join(base,module))[name].prototype.session=async()=>null;
require(path.join(base,'main.js'));
`,
);
let app;
const errors = [];
try {
  const capabilities = await (await fetch(`http://127.0.0.1:${port}/v1/capabilities`)).json();
  assert.equal(capabilities.limits.passwordMinLength, 8);
  assert.equal(capabilities.limits.passwordMaxLength, 128);
  let previous;
  for (const [index, value] of [
    'K7!vQ#pR',
    'N9@pT$yK',
    'R6!uC#sV' + 'x'.repeat(6),
    '😀'.repeat(128),
  ].entries()) {
    const register = index === 0;
    now += 61000;
    app = await electron.launch({
      args: [await offlineElectronEntry(fixture, { loopbackPort: port })],
      env: {
        ...process.env,
        COPILOT_TEST_USER_DATA: path.join(directory, 'profile-' + index),
        VITE_DEV_SERVER_URL: '',
        VOXCUE_ACCOUNT_API: `http://127.0.0.1:${port}`,
        VOXCUE_ACCOUNT_ALLOW_LOCAL: '1',
        ELECTRON_RUN_AS_NODE: undefined,
      },
    });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
    await page.getByRole('button', { name: register ? '注册' : '找回密码', exact: true }).click();
    const input = page.getByLabel(register ? '密码' : '新密码', { exact: true });
    assert.equal(await input.getAttribute('placeholder'), '输入密码');
    await page.getByText('不少于8个字符', { exact: true }).waitFor();
    assert.equal(await input.getAttribute('minlength'), '8');
    assert.equal(await input.getAttribute('maxlength'), '1024');
    for (const dark of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value),
        dark,
      );
      await captureRequested(
        page,
        `${register ? 'register' : 'reset'}-${index}-${dark ? 'dark' : 'light'}`,
      );
    }
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByRole('button', { name: '获取验证码', exact: true }).click();
    await page.getByRole('button', { name: /秒后重发/ }).waitFor();
    await outbox.runOnce();
    await page.getByLabel('邮箱验证码', { exact: true }).fill(messages.at(-1).code);
    const beforeHash = store.user(email)?.password_hash;
    const submit = page.getByRole('button', {
      name: register ? '创建账号' : '重置密码',
      exact: true,
    });
    for (const invalid of ['K7!vQ#p', 'e\u0301'.repeat(7), '😀'.repeat(129)]) {
      await input.fill(invalid);
      await submit.click();
      if (Array.from(invalid.normalize('NFC')).length > 128)
        await page.getByRole('alert').filter({ hasText: '密码不正确' }).waitFor();
      else {
        assert.equal(await input.evaluate((node) => node === document.activeElement), true);
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.getByText('不少于8个字符', { exact: true }).waitFor();
      }
      assert.equal(store.user(email)?.password_hash, beforeHash);
    }
    await input.fill(value);
    if (register) {
      const opened = app.waitForEvent('window');
      await submit.click();
      const main = await opened;
      await main.getByRole('navigation', { name: '主导航' }).waitFor();
      const account = await main.evaluate(() => window.desktop.cloudAccount({ action: 'status' }));
      assert.equal(account.state.verified, true);
      assert.equal(account.state.user.email, email);
      await main.getByRole('button', { name: '用户菜单', exact: true }).click();
      await main.getByRole('menuitem', { name: '设置', exact: true }).click();
      const settings = main.getByRole('dialog', { name: '设置', exact: true });
      await settings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
      for (const capacityMb of [250, 1, null]) {
        services.storage.set(
          account.state.user.id,
          capacityMb === null ? { kind: 'default' } : { kind: 'custom', capacityMb },
        );
        const expected = (capacityMb ?? 100) * 1_000_000;
        await settings.getByRole('button', { name: '刷新容量', exact: true }).click();
        await settings
          .getByRole('img', { name: `已用 0 字节，总容量 ${expected} 字节`, exact: true })
          .waitFor();
        await settings
          .getByText(`可用 ${(expected / 1_000_000).toFixed(2)} MB · 已用 0.00 MB`, { exact: true })
          .waitFor();
        const result = await main.evaluate(
          (userId) => window.desktop.cloudSync({ action: 'list', userId }),
          account.state.user.id,
        );
        assert.equal(result.ok, true);
        assert.equal(result.value.storage.capacityBytes, expected);
        assert.equal(
          await settings
            .locator('.cloud-storage-bar [title], .cloud-storage-legend [title]')
            .count(),
          0,
        );
      }
      await captureRequested(main, 'quota-restored');
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    } else {
      await submit.click();
      await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
      await page.getByRole('status').filter({ hasText: '密码已重置' }).waitFor();
    }
    const hash = store.user(email).password_hash;
    assert.equal(await auth.passwords.verify(value.normalize('NFC'), hash), true);
    if (previous) assert.equal(await auth.passwords.verify(previous, hash), false);
    assert.ok(!hash.includes(value));
    previous = value;
    console.log(
      `PASS password UI ${register ? 'registration' : 'reset'}: ${Array.from(value).length} codepoints, real isolated API/hash, 7/129 rejected, unchanged challenge remains usable`,
    );
    await closeUiApp(app);
    app = undefined;
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      passwordRange: [8, 128],
      passwordHint: '不少于8个字符',
      physicalCapture: false,
      realAccounts: false,
      realMail: false,
    }),
  );
} finally {
  if (app) await closeUiApp(app);
  await api.close();
  await outbox.stop();
  await services.close();
  auth.passwords.pool.close();
  store.close();
}
