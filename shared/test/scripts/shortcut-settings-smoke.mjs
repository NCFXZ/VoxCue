import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, closeUiApp } from './install-ui-account.mjs';

// An isolated account and deterministic registration port; no system key
// ownership changes, real credentials, hardware, network or saved screenshots.
const fixture = path.join(testRoot, 'shortcut-settings-entry.cjs');
await writeFile(
  fixture,
  `
const {globalShortcut}=require('electron');
const owned=new Map();
globalShortcut.register=(key,callback)=>{
  if(key==='Control+Shift+Q'||owned.has(key))return false;
  owned.set(key,callback);return true;
};
globalShortcut.unregister=key=>owned.delete(key);
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const app = await electron.launch({
  args: [await offlineElectronEntry(fixture)],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'shortcut-settings'),
    VITE_DEV_SERVER_URL: '',
  },
});
try {
  await installUiAccount(app);
  const main = await connectUiAccount(app, await app.firstWindow());
  main.setDefaultTimeout(10000);
  const errors = [];
  main.on('pageerror', (error) => errors.push(error.message));
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '快捷键', exact: true }).click();
  const binding = settings.getByRole('button', {
    name: '修改快捷键：打开或关闭麦克风',
    exact: true,
  });
  const row = settings.locator('.shortcut-setting-row').filter({ hasText: '打开或关闭麦克风' });
  const saved = () =>
    main.evaluate(
      async () =>
        (await window.desktop.shortcutSettings({ op: 'status' })).state.bindings[
          'toggle-microphone'
        ],
    );
  await binding.click();
  await main.waitForFunction(() =>
    document.querySelector('.shortcut-binding[aria-pressed="true"]'),
  );
  await main.keyboard.down('Control');
  await main.keyboard.down('Shift');
  assert.equal(await binding.innerText(), 'Ctrl+Shift');
  await main.keyboard.up('Shift');
  assert.equal(await binding.innerText(), 'Ctrl');
  await main.keyboard.down('Shift');
  assert.equal(await binding.innerText(), 'Ctrl+Shift');
  await main.keyboard.down('q');
  assert.equal(await binding.innerText(), 'Ctrl+Shift+Q');
  await main.keyboard.up('Control');
  assert.equal(await binding.innerText(), 'Shift+Q');
  assert.equal(await saved(), 'Control+Shift+M');
  await main.keyboard.down('Control');
  assert.equal(await binding.innerText(), 'Ctrl+Shift+Q');
  await main.keyboard.up('q');
  await main.keyboard.up('Shift');
  await main.keyboard.up('Control');
  await row.getByRole('alert').filter({ hasText: '快捷键冲突或不可用' }).waitFor();
  assert.equal(await saved(), 'Control+Shift+M');
  assert.equal(await binding.getAttribute('aria-pressed'), 'true');
  assert.equal(await binding.innerText(), '请按快捷键…');
  // A competing system registration can consume keydown while keyup still arrives.
  await main.keyboard.down('Control');
  await main.keyboard.down('Shift');
  await main.evaluate(() =>
    dispatchEvent(
      new KeyboardEvent('keyup', {
        key: 'q',
        code: 'KeyQ',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    ),
  );
  await main.keyboard.up('Shift');
  await main.keyboard.up('Control');
  await row.getByRole('alert').filter({ hasText: '快捷键冲突或不可用' }).waitFor();
  assert.equal(await binding.innerText(), '请按快捷键…');
  assert.equal(await saved(), 'Control+Shift+M');
  await main.keyboard.press('Control+Shift+P');
  await row.getByRole('alert').filter({ hasText: '快捷键重复' }).waitFor();
  assert.equal(await row.getByRole('alert').count(), 1);
  assert.equal(
    await row.getByRole('alert').evaluate((node) => getComputedStyle(node).whiteSpace),
    'nowrap',
  );
  assert.equal(await row.getByText('快捷键冲突或不可用', { exact: true }).count(), 0);
  assert.equal(await saved(), 'Control+Shift+M');
  await main.keyboard.press('x');
  await row
    .getByRole('alert')
    .filter({ hasText: '快捷键需包含 Ctrl、Shift 或 Alt 中的至少一个' })
    .waitFor();
  assert.equal(await row.getByRole('alert').count(), 1);
  assert.equal(await binding.getAttribute('aria-pressed'), 'true');
  await main.keyboard.down('Control');
  await main.keyboard.down('Shift');
  await main.keyboard.down('k');
  await main.keyboard.up('Control');
  assert.equal(await binding.innerText(), 'Shift+K');
  assert.equal(await saved(), 'Control+Shift+M');
  await main.keyboard.up('k');
  await main.keyboard.up('Shift');
  await main.waitForFunction(
    () => !document.querySelector('.shortcut-binding[aria-pressed="true"]'),
  );
  assert.equal(await saved(), 'Shift+K');
  assert.equal(await binding.innerText(), 'Shift+K');
  assert.equal(await row.getByRole('alert').count(), 0);
  await settings.getByRole('button', { name: '恢复默认设置', exact: true }).click();
  await main.waitForFunction(
    async () =>
      (await window.desktop.shortcutSettings({ op: 'status' })).state.bindings[
        'toggle-microphone'
      ] === 'Control+Shift+M',
  );
  await binding.click();
  await main.waitForFunction(() =>
    document.querySelector('.shortcut-binding[aria-pressed="true"]'),
  );
  await main.keyboard.press('Escape');
  assert.equal(await binding.getAttribute('aria-pressed'), 'false');
  assert.equal(await settings.isVisible(), true);
  assert.equal(await saved(), 'Control+Shift+M');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: live shortcut preview, unavailable/duplicate/invalid rejection, one replacing error, continued recording, Shift-only binding, reset and cancel. Isolated GUI; no real system hotkeys or account.',
  );
} finally {
  await closeUiApp(app);
}
