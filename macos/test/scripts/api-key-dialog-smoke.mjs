import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { closeUiApp, enterPrimaryUiAccount, focusUiWindow, installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { requireUnlockedDesktop } from './desktop-session.mjs';

// Real React dialog, IPC and AppKit editor; only account, credential storage and
// provider HTTP are the existing explicit offline fixtures. An explicit input
// port opts into SecureInput only; ordinary GUI fixtures still disable all
// production native/credential ports. No Keychain is used.
requireUnlockedDesktop();
const probe = path.join(testRoot, 'secure-input-probe.node');
execFileSync('/usr/bin/xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-DNAPI_VERSION=8', '-bundle',
  '-undefined', 'dynamic_lookup', '-arch', 'arm64', '-mmacosx-version-min=14.2',
  '-I', path.join(workspace.platformRoot, '.cache/node-api-headers'),
  path.join(workspace.platformRoot, 'test/fixtures/secure-input-probe.mm'), '-framework', 'AppKit', '-o', probe]);
const entry = path.join(testRoot, 'api-key-dialog.cjs');
await writeFile(entry, `
const {app, BrowserWindow} = require('electron');
const root = ${JSON.stringify(workspace.platformRoot)};
app.setAppPath(root);
const ipc = require(root + '/dist-electron/shared/electron/ipc/apiConnections.js');
const register = ipc.registerApiConnectionIpc;
require(${JSON.stringify(fileURLToPath(new URL('../../../shared/test/fixtures/api-interactive-preview.cjs', import.meta.url)))}).install(root, app.getPath('userData'));
const input = require(root + '/dist-electron/macos/electron/apiKeyPrompt.js');
const {apiProviders} = require(root + '/dist-electron/shared/electron/contracts/apiConnections.js');
const owner = () => {
  const windows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed() &&
    new URL(win.webContents.getURL()).hash === '');
  if (windows.length !== 1) throw Error('Expected one owned synthetic main window');
  return windows[0];
};
// Main intentionally rejects native prompts in a test userData environment.
// Bind this explicit offline input fixture to the real AppKit implementation;
// keep production IPC checks and every credential-helper guard unchanged.
ipc.registerApiConnectionIpc = ports => register({...ports,
  prompt(provider, signal, field, tab) {
    return input.promptApiKey(owner(), apiProviders[provider].name, 'zh-CN', signal, field, tab);
  },
  control(command) { input.controlApiKey(owner(), command); },
});
globalThis.secureInputProbe = require(${JSON.stringify(probe)}).probe;
require(root + '/dist-electron/shared/electron/main.js');
`);
const app = await electron.launch({ args: [entry], env: { ...process.env, VOXCUE_ACCOUNT_API: '', VITE_DEV_SERVER_URL: '' } });
let nativeOutput = '';
app.process().stderr.on('data', chunk => { nativeOutput = (nativeOutput + chunk.toString()).slice(-8000); });
try {
  console.log('[api-key-dialog] account fixture');
  await installUiAccount(app);
  const page = await enterPrimaryUiAccount(app, await app.firstWindow());
  await focusUiWindow(app, page);
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: 'AI 服务', exact: true }).click();
  await settings.getByRole('radio', { name: 'API 密钥', exact: true }).click();
  const row = settings.getByRole('group', { name: 'OpenAI API', exact: true });
  const disclosure = row.locator('.api-service-disclosure');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  const label = 'OpenAI API 密钥';
  const state = () => app.evaluate((_, label) => JSON.parse(globalThis.secureInputProbe('geometry', label)), label);
  const nativeCommand = action => app.evaluate((_, { action, label }) => globalThis.secureInputProbe(action, label), { action, label });
  const window = await app.browserWindow(page);
  const assertGeometry = async (dialog, dark) => {
    const slot = await dialog.locator('[data-api-key-field]').boundingBox();
    const zoom = await window.evaluate(win => win.webContents.getZoomFactor());
    const field = await state();
    assert.notEqual(field.state, 'closed');
    assert.notEqual(field.state, 'hidden');
    assert.equal(field.dark, dark);
    assert.ok(Math.abs(field.x - Math.round(slot.x) * zoom) < 1 / 64, JSON.stringify({ slot, zoom, field }));
    assert.ok(Math.abs(field.width - Math.round(slot.width) * zoom) < 1 / 64, JSON.stringify({ slot, zoom, field }));
    assert.ok(Math.abs(field.y + field.height / 2 - (Math.round(slot.y) + Math.round(slot.height) / 2) * zoom) < 1, JSON.stringify({ slot, zoom, field }));
    assert.equal(field.font, 14 * zoom);
    assert.ok(field.backingScale > 0);
    return field;
  };
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    await row.getByRole('button', { name: '更换密钥', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '更换 API 密钥', exact: true });
    // Every observed visible native field must follow modal entry; samples stay
    // in memory and use only the owned window, without screen capture.
    await dialog.waitFor();
    const deadline = Date.now() + 5000;
    while (true) {
      const field = await state();
      const entering = await dialog.evaluate(node => node.getAnimations().some(animation =>
        animation instanceof CSSAnimation && animation.animationName === 'modal-fade-in' && animation.playState === 'running'));
      assert.ok(field.state === 'closed' || field.state === 'hidden' || !entering, 'Native editor must not appear during modal entry');
      if (field.state === 'masked' && !entering) break;
      if (Date.now() >= deadline) throw Error('Native editor did not appear after modal entry: ' + JSON.stringify({
        field, entering, error: await dialog.getByRole('alert').allTextContents(),
      }));
    }
    await assertGeometry(dialog, dark);
    await nativeCommand('type');
    await dialog.getByRole('button', { name: '显示密钥', exact: true }).click();
    assert.equal((await assertGeometry(dialog, dark)).state, 'visible');
    assert.equal((await state()).length, 'synthetic-api-key'.length);
    await dialog.getByRole('button', { name: '隐藏密钥', exact: true }).click();
    assert.equal((await assertGeometry(dialog, dark)).state, 'masked');
    for (const zoom of [0.8, 1.2, 1]) {
      await window.evaluate((win, zoom) => win.webContents.setZoomFactor(zoom), zoom);
      await page.waitForFunction(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertGeometry(dialog, dark);
    }
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), !dark);
    await page.waitForFunction(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertGeometry(dialog, !dark);
    assert.equal(await page.evaluate(() => document.documentElement.outerHTML.includes('synthetic-api-key')), false);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await state()).state, 'closed');
    // Cancelling during entry must never recreate an editor after its owner ends.
    await row.getByRole('button', { name: '更换密钥', exact: true }).click();
    await page.getByRole('dialog', { name: '更换 API 密钥', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await state()).state, 'closed');
  }
  await row.getByRole('button', { name: /^移除密钥/ }).click();
  await row.getByRole('button', { name: /^确认/ }).click();
  await row.getByRole('button', { name: '添加密钥', exact: true }).click();
  const add = page.getByRole('dialog', { name: '添加 API 密钥', exact: true });
  await add.getByRole('button', { name: '验证并保存', exact: true }).waitFor({ state: 'visible' });
  await add.getByRole('button', { name: '取消', exact: true }).click();
  await add.waitFor({ state: 'hidden' });
  assert.equal((await state()).state, 'closed');
  const ownerState = () => window.evaluate(win => ({
    window: win.id, contents: win.webContents.id, handle: win.getNativeWindowHandle().toString('hex'), destroyed: win.isDestroyed(),
    listeners: { closed: win.listenerCount('closed'), destroyed: win.webContents.listenerCount('destroyed'),
      gone: win.webContents.listenerCount('render-process-gone'), navigation: win.webContents.listenerCount('did-start-navigation') },
  }));
  const baseline = await ownerState();
  await row.getByRole('button', { name: '添加密钥', exact: true }).click();
  await add.waitFor();
  // Scope the AppKit query to the existing native owner, so losing key-window
  // focus during a renderer crash cannot masquerade as removal of its editor.
  await window.evaluate(async (win, label) => {
    const deadline = Date.now() + 5000;
    while (JSON.parse(globalThis.secureInputProbe('geometry', label, win.getNativeWindowHandle())).state !== 'masked') {
      if (Date.now() >= deadline) throw Error('Real AppKit editor did not open for renderer-crash cleanup');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }, label);
  const pending = await ownerState();
  assert.deepEqual(pending.listeners, Object.fromEntries(Object.entries(baseline.listeners).map(([event, count]) => [event, count + 1])),
    'The pending real prompt owns exactly its native-close and scoped IPC listeners');
  await Promise.all([page.waitForEvent('crash'), window.evaluate(win => win.webContents.forcefullyCrashRenderer())]);
  const retired = await window.evaluate(async (win, { label, baseline }) => {
    const deadline = Date.now() + 5000;
    while (true) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) throw Error('Renderer crash must retain its native owner');
      const listeners = { closed: win.listenerCount('closed'), destroyed: win.webContents.listenerCount('destroyed'),
        gone: win.webContents.listenerCount('render-process-gone'), navigation: win.webContents.listenerCount('did-start-navigation') };
      const field = JSON.parse(globalThis.secureInputProbe('geometry', label, win.getNativeWindowHandle()));
      if (field.state === 'closed' && Object.keys(listeners).every(event => listeners[event] === baseline.listeners[event]))
        return { window: win.id, contents: win.webContents.id, handle: win.getNativeWindowHandle().toString('hex'),
          destroyed: false, listeners, field: field.state };
      if (Date.now() >= deadline) throw Error('Real AppKit crash cleanup did not retire its field/listeners: ' + JSON.stringify({ listeners, field }));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }, { label, baseline });
  assert.deepEqual(retired, { ...baseline, field: 'closed' }, 'The same native owner survives while its actual field and prompt listeners are released');
  console.log('PASS real API key dialog entry, AppKit geometry/theme, reveal/mask, zoom, replacement/addition, cancellation and renderer-crash field/listener cleanup; renderer contains no key.');
} catch (error) {
  console.error('[api-key-dialog] owned native diagnostics:', nativeOutput);
  for (const page of app.windows()) {
    console.error('[api-key-dialog] owned UI:', await page.evaluate(() => ({
      role: location.hash,
      alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
      login: [...document.querySelectorAll('button')].filter(node => node.type === 'submit' && node.textContent === '登录').map(node => ({ text: node.textContent, disabled: node.disabled })),
    })).catch(() => 'unavailable'));
  }
  throw error;
} finally { await closeUiApp(app); }
