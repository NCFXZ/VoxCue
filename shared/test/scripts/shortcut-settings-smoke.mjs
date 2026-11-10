import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';

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
const mac = process.platform === 'darwin';
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
  assert.deepEqual(
    (await settings.locator('.shortcut-setting-row strong').allTextContents()).slice(0, 3),
    ['显示或隐藏面试窗口', '展开或收起面试面板', '展开或收起转写面板'],
  );
  await captureRequested(main, 'shortcut-settings');
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
  assert.equal(await binding.innerText(), mac ? '⌃⇧' : 'Ctrl+Shift');
  await captureRequested(main, 'shortcut-preview');
  await main.keyboard.up('Shift');
  assert.equal(await binding.innerText(), mac ? '⌃' : 'Ctrl');
  await main.keyboard.down('Shift');
  assert.equal(await binding.innerText(), mac ? '⌃⇧' : 'Ctrl+Shift');
  await main.keyboard.down('q');
  assert.equal(await binding.innerText(), mac ? '⌃⇧Q' : 'Ctrl+Shift+Q');
  await main.keyboard.up('Control');
  assert.equal(await binding.innerText(), mac ? '⇧Q' : 'Shift+Q');
  assert.equal(await saved(), 'Control+Shift+M');
  await main.keyboard.down('Control');
  assert.equal(await binding.innerText(), mac ? '⌃⇧Q' : 'Ctrl+Shift+Q');
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
    .filter({
      hasText: mac
        ? '快捷键需包含 ⌃、⌥、⇧ 或 ⌘ 中的至少一个'
        : '快捷键需包含 Ctrl、Shift 或 Alt 中的至少一个',
    })
    .waitFor();
  assert.equal(await row.getByRole('alert').count(), 1);
  assert.equal(await binding.getAttribute('aria-pressed'), 'true');
  await main.keyboard.down('Control');
  await main.keyboard.down('Shift');
  await main.keyboard.down('k');
  await main.keyboard.up('Control');
  assert.equal(await binding.innerText(), mac ? '⇧K' : 'Shift+K');
  assert.equal(await saved(), 'Control+Shift+M');
  await main.keyboard.up('k');
  await main.keyboard.up('Shift');
  await main.waitForFunction(
    () => !document.querySelector('.shortcut-binding[aria-pressed="true"]'),
  );
  assert.equal(await saved(), 'Shift+K');
  assert.equal(await binding.innerText(), mac ? '⇧K' : 'Shift+K');
  assert.equal(await row.getByRole('alert').count(), 0);
  if (mac) {
    await binding.click();
    await main.waitForFunction(() =>
      document.querySelector('.shortcut-binding[aria-pressed="true"]'),
    );
    await main.keyboard.down('Meta');
    assert.equal(await binding.innerText(), '⌘');
    await main.keyboard.down('Shift');
    assert.equal(await binding.innerText(), '⇧⌘');
    await main.keyboard.down('h');
    assert.equal(await binding.innerText(), '⇧⌘H');
    await captureRequested(main, 'shortcut-command-preview');
    await main.keyboard.up('Shift');
    await main.keyboard.up('Meta');
    await main.keyboard.up('h');
    await main.waitForFunction(
      () => !document.querySelector('.shortcut-binding[aria-pressed="true"]'),
    );
    assert.equal(await saved(), 'Shift+Command+H');
    assert.equal(await binding.innerText(), '⇧⌘H');
    assert.equal(await row.getByRole('alert').count(), 0);
    await binding.click();
    await main.waitForFunction(() =>
      document.querySelector('.shortcut-binding[aria-pressed="true"]'),
    );
    await main.keyboard.press('Meta+k');
    await main.waitForFunction(
      () => !document.querySelector('.shortcut-binding[aria-pressed="true"]'),
    );
    assert.equal(await saved(), 'Command+K');
    assert.equal(await binding.innerText(), '⌘K');
    await binding.click();
    await main.waitForFunction(() =>
      document.querySelector('.shortcut-binding[aria-pressed="true"]'),
    );
    await main.evaluate(() => {
      dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Meta',
          code: 'MetaLeft',
          metaKey: true,
          bubbles: true,
        }),
      );
      dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true }));
    });
    assert.equal(
      await binding.innerText(),
      '⌘L',
      'A missing letter metaKey flag must not discard the held Command key',
    );
    await main.evaluate(() =>
      dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft', bubbles: true })),
    );
    await main.waitForFunction(
      () => !document.querySelector('.shortcut-binding[aria-pressed="true"]'),
    );
    assert.equal(await saved(), 'Command+L');
    const { nativeShortcut } = await import('../../../macos/test/scripts/shortcut-input.mjs');
    await app.evaluate(({ Menu }) => {
      globalThis.syntheticShortcutMenuHits = 0;
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'Synthetic',
            submenu: [
              {
                label: 'Owned Command K',
                accelerator: 'Command+K',
                click: () => globalThis.syntheticShortcutMenuHits++,
              },
            ],
          },
        ]),
      );
    });
    await nativeShortcut(app, 'command-k');
    await app.evaluate(async () => {
      const deadline = Date.now() + 3000;
      while (!globalThis.syntheticShortcutMenuHits && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      if (globalThis.syntheticShortcutMenuHits !== 1)
        throw Error('Native menu event did not arrive');
    });
    for (const [chord, accelerator, label] of [
      ['command-k', 'Command+K', '⌘K'],
      ['command-shift-h', 'Shift+Command+H', '⇧⌘H'],
    ]) {
      await binding.click();
      await main.waitForFunction(() =>
        document.querySelector('.shortcut-binding[aria-pressed="true"]'),
      );
      await nativeShortcut(app, chord);
      await main.waitForFunction(
        () => !document.querySelector('.shortcut-binding[aria-pressed="true"]'),
      );
      assert.equal(await saved(), accelerator);
      assert.equal(await binding.innerText(), label);
      assert.equal(await app.evaluate(() => globalThis.syntheticShortcutMenuHits), 1);
    }
    await nativeShortcut(app, 'command-k');
    await app.evaluate(async () => {
      const deadline = Date.now() + 3000;
      while (globalThis.syntheticShortcutMenuHits < 2 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      if (globalThis.syntheticShortcutMenuHits !== 2)
        throw Error('Native menu shortcut was not restored');
    });
  }
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
  if (mac) {
    await main.waitForFunction(
      async () => !(await window.desktop.shortcutSettings({ op: 'status' })).state.capturing,
    );
    const { nativeShortcut } = await import('../../../macos/test/scripts/shortcut-input.mjs');
    await nativeShortcut(app, 'command-k');
    await app.evaluate(async () => {
      const deadline = Date.now() + 3000;
      while (globalThis.syntheticShortcutMenuHits < 3 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      if (globalThis.syntheticShortcutMenuHits !== 3)
        throw Error('Cancel must restore native menu shortcuts');
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: live shortcut preview, unavailable/duplicate/invalid rejection, continued recording, Shift-only binding, Mac Command chords/missing flags/keyup and native menu restoration, reset and cancel. Isolated GUI; no real account or global key injection.',
  );
} catch (error) {
  console.error(
    'Shortcut settings state:',
    await app
      .windows()
      .at(-1)
      ?.evaluate(async () => ({
        state: await window.desktop.shortcutSettings({ op: 'status' }),
        rows: [...document.querySelectorAll('.shortcut-setting-row')].map((row) => row.innerText),
        focus: document.hasFocus(),
      }))
      .catch(() => null),
  );
  throw error;
} finally {
  await closeUiApp(app);
}
