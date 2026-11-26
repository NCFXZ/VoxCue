import path from 'node:path';
import { assertPlainProviderLogo } from './assert-provider-logo.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import workspace from '../../scripts/workspace.mjs';
import apiPreview from '../fixtures/api-interactive-preview.cjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { captureRequested } from './capture-requested.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import {
  enterPrimaryUiAccount,
  installUiAccount,
  closeUiApp,
  focusUiWindow,
  openModelMenu,
} from './install-ui-account.mjs';

const profile = path.join(testRoot, 'profile');
const checkOnly = process.argv.includes('--check-only');
const check = checkOnly || process.argv.includes('--check');
const rendererOwnerLifetimes = process.argv.includes('--renderer-owner-lifetimes');
const crashProbe = checkOnly || rendererOwnerLifetimes || process.argv.includes('--navigation-lifetime');
let recoveryBrowser;
let ownerStageName = 'startup';
function ownerStage(name, detail) {
  if (!rendererOwnerLifetimes) return;
  ownerStageName = name;
  console.log('[renderer-owner]', name, detail === undefined ? '' : JSON.stringify(detail));
}
const fixture = fileURLToPath(new URL('../fixtures/api-interactive-preview.cjs', import.meta.url));
const entry = path.join(testRoot, 'api-preview.cjs');
const compiled = path.join(workspace.platformRoot, 'dist-electron/shared/electron/main.js');
// This explicit offline mode observes real handlers and owner signals. The only
// waiting point is the selected model catalogue inside a real interview:open;
// renderer lifecycle cancellation itself is never replaced by a test callback.
function installRendererOwnerProbe(root) {
  const load = process.getBuiltinModule('module').createRequire(root + '/package.json');
  const { app, globalShortcut } = load('electron');
  if (app.isPackaged || !process.env.COPILOT_TEST_USER_DATA) throw Error('Owned development fixture required');
  const { AsyncLocalStorage } = load('node:async_hooks');
  const scope = new AsyncLocalStorage();
  const probe = globalThis.previewOwnerLifetimes = { entries: new Map(), captureActive: false };
  // Same deterministic registration port as shortcut-settings-smoke: no system
  // shortcut ownership is changed by recording/cancelling a capture session.
  const shortcuts = new Map();
  globalShortcut.register = (key, callback) => {
    if (shortcuts.has(key)) return false;
    shortcuts.set(key, callback);
    return true;
  };
  globalShortcut.unregister = key => shortcuts.delete(key);
  const handle = load(root + '/dist-electron/shared/electron/ipc/handle.js');
  const register = handle.handleDesktop;
  handle.handleDesktop = (channel, handler) => register(channel, (event, ...args) => {
    const entry = probe.armed;
    if (!entry || entry.channel !== channel) return handler(event, ...args);
    probe.armed = undefined;
    entry.started = true;
    return scope.run(entry, async () => {
      try {
        const value = await handler(event, ...args);
        entry.outcome = 'resolved';
        if (typeof value === 'boolean') entry.result = value;
        return value;
      } catch (error) {
        entry.outcome = 'rejected';
        // Only the owned synthetic opening is reported; never record prompt input,
        // request headers, credentials or a remote response body in diagnostics.
        if (entry.kind === 'opening') {
          entry.errorName = typeof error?.name === 'string' ? error.name.slice(0, 60) : 'Error';
          entry.errorMessage = typeof error?.message === 'string' ? error.message.slice(0, 240) : 'Unknown synthetic opening error';
        }
        throw error;
      } finally { entry.finished = true; }
    });
  });
  const { ProfileApiConnections } = load(root + '/dist-electron/shared/electron/application/apiConnections.js');
  const configure = ProfileApiConnections.prototype.configure;
  ProfileApiConnections.prototype.configure = function(config, prompt, check, signal) {
    const entry = scope.getStore();
    if (entry?.kind !== 'api') return configure.call(this, config, prompt, check, signal);
    entry.signal = signal;
    return configure.call(this, config, ownedSignal => {
      entry.promptEntered = true;
      return prompt(ownedSignal); // Existing synthetic native-field port, not a new lifecycle implementation.
    }, check, signal);
  };
  const { SelectedChatService } = load(root + '/dist-electron/shared/electron/application/providers.js');
  const models = SelectedChatService.prototype.models;
  SelectedChatService.prototype.models = async function(force, signal) {
    const entry = scope.getStore();
    if (entry?.kind === 'opening' && !entry.modelsHeld) {
      signal.throwIfAborted();
      entry.signal = signal;
      entry.modelsHeld = true;
      await new Promise((resolve, reject) => {
        const cancel = () => reject(signal.reason);
        entry.releaseModels = () => { signal.removeEventListener('abort', cancel); resolve(); };
        signal.addEventListener('abort', cancel, { once: true });
      });
      signal.throwIfAborted();
    }
    return models.call(this, force, signal);
  };
  const { InterviewShortcutController } = load(root + '/dist-electron/shared/electron/interviewShortcuts.js');
  const capture = InterviewShortcutController.prototype.capture;
  InterviewShortcutController.prototype.capture = function(active) {
    const value = capture.call(this, active);
    probe.captureActive = active;
    if (probe.captureEntry) {
      if (active) probe.captureEntry.started = true;
      else probe.captureEntry.finished = true;
    }
    return value;
  };
}
await writeFile(
  entry,
  [
    'require(' +
      JSON.stringify(fixture) +
      ').install(' +
      JSON.stringify(workspace.platformRoot) +
      ',' +
      JSON.stringify(profile) +
      ');',
    ...(rendererOwnerLifetimes ? ['(' + installRendererOwnerProbe.toString() + ')(' + JSON.stringify(workspace.platformRoot) + ');'] : []),
    'require(' + JSON.stringify(compiled) + ');',
  ].join('\n'),
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    /^(?:systemroot|windir|comspec|path|pathext|temp|tmp|tmpdir|userprofile|home|appdata|localappdata|lang|lc_all|display|wayland_display|xdg_runtime_dir|sessionname)$/i.test(
      name,
    ),
  ),
);
// A fresh CDP connection is needed after a real renderer crash: Playwright marks
// the old Page/session permanently crashed even when Electron reloads that same
// WebContents. Reserve an owned loopback endpoint for explicit probes and the full check.
let crashDebugPort;
if (crashProbe) {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  crashDebugPort = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
}
ownerStage('electron:launch');
const app = await electron.launch({
  args: [await offlineElectronEntry(entry), ...(crashProbe
    ? ['--remote-debugging-port=' + crashDebugPort, '--remote-debugging-address=127.0.0.1'] : [])],
  env: {
    ...env,
    COPILOT_TEST_USER_DATA: profile,
    VOXCUE_ACCOUNT_API: '',
    VITE_DEV_SERVER_URL: '',
  },
});
ownerStage('electron:launched');
async function runPreview() {
  ownerStage('account:install-fixtures');
  await installUiAccount(app, { speech: true, components: true });
  ownerStage('account:enter-main');
  const login = await app.firstWindow();
  let page = login.url().endsWith('#login') ? await enterPrimaryUiAccount(app, login) : login;
  ownerStage('account:main-ready');
  page.setDefaultTimeout(15000);
  await page.addStyleTag({ content: `
    .ai-services-panel > .settings-hint:first-child::after {
      display: block;
      margin-top: 4px;
      content: "离线模拟预览 · 余额和回复为示例";
    }
  ` });
  await focusUiWindow(app, page);
  let settings = page.getByRole('dialog', { name: '设置', exact: true });
  async function recoverCrashedRenderer(owner, previous) {
    const loaded = await owner.evaluate(win => {
      const contents = win.webContents;
      return new Promise((resolve, reject) => {
        let timer;
        const finish = error => {
          clearTimeout(timer);
          contents.removeListener('did-finish-load', ready);
          contents.removeListener('destroyed', destroyed);
          contents.removeListener('render-process-gone', gone);
          if (error) reject(error);
          else resolve({ window: win.id, contents: contents.id,
            renderer: contents.getOSProcessId(), url: contents.getURL(), crashed: contents.isCrashed() });
        };
        const ready = () => finish(contents.isCrashed() ? Error('Reload finished in a crashed renderer') : undefined);
        const destroyed = () => finish(Error('The owned WebContents was destroyed during recovery'));
        const gone = () => finish(Error('The renderer crashed again during recovery'));
        contents.once('did-finish-load', ready);
        contents.once('destroyed', destroyed);
        contents.once('render-process-gone', gone);
        timer = setTimeout(() => finish(Error('Owned WebContents reload did not finish')), 15000);
        try { contents.reload(); } catch (error) { finish(error); }
      });
    });
    assert.equal(loaded.window, previous.window, 'Crash recovery retains the same BrowserWindow');
    assert.equal(loaded.contents, previous.contents, 'Crash recovery retains the same WebContents');
    assert.notEqual(loaded.renderer, previous.renderer, 'Electron reload creates a new real renderer process');
    assert.ok(loaded.renderer > 0 && !loaded.crashed);
    assert.equal(loaded.url, previous.url);
    assert.equal(await app.evaluate(({ app }) => app.commandLine.getSwitchValue('remote-debugging-port')),
      String(crashDebugPort), 'CDP recovery uses only this owned Electron endpoint');
    // connectOverCDP attaches to the existing browser; closing this extra client
    // only disconnects its transport, not the Electron application or windows.
    await recoveryBrowser?.close();
    recoveryBrowser = await workspace.platformRequire('playwright').chromium.connectOverCDP(
      'http://127.0.0.1:' + crashDebugPort, { timeout: 15000, noDefaults: true });
    const matches = [];
    for (const candidate of recoveryBrowser.contexts().flatMap(context => context.pages())) {
      const window = await app.browserWindow(candidate);
      const identity = await window.evaluate(win => win && !win.isDestroyed()
        ? { window: win.id, contents: win.webContents.id } : null);
      if (identity?.window === loaded.window && identity.contents === loaded.contents) matches.push(candidate);
    }
    assert.equal(matches.length, 1, 'Fresh CDP Page maps to exactly the original owned WebContents');
    page = matches[0];
    page.setDefaultTimeout(15000);
    settings = page.getByRole('dialog', { name: '设置', exact: true });
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
    await focusUiWindow(app, page);
    return loaded;
  }
  async function openSettings() {
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await settings.getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: 'AI 服务', exact: true }).click();
  }
  async function enableDeepSeek() {
    await openSettings();
    await settings.getByRole('radio', { name: 'API 密钥', exact: true }).click();
    const row = settings.getByRole('group', { name: 'DeepSeek', exact: true });
    await row.waitFor();
    const enable = row.getByRole('button', { name: '启用', exact: true });
    if (await enable.isVisible()) await enable.click();
    await row.getByRole('button', { name: '禁用', exact: true }).waitFor();
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  }
  async function checkNavigationLifetime() {
    await app.evaluate(({ app, BrowserWindow }, url) => {
      const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { SelectedChatService } = load(app.getAppPath() + '/dist-electron/shared/electron/application/providers.js');
      const stream = SelectedChatService.prototype.stream;
      globalThis.previewNavigation = { entries: [], events: [] };
      SelectedChatService.prototype.stream = function(request, emit, signal) {
        if (request.instructions !== 'Synthetic main-document lifetime probe') return stream.call(this, request, emit, signal);
        const entry = { id: request.id, aborted: false };
        globalThis.previewNavigation.entries.push(entry);
        emit({ id: request.id, type: 'delta', text: 'Synthetic pending navigation reply' });
        return new Promise((resolve, reject) => {
          const cancel = () => { entry.aborted = true; reject(signal.reason); };
          signal.addEventListener('abort', cancel, { once: true });
          entry.finish = () => {
            signal.removeEventListener('abort', cancel);
            resolve({ answerText: 'Synthetic navigation reply completed', usage: null, sources: [] });
          };
        });
      };
      const owner = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url);
      if (!owner) throw Error('Synthetic navigation probe has no owning main window');
      owner.webContents.on('did-start-navigation', details => globalThis.previewNavigation.events.push({
        main: details.isMainFrame, same: details.isSameDocument,
      }));
    }, page.url());
    const originalUrl = page.url();
    const begin = async () => {
      const id = await page.evaluate(() => {
        const id = crypto.randomUUID();
        window.navigationPending = window.desktop.chatSend({ id, modelId: 'gemini-4-hydrogen',
          instructions: 'Synthetic main-document lifetime probe', webSearch: false,
          turns: [{ role: 'user', content: 'Synthetic navigation ownership check' }] });
        window.navigationPending.catch(() => {});
        return id;
      });
      await app.evaluate(async (_electron, id) => {
        const deadline = Date.now() + 5000;
        while (!globalThis.previewNavigation.entries.some(entry => entry.id === id)) {
          if (Date.now() >= deadline) throw Error('Synthetic pending chat did not start');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }, id);
      return id;
    };
    const aborted = id => app.evaluate((_electron, id) =>
      globalThis.previewNavigation.entries.find(entry => entry.id === id)?.aborted, id);
    const retained = await begin();
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.id = 'navigation-lifetime-probe';
      frame.sandbox = 'allow-same-origin';
      frame.srcdoc = '<p>Synthetic child first load</p>';
      document.body.append(frame);
    });
    await page.frameLocator('#navigation-lifetime-probe').getByText('Synthetic child first load', { exact: true }).waitFor();
    await page.locator('#navigation-lifetime-probe').evaluate(frame => { frame.srcdoc = '<p>Synthetic child reload</p>'; });
    await page.frameLocator('#navigation-lifetime-probe').getByText('Synthetic child reload', { exact: true }).waitFor();
    await page.evaluate(() => { location.hash = 'synthetic-navigation-lifetime'; });
    assert.equal(await aborted(retained), false, 'Child frames and same-document navigation keep the owning request alive');
    const navigations = await app.evaluate(() => globalThis.previewNavigation.events);
    assert.ok(navigations.filter(event => !event.main).length >= 2, 'Both real child document loads were observed');
    assert.ok(navigations.some(event => event.main && event.same), 'Real main-frame same-document navigation was observed');
    await app.evaluate((_electron, id) => globalThis.previewNavigation.entries.find(entry => entry.id === id).finish(), retained);
    assert.equal((await page.evaluate(() => window.navigationPending)).ok, true);
    await page.evaluate(url => history.replaceState(null, '', url), originalUrl);
    await page.locator('#navigation-lifetime-probe').evaluate(frame => frame.remove());
    const reload = await begin();
    await page.reload();
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
    assert.equal(await aborted(reload), true, 'A real main-frame reload cancels the old document request');
    const navigate = await begin();
    await (await app.browserWindow(page)).evaluate((win, url) => win.webContents.loadURL(url), originalUrl);
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
    assert.equal(await aborted(navigate), true, 'Programmatic main-frame navigation cancels the old document request');
    const crashed = await begin();
    const crashOwner = await app.browserWindow(page);
    const previous = await crashOwner.evaluate(win => ({ window: win.id, contents: win.webContents.id,
      renderer: win.webContents.getOSProcessId(), url: win.webContents.getURL() }));
    await Promise.all([
      page.waitForEvent('crash'),
      crashOwner.evaluate(win => win.webContents.forcefullyCrashRenderer()),
    ]);
    await app.evaluate(async (_electron, id) => {
      const deadline = Date.now() + 5000;
      while (!globalThis.previewNavigation.entries.find(entry => entry.id === id)?.aborted) {
        if (Date.now() >= deadline) throw Error('Renderer crash did not cancel the owning request');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }, crashed);
    await recoverCrashedRenderer(crashOwner, previous);
    const destroyed = await begin();
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.previewNavigation.keeper = new BrowserWindow({ show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    });
    await (await app.browserWindow(page)).evaluate(win => win.destroy());
    assert.equal(await aborted(destroyed), true, 'Forced owner-window destruction cancels the old document request');
    console.log('Main-document lifetime: child insert/reload and same-document retained; main reload/loadURL/crash/destroy cancelled.');
  }
  if (process.argv.includes('--navigation-lifetime')) return checkNavigationLifetime();
  async function checkRendererOwnerLifetimes() {
    ownerStage('owners:initialize-probes');
    await app.evaluate(({ BrowserWindow }) => {
      const probe = globalThis.previewOwnerLifetimes;
      const webEvents = ['destroyed', 'did-start-navigation', 'render-process-gone'];
      const windowEvents = ['blur', 'closed'];
      const listeners = (target, names) => Object.fromEntries(names.map(name => [name, target.listeners(name)]));
      probe.arm = (kind, id, url) => {
        if (probe.armed) throw Error('The previous owner probe did not enter its handler');
        const owner = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url);
        if (!owner || owner.isDestroyed()) throw Error('Missing owned renderer');
        const entry = { id, kind, owner, renderer: owner.webContents.getOSProcessId(),
          channel: kind === 'api' ? 'api-keys:configure' : 'interview:open',
          baseline: { web: listeners(owner.webContents, webEvents), window: listeners(owner, windowEvents) } };
        probe.entries.set(id, entry);
        if (kind === 'capture') {
          if (probe.captureActive) throw Error('Previous capture is still active');
          probe.captureEntry = entry;
        } else probe.armed = entry;
      };
      probe.view = id => {
        const entry = probe.entries.get(id);
        const added = entry.added;
        const released = added && ['web', 'window'].every(group => {
          const target = group === 'web' ? entry.owner.webContents : entry.owner;
          return Object.entries(added[group]).every(([event, callbacks]) =>
            callbacks.every(callback => !target.listeners(event).includes(callback)));
        });
        return { kind: entry.kind, renderer: entry.renderer, started: !!entry.started,
          finished: !!entry.finished,
          aborted: entry.signal?.aborted, promptEntered: !!entry.promptEntered, modelsHeld: !!entry.modelsHeld,
          outcome: entry.outcome, result: entry.result, errorName: entry.errorName, errorMessage: entry.errorMessage,
          captureActive: probe.captureActive,
          crashObserved: !!entry.crashObserved, activeAtCrash: entry.activeAtCrash,
          ready: entry.kind === 'capture' ? probe.captureEntry === entry && probe.captureActive && !entry.finished :
            !entry.finished && entry.signal?.aborted === false && (entry.kind === 'api' ? entry.promptEntered : entry.modelsHeld),
          released: !!released,
          added: added && Object.fromEntries(['web', 'window'].map(group =>
            [group, Object.fromEntries(Object.entries(added[group]).map(([event, callbacks]) => [event, callbacks.length]))])),
        };
      };
      probe.seal = (id, willCrash) => {
        const entry = probe.entries.get(id);
        if (entry.added) throw Error('Owner listeners were already captured');
        if (!probe.view(id).ready) throw Error('Owner operation is not pending or active');
        entry.started = true;
        entry.added = Object.fromEntries(['web', 'window'].map(group => {
          const target = group === 'web' ? entry.owner.webContents : entry.owner;
          return [group, Object.fromEntries(Object.entries(entry.baseline[group]).map(([event, previous]) =>
            [event, target.listeners(event).filter(callback => !previous.includes(callback))]))];
        }));
        if (willCrash) entry.owner.webContents.prependOnceListener('render-process-gone', () => {
          entry.activeAtCrash = probe.view(id).ready;
          entry.crashObserved = true;
        });
        return probe.view(id);
      };
      probe.invokeOld = id => {
        const entry = probe.entries.get(id);
        if (!entry.finished && entry.kind !== 'capture') throw Error('Old handler has not settled');
        // Invoke saved OLD owner closures, never emit an event on the new renderer.
        for (const callback of entry.added.web['render-process-gone']) callback.call(entry.owner.webContents);
        entry.releaseModels?.(); // An old catalogue completion must also be harmless.
      };
    });
    const snapshot = id => app.evaluate((_electron, id) => globalThis.previewOwnerLifetimes.view(id), id);
    async function waitState(id, predicate, label) {
      ownerStage(id + ':wait', label);
      const deadline = Date.now() + 15000;
      let value;
      do {
        value = await snapshot(id);
        if (predicate(value)) {
          ownerStage(id + ':ready', value);
          return value;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      throw Error(label + ': ' + JSON.stringify(value));
    }
    const arm = (kind, id) => app.evaluate((_electron, { kind, id, url }) =>
      globalThis.previewOwnerLifetimes.arm(kind, id, url), { kind, id, url: page.url() });
    async function seal(id, crash) {
      const value = await app.evaluate((_electron, { id, crash }) =>
        globalThis.previewOwnerLifetimes.seal(id, crash), { id, crash });
      ownerStage(id + ':listeners', value);
      assert.deepEqual(value.added, value.kind === 'capture'
        ? { web: { destroyed: 0, 'did-start-navigation': 1, 'render-process-gone': 1 }, window: { blur: 1, closed: 1 } }
        : { web: { destroyed: 1, 'did-start-navigation': 1, 'render-process-gone': 1 }, window: { blur: 0, closed: 0 } },
      value.kind + ' owns exactly its scoped lifecycle listeners');
      return value;
    }
    async function crashAndReload(id) {
      ownerStage(id + ':force-renderer-crash');
      const owner = await app.browserWindow(page);
      const previous = await owner.evaluate(win => ({ window: win.id, contents: win.webContents.id,
        renderer: win.webContents.getOSProcessId(), url: win.webContents.getURL() }));
      await Promise.all([page.waitForEvent('crash'), owner.evaluate(win => win.webContents.forcefullyCrashRenderer())]);
      ownerStage(id + ':renderer-crashed');
      const ended = await waitState(id, value => value.finished && value.released, id + ' was not retired after renderer crash');
      assert.equal(ended.crashObserved, true, 'A real renderer-process-gone event occurred');
      assert.equal(ended.activeAtCrash, true, 'The business was still pending/active at the actual crash, before its lifecycle handlers');
      if (ended.kind !== 'capture') assert.equal(ended.aborted, true, 'Only the crashed request owner signal is aborted');
      else assert.equal(ended.captureActive, false);
      ownerStage(id + ':reload');
      const loaded = await recoverCrashedRenderer(owner, previous);
      ownerStage(id + ':reloaded', loaded);
      return ended;
    }
    async function rejectOldClosure(old, retry) {
      ownerStage(retry + ':invoke-saved-old-closure', old);
      const before = await snapshot(retry);
      assert.notEqual(before.renderer, (await snapshot(old)).renderer, 'Retry belongs to a new real renderer process');
      await app.evaluate((_electron, id) => globalThis.previewOwnerLifetimes.invokeOld(id), old);
      const after = await snapshot(retry);
      assert.equal(after.ready, true, 'Saved old owner callbacks do not end the new generation');
      assert.equal(after.finished, false);
      if (after.kind !== 'capture') assert.equal(after.aborted, false);
    }
    async function keyPrompt(id, crash) {
      ownerStage(id + ':open-settings');
      await openSettings();
      await settings.getByRole('radio', { name: 'API 密钥', exact: true }).click();
      const row = settings.getByRole('group', { name: 'Gemini API', exact: true });
      const disclosure = row.locator('.api-service-disclosure');
      if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
      ownerStage(id + ':arm-configure');
      await arm('api', id);
      await row.getByRole('button', { name: '更换密钥', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '更换 API 密钥', exact: true });
      ownerStage(id + ':wait-native-port');
      await dialog.getByLabel('Gemini API 密钥', { exact: true }).and(dialog.locator('input')).waitFor();
      await waitState(id, value => value.ready, 'The real configure handler did not reach its synthetic native prompt');
      await seal(id, crash);
      return dialog;
    }
    await keyPrompt('api-crash', true);
    const apiEnded = await crashAndReload('api-crash');
    assert.equal(apiEnded.result, false, 'Crashed configure returns cancelled, not a saved credential');
    const keyRetry = await keyPrompt('api-retry', false);
    await rejectOldClosure('api-crash', 'api-retry');
    ownerStage('api-retry:save');
    await keyRetry.getByLabel('Gemini API 密钥', { exact: true }).and(keyRetry.locator('input')).fill('synthetic-owner-retry');
    await keyRetry.getByRole('button', { name: '验证并保存', exact: true }).click();
    await keyRetry.waitFor({ state: 'hidden' });
    const apiRetry = await waitState('api-retry', value => value.finished && value.released, 'Retried configure did not finish or release listeners');
    assert.equal(apiRetry.result, true, 'New renderer can configure the synthetic API connection normally');
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    ownerStage('api:passed');
    for (const [id, crash] of [['capture-crash', true], ['capture-retry', false]]) {
      ownerStage(id + ':start-capture');
      await arm('capture', id);
      const result = await page.evaluate(() => window.desktop.shortcutSettings({ op: 'capture', active: true }));
      assert.equal(result.state.capturing, true);
      await seal(id, crash);
      if (crash) await crashAndReload(id);
      else {
        await rejectOldClosure('capture-crash', id);
        assert.equal((await page.evaluate(() => window.desktop.shortcutSettings({ op: 'status' }))).state.capturing, true);
        const stopped = await page.evaluate(() => window.desktop.shortcutSettings({ op: 'capture', active: false }));
        assert.equal(stopped.state.capturing, false);
        await waitState(id, value => value.finished && value.released, 'Retried capture did not release its listeners');
      }
    }
    ownerStage('capture:passed');
    // Signing into VoxCue does not connect an AI service. Use the same explicit
    // provider action as normal API/interview UI checks before asking preflight
    // to validate its session; a synthetic model catalogue alone is insufficient.
    ownerStage('opening:enable-gemini');
    await openSettings();
    await settings.getByRole('radio', { name: 'API 密钥', exact: true }).click();
    const gemini = settings.getByRole('group', { name: 'Gemini API', exact: true });
    const enableGemini = gemini.getByRole('button', { name: '启用', exact: true });
    if (await enableGemini.isVisible()) await enableGemini.click();
    await gemini.getByRole('button', { name: '禁用', exact: true }).waitFor();
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    ownerStage('opening:read-models');
    const catalog = await page.evaluate(() => window.desktop.chatModels(false));
    assert.equal(catalog.ok, true);
    assert.ok(catalog.models.length > 0);
    assert.equal(catalog.models[0].provider?.id, 'gemini', 'Opening uses the explicitly connected API service');
    const configuration = { mode: 'local', inputMode: 'remote', options: {
      sources: ['system'], speechModel: 'paraformer', inferenceDevice: 'cpu',
    }, aiEnabled: true, autoAnswer: false, autoRecord: false, modelId: catalog.models[0].id, effort: 'auto' };
    async function opening(id, crash) {
      ownerStage(id + ':start-opening');
      await arm('opening', id);
      await page.evaluate(configuration => {
        window.ownerOpening = window.desktop.openInterview(configuration);
        window.ownerOpening.catch(() => {});
      }, configuration);
      await waitState(id, value => value.ready, 'The real interview:open handler did not reach its owned model wait');
      await seal(id, crash);
    }
    await opening('opening-crash', true);
    const openingEnded = await crashAndReload('opening-crash');
    assert.equal(openingEnded.outcome, 'rejected');
    await opening('opening-retry', false);
    await rejectOldClosure('opening-crash', 'opening-retry');
    ownerStage('opening-retry:release-models');
    const opened = app.waitForEvent('window');
    await app.evaluate(() => globalThis.previewOwnerLifetimes.entries.get('opening-retry').releaseModels());
    const floating = await opened;
    await floating.waitForURL(url => url.hash === '#interview');
    await floating.locator('.floating-toolbar').waitFor();
    await page.evaluate(() => window.ownerOpening);
    const openingRetry = await waitState('opening-retry', value => value.finished && value.released,
      'Retried interview opening did not complete or release listeners');
    assert.equal(openingRetry.outcome, 'resolved', 'New renderer can complete the real interview opening');
    ownerStage('opening-retry:close-interview');
    await floating.getByRole('button', { name: '结束面试', exact: true }).click();
    await Promise.all([floating.waitForEvent('close'), floating.getByRole('button', { name: '确认结束面试', exact: true }).click()]);
    ownerStage('opening:passed');
    console.log('Renderer owner lifetimes: real API prompt, shortcut capture and interview opening crash/cleanup/reload/retry passed; saved old generation callbacks did not affect new owners.');
  }
  if (rendererOwnerLifetimes) return checkRendererOwnerLifetimes();
  async function chooseModel(name) {
    const menu = await openModelMenu(page);
    assert.equal(await menu.getByText('OpenAI API', { exact: true }).count(), 0, 'API menus omit the provider heading');
    assert.equal(await menu.getByText('DeepSeek', { exact: true }).count(), 0, 'API menus omit the provider heading');
    await menu.getByRole('menuitem', { name: '刷新模型列表', exact: true }).waitFor();
    await menu.getByRole('menuitemradio', { name, exact: true }).click();
    // Choosing a model leaves its effort popup open; close it before using the composer.
    await page.keyboard.press('Escape');
    await page.getByRole('menu', { name: '思考强度', exact: true }).waitFor({ state: 'hidden' });
  }
  async function checkProfileStream() {
    const { request, prefix, suffix } = apiPreview.profilePreview;
    await enableDeepSeek();
    await chooseModel('DeepSeek-V4-Pro');

    const readSavedBackground = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1'))?.background);
    const before = await readSavedBackground();
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(request);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    const streaming = page.getByRole('region', { name: '正在生成的资料提案', exact: true });
    await streaming.getByText(prefix, { exact: true }).waitFor();
    assert.ok(await streaming.getByRole('button', { name: '保存所选', exact: true }).isDisabled());
    await streaming.getByRole('button', { name: '查看简历摘要', exact: true }).click();
    const reader = page.getByRole('dialog', { name: '简历摘要', exact: true });
    await reader.getByText(prefix, { exact: true }).waitFor();
    assert.equal(await reader.getByRole('checkbox').count(), 0, 'Streaming reader is read-only');
    assert.equal(await readSavedBackground(), before);

    await app.evaluate(() => globalThis.finishApiProfilePreview());
    await reader.getByText(prefix + suffix, { exact: true }).waitFor();
    await reader.getByRole('button', { name: '关闭对话框', exact: true }).click();
    const complete = page.getByRole('region', { name: '待确认的资料更新', exact: true });
    const save = complete.getByRole('button', { name: '保存所选', exact: true });
    assert.equal(await readSavedBackground(), before, 'Completing the stream cannot save the draft');
    await save.click();
    await complete.getByText('已保存所选资料', { exact: true }).waitFor();
    assert.equal(await readSavedBackground(), prefix + suffix);
    console.log('DeepSeek structured streaming, read-only preview and explicit save passed.');
  }
  if (process.argv.includes('--profile-stream')) return checkProfileStream();
  async function checkDeepSeekPreparation() {
    const { answer, unlabeled } = apiPreview.deepSeekPreparation;
    await enableDeepSeek();
    const log = page.getByLabel('聊天内容', { exact: true });
    const cards = log.getByRole('region', { name: '待确认的资料更新', exact: true });
    const sendButton = page.getByRole('button', { name: '发送消息', exact: true });
    const readSavedRole = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1'))?.jobDescription);
    const send = async (text) => {
      await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(text);
      await sendButton.click();
    };
    for (const [name, roles] of [
      ['DeepSeek-V4.1-Flash', ['软件工程师', '硬件工程师']],
      ['DeepSeek-V4-Pro', ['测试工程师', '嵌入式工程师']],
    ]) {
      await page.getByRole('button', { name: '新对话', exact: true }).click();
      await chooseModel(name);

      // The server holds the rest of this answer until released below.
      await send(answer.request);
      await log.getByText(answer.first).waitFor();
      assert.equal(await log.getByText(answer.rest).count(), 0, `${name}: later text is still on the server`);
      assert.ok(await page.getByRole('button', { name: '停止回复', exact: true }).isVisible(), `${name}: still streaming`);
      await app.evaluate(() => globalThis.finishApiAnswerStream());
      await log.getByText(answer.first + answer.rest).waitFor();
      await sendButton.waitFor();
      assert.equal(await cards.count(), 0, `${name}: an ordinary answer has no proposal`);

      // A searched answer without the intent line stays visible; only its structure is asked again.
      const followUps = await app.evaluate(() => globalThis.apiStructureFollowUps ?? 0);
      await send(unlabeled.request);
      await log.getByText(unlabeled.answer).waitFor();
      await sendButton.waitFor();
      assert.equal(await app.evaluate(() => globalThis.apiStructureFollowUps ?? 0), followUps + 1,
        `${name}: a missing intent line asks only for the structure`);
      assert.equal(await log.getByText('没有标明本轮是否修改资料').count(), 0, `${name}: no error is shown`);
      assert.equal(await cards.count(), 0, `${name}: the follow-up proposed no change`);

      const before = await readSavedRole();
      await send(`把目标岗位改成${roles[0]}`);
      await cards.nth(0).getByText(roles[0]).first().waitFor();
      await sendButton.waitFor();
      await send(`不对，改成${roles[1]}`);
      await cards.nth(0).getByText('已保留原资料', { exact: true }).waitFor();
      assert.equal(await cards.nth(0).getByRole('button', { name: '保存所选', exact: true }).count(), 0,
        `${name}: sending a new message dismisses the previous proposal`);
      await cards.nth(1).getByText(roles[1]).first().waitFor();
      await sendButton.waitFor();
      assert.equal(await cards.count(), 2, `${name}: the newer request has its own proposal`);
      assert.equal(await readSavedRole(), before, `${name}: proposals do not save the profile`);
      await cards.nth(1).getByRole('button', { name: '保存所选', exact: true }).click();
      await cards.nth(1).getByText('已保存所选资料', { exact: true }).waitFor();
      assert.equal(await readSavedRole(), roles[1]);
    }
    await openSettings();
    const openai = settings.getByRole('group', { name: 'OpenAI API', exact: true });
    await openai.getByRole('button', { name: '启用', exact: true }).click();
    await openai.getByRole('button', { name: '禁用', exact: true }).waitFor();
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await chooseModel('gpt-6.2-sol');
    console.log('DeepSeek Flash and V4 Pro incremental answers, structure follow-up, automatic retention of older proposals and API menus without provider headings passed.');
  }
  if (process.argv.includes('--deepseek-preparation')) return checkDeepSeekPreparation();
  async function checkGoogleSearch(answer) {
    const widget = answer.getByTitle('Google 搜索建议', { exact: true });
    await widget.waitFor();
    assert.equal(await widget.getAttribute('sandbox'), 'allow-same-origin');
    assert.ok(await widget.evaluate(frame => {
      const group = frame.closest('.chat-source-group');
      const answer = frame.closest('.chat-message').querySelector('.chat-answer');
      const progress = frame.closest('.chat-message').querySelector('.response-progress');
      const row = group?.querySelector('.chat-sources');
      return group && !frame.closest('details') && group.getBoundingClientRect().bottom <= answer.getBoundingClientRect().top &&
        group.firstElementChild === frame.parentElement &&
        (!progress || (frame.getBoundingClientRect().top >= progress.getBoundingClientRect().bottom &&
          frame.getBoundingClientRect().top - progress.getBoundingClientRect().bottom <= 9)) &&
        (!row || (row.getBoundingClientRect().top >= frame.getBoundingClientRect().bottom &&
          row.getBoundingClientRect().top - frame.getBoundingClientRect().bottom <= 7));
    }), 'Google suggestions sit directly below the duration divider, before source links and the answer');
    const original = await widget.getAttribute('srcdoc');
    assert.ok(original.includes(apiPreview.googleSearch.html), 'Original Google snippet is retained');
    await answer.getByRole('button', { name: apiPreview.googleSearch.source.title + ' · example.org', exact: true }).waitFor();
    await page.emulateMedia({ colorScheme: null });
    for (const theme of ['深色', '浅色']) {
      await openSettings();
      await settings.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '通用', exact: true }).click();
      await settings.getByRole('button', { name: '外观主题', exact: true }).click();
      await page.getByRole('menuitemradio', { name: theme, exact: true }).click();
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
      await widget.evaluate(async frame => {
        const group = frame.closest('.chat-source-group');
        for (const width of [280, 560]) {
          group.style.width = width + 'px';
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const body = frame.contentDocument.body;
          if (group.scrollWidth > group.clientWidth + 1 || body.scrollWidth > frame.clientWidth + 1 ||
              body.getBoundingClientRect().height > frame.clientHeight + 1 ||
              frame.contentDocument.documentElement.scrollHeight > frame.contentDocument.documentElement.clientHeight)
            throw Error('Google suggestions must fit without clipping');
        }
        group.style.width = '';
      });
      const content = widget.contentFrame();
      assert.deepEqual(await content.locator('.container').evaluate(node => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, shadow: style.boxShadow };
      }), { background: 'rgba(0, 0, 0, 0)', shadow: 'none' }, 'The official Google structure has no outer background plate');
      assert.equal(await content.locator('.headline svg').count(), 2, 'Both official Google theme logos are retained');
      assert.ok(await content.locator(theme === '深色' ? '.logo-dark' : '.logo-light').isVisible(), 'Google branding follows the application theme');
      assert.equal(await content.locator('.chip').evaluate(node => getComputedStyle(node).color),
        theme === '深色' ? 'rgb(255, 255, 255)' : 'rgb(94, 94, 94)', 'Google suggestions follow the application theme');
    }
    await widget.contentFrame().getByRole('link', { name: apiPreview.googleSearch.label, exact: true }).click();
    assert.equal(await app.evaluate(() => globalThis.previewGoogleLink), apiPreview.googleSearch.link);
    const malicious = '<meta http-equiv="refresh" content="0;url=https://example.org/blocked-frame">' +
      '<script>window.parent.googleSnippetExecuted=true</script>' +
      '<button onclick="window.parent.googleSnippetExecuted=true">Sandbox probe</button>' +
      '<iframe src="https://example.org/blocked-child"></iframe>';
    await widget.evaluate((frame, html) => { frame.srcdoc = html; }, original.replace('</body>', malicious + '</body>'));
    await widget.contentFrame().getByRole('button', { name: 'Sandbox probe', exact: true }).click();
    assert.equal(await page.evaluate(() => window.googleSnippetExecuted), undefined, 'Snippet scripts and inline handlers are disabled');
    assert.equal(await widget.contentFrame().locator('body').evaluate(() => location.href), 'about:srcdoc');
    await widget.evaluate((frame, html) => { frame.srcdoc = html; }, original);
    await widget.contentFrame().getByRole('link', { name: apiPreview.googleSearch.label, exact: true }).waitFor();
  }
  async function checkProviderLogos() {
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const icons = new Map();
    async function source(image) {
      await image.waitFor();
      await assertPlainProviderLogo(image);
      return image.evaluate(node => {
        const rect = node.getBoundingClientRect();
        if (!node.naturalWidth || rect.width < 1 || rect.height < 1) throw Error('Provider image is not visible');
        return node.currentSrc;
      });
    }
    async function select(name) {
      await openSettings();
      await settings.getByRole('radio', { name: 'API 密钥', exact: true }).click();
      assert.deepEqual(await settings.locator('.api-service-disclosure strong').allTextContents(),
        ['OpenAI API', 'Gemini API', 'DeepSeek', 'Kimi']);
      const row = settings.getByRole('group', { name, exact: true });
      icons.set(name, await source(row.locator('.api-service-disclosure img')));
      const enable = button(row, '启用');
      if (await enable.isVisible()) await enable.click();
      await button(row, '禁用').waitFor();
      await button(settings, '关闭设置').click();
      await settings.waitFor({ state: 'hidden' });
    }
    async function verify(answer, name) {
      const label = answer.locator('.provider-name');
      await label.waitFor();
      assert.equal(await label.innerText(), name, 'Answer provider');
      const image = answer.locator('.provider-avatar img');
      assert.ok(await source(image) === icons.get(name), name + ' answer must use its settings logo');
      await answer.locator('.markdown-content').getByText(/这是模拟回答/).waitFor();
      await answer.locator('.typing-caret').waitFor({ state: 'detached' });
    }
    async function chat(question, name) {
      const answers = page.locator('.chat-message.assistant');
      const index = await answers.count();
      await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(question);
      await button(page, '发送消息').click();
      const answer = answers.nth(index);
      await verify(answer, name);
      await answer.locator('.chat-message-actions').waitFor();
      await button(page, '停止回复').waitFor({ state: 'detached' });
      await button(page, '发送消息').waitFor();
      const saved = await waitForAsync(page, async id => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('voxcue-preparation-chats', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const rows = await new Promise((resolve, reject) => {
            const request = db.transaction('state').objectStore('state').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const message = rows.flatMap(row => row.messages ?? []).find(message => message.id === id);
          return message && message.status !== 'streaming'
            ? { status: message.status, error: message.error, errorCode: message.errorCode } : null;
        } finally { db.close(); }
      }, await answer.getAttribute('data-message-id'));
      assert.deepEqual(saved, { status: 'completed', error: undefined, errorCode: undefined },
        name + ' reply must complete and persist without an error');
      assert.equal(await answer.locator('.message-error').count(), 0, name + ' reply must not show a failure');
      assert.doesNotMatch(await page.locator('.preparation-notices').innerText(),
        /(?:未启用|不支持|未提供).{0,16}(?:网页|网络|联网)搜索|(?:网页|网络|联网)搜索.{0,16}(?:未启用|不可用|未执行)/,
        'A successful API reply must not leave a web search warning below the chat');
      return answer;
    }
    async function interview(question, name, capture) {
      await button(page, '开始面试').click();
      const start = page.getByRole('dialog', { name: '开始面试', exact: true });
      const [floating] = await Promise.all([app.waitForEvent('window'), button(start, '确认开始').click()]);
      await floating.waitForURL(url => url.hash === '#interview');
      const input = floating.getByRole('textbox', { name: '面试提问', exact: true });
      await input.fill(question);
      await input.press('Enter');
      const answer = floating.getByRole('article', { name: '回答：' + question, exact: true });
      await verify(answer, name);
      if (capture) await captureRequested(floating.locator('.floating-answer'), 'VoxCue-1.3.0-interview-provider-logo');
      await button(floating, '结束面试').click();
      await Promise.all([floating.waitForEvent('close'), button(floating, '确认结束面试').click()]);
    }
    if (process.argv.includes('--gemini-completion')) {
      await select('Gemini API');
      await checkGoogleSearch(await chat('请用 Gemini 回答这个准备问题。', 'Gemini API'));
      return;
    }
    const firstQuestion = '请介绍本场面试使用的模型。';
    await select('OpenAI API');
    const openai = await chat('请介绍当前使用的模型。', 'OpenAI API');
    await interview(firstQuestion, 'OpenAI API', false);
    await select('DeepSeek');
    assert.ok(icons.get('DeepSeek') !== icons.get('OpenAI API'), 'The two settings logos must differ');
    await verify(openai, 'OpenAI API');
    const deepseek = await chat('切换后，现在使用哪个模型？', 'DeepSeek');
    await verify(openai, 'OpenAI API');
    await verify(deepseek, 'DeepSeek');
    for (const theme of ['深色', '浅色']) {
      await openSettings();
      await button(settings.getByRole('navigation', { name: '设置分类' }), '通用').click();
      await button(settings, '外观主题').click();
      await page.getByRole('menuitemradio', { name: theme, exact: true }).click();
      await button(settings, '关闭设置').click();
      await settings.waitFor({ state: 'hidden' });
      await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === '深色');
      for (const [answer, name] of [[openai, 'OpenAI API'], [deepseek, 'DeepSeek']]) {
        await verify(answer, name);
        const metrics = await answer.locator('.answer-label .provider-avatar').evaluate(avatar => {
          const style = getComputedStyle(avatar), slot = avatar.getBoundingClientRect();
          const image = avatar.querySelector('img').getBoundingClientRect();
          const text = avatar.nextElementSibling.getBoundingClientRect();
          const px = value => Math.round(value * 1000) / 1000;
          return {
            background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow,
            border: ['Top', 'Right', 'Bottom', 'Left'].some(side =>
              parseFloat(style['border' + side + 'Width']) > 0 && !['none','hidden'].includes(style['border' + side + 'Style']) &&
              style['border' + side + 'Color'] !== 'rgba(0, 0, 0, 0)'),
            logo: [px(image.width), px(image.height)], slot: [px(slot.width), px(slot.height)],
            gap: px(text.left - slot.right), rowHeight: px(avatar.parentElement.getBoundingClientRect().height),
          };
        });
        assert.deepEqual(metrics, { background:'rgba(0, 0, 0, 0)', image:'none', shadow:'none', border:false,
          logo:[18,18], slot:[25,25], gap:7, rowHeight:25 }, name + ' ' + theme + ' answer logo');
      }
    }
    await captureRequested(page.locator('.preparation-workspace'), 'VoxCue-1.3.0-chat-provider-logos-plain');
    await button(page, '面试记录').click();
    await page.locator('.history-row-open').first().click();
    const toggle = button(page, 'AI 回答面板');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await verify(page.getByRole('article', { name: '回答：' + firstQuestion, exact: true }), 'OpenAI API');
    await button(page, '新对话').click();
    await interview('请说明本场面试的模型和思考设置。', 'DeepSeek', true);
    await select('Kimi');
    await chat('请用 Kimi 回答这个准备问题。', 'Kimi');
    await checkInterviewBilling('Kimi API', '剩余 12.50 CNY');
    await interview('请用 Kimi 回答这个面试问题。', 'Kimi', false);
    await openSettings();
    const kimi = settings.getByRole('group', { name: 'Kimi', exact: true });
    await kimi.getByText('12.50 CNY', { exact: true }).waitFor();
    await button(kimi, '禁用').click();
    await kimi.getByRole('button', { name: /^移除密钥/ }).click();
    await kimi.getByRole('button', { name: /^确认/ }).click();
    await button(kimi, '添加密钥').click();
    const dialog = page.getByRole('dialog', { name: '添加 API 密钥', exact: true });
    await dialog.getByLabel('Kimi API 密钥', { exact: true }).and(dialog.locator('input')).fill('synthetic-kimi');
    await button(dialog, '验证并保存').click();
    await kimi.getByRole('button', { name: /^移除密钥/ }).waitFor();
    assert.ok(await button(kimi, '启用').isEnabled());
    await button(settings, '关闭设置').click();
    await settings.waitFor({ state: 'hidden' });
    await select('Gemini API');
    const geminiAnswer = await chat('请用 Gemini 回答这个准备问题。', 'Gemini API');
    await checkGoogleSearch(geminiAnswer);
    await checkInterviewBilling('Gemini API', 'API计费');
    await interview('请用 Gemini 回答这个面试问题。', 'Gemini API', false);
    await openSettings();
    const gemini = settings.getByRole('group', { name: 'Gemini API', exact: true });
    assert.equal(await gemini.getByText('账户余额', { exact: true }).count(), 0);
    await button(gemini, '禁用').click();
    await gemini.getByRole('button', { name: /^移除密钥/ }).click();
    await gemini.getByRole('button', { name: /^确认/ }).click();
    await button(gemini, '添加密钥').click();
    await dialog.getByLabel('Gemini API 密钥', { exact: true }).and(dialog.locator('input')).fill('synthetic-gemini');
    await button(dialog, '验证并保存').click();
    await gemini.getByRole('button', { name: /^移除密钥/ }).waitFor();
    await button(gemini, '启用').click();
    await button(gemini, '禁用').waitFor();
    await button(gemini, '更换密钥').click();
    const replace = page.getByRole('dialog', { name: '更换 API 密钥', exact: true });
    await replace.getByLabel('Gemini API 密钥', { exact: true }).and(replace.locator('input')).fill('synthetic-gemini-replacement');
    await button(replace, '验证并保存').click();
    await replace.waitFor({ state: 'hidden' });
    await button(settings, '关闭设置').click();
    await settings.waitFor({ state: 'hidden' });
    await verify(geminiAnswer, 'Gemini API');
    console.log('OpenAI, DeepSeek, Kimi and Gemini settings, chat, interview and retained answer logos passed.');
  }
  if (process.argv.includes('--provider-logos') || process.argv.includes('--gemini-completion')) return checkProviderLogos();
  async function checkInterviewBilling(service, expected, screenshotName) {
    await page.getByRole('button', { name: '开始面试', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '开始面试', exact: true });
    const summary = dialog.getByRole('group', { name: '当前面试设置', exact: true });
    const row = summary.locator('dl > div').filter({
      has: page.getByText(service, { exact: true }).and(page.locator('dt')),
    });
    await row.getByText(expected, { exact: true }).waitFor();
    assert.deepEqual(await row.locator(':scope > dt, :scope > dd').allInnerTexts(), [service, expected]);
    assert.ok(await row.evaluate(node => {
      const label = node.querySelector('dt').getBoundingClientRect();
      const value = node.querySelector('dd').getBoundingClientRect();
      return label.width > 0 && value.width > 0 && label.right <= value.left &&
        label.top < value.bottom && value.top < label.bottom;
    }), expected + ' must appear to the right of its label in the same row');
    await dialog.getByRole('button', { name: '确认开始', exact: true }).and(dialog.locator(':enabled')).waitFor();
    if (screenshotName) await captureRequested(dialog, screenshotName);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await openSettings();
  const methods = settings.getByRole('radiogroup', { name: '登录方式', exact: true });
  let connectSizes;
  if (check) {
    await methods.getByRole('radio', { name: '账号授权', exact: true }).click();
    const accountRows = settings.locator('[data-settings-target="chatgpt"], [data-settings-target="copilot"]');
    await accountRows.last().waitFor();
    connectSizes = await accountRows.getByRole('button', { name: '登录', exact: true }).evaluateAll(
      buttons => buttons.map(button => [button.offsetWidth, button.offsetHeight]),
    );
  }
  await methods.getByRole('radio', { name: 'API 密钥', exact: true }).click();
  const active = settings.getByRole('group', { name: 'DeepSeek', exact: true });
  const openai = settings.getByRole('group', { name: 'OpenAI API', exact: true });
  async function expectDetails(group, provider, open) {
    const id = 'api-settings-' + provider;
    await group.locator(`button[aria-controls="${id}"][aria-expanded="${open}"]`).waitFor();
    const panel = group.locator('#' + id);
    if (!open) {
      assert.ok(await panel.evaluate(node => {
        const content = node.querySelector('.api-service-details');
        if (!content) return true;
        const action = content.querySelector('button:not(:disabled), input:not(:disabled)');
        action?.focus();
        return !!content.closest('[inert]') && !node.contains(document.activeElement);
      }), 'Closing details immediately disables focus and interaction');
      await panel.locator('.api-service-details').waitFor({ state: 'detached' });
      assert.equal(await panel.evaluate(node => node.getBoundingClientRect().height), 0);
      return;
    }
    const reveal = panel.locator(':scope > .interview-reveal[data-open="true"]:not([inert])');
    await reveal.waitFor();
    await reveal.evaluate(async node => {
      await Promise.allSettled(node.getAnimations().map(animation => animation.finished));
    });
    assert.ok(await panel.evaluate(node => node.getBoundingClientRect().height > 0));
    assert.ok(await panel.getByRole('button', { name: /更换密钥|输入 API 密钥/ }).isVisible());
  }
  async function checkUsageLayout(group, { balance }) {
    const detail = group.locator('.api-service-details');
    const card = detail.locator('.api-usage.account-quota[aria-busy="false"]');
    await card.waitFor();
    const metrics = card.locator('dl.api-usage-values > .api-usage-line');
    const labels = ['本机请求', '输入 token', '输出 token'];
    assert.deepEqual(await metrics.locator('dt').allTextContents(),
      balance ? ['账户余额', ...labels] : labels);
    assert.equal(await detail.locator('progress, [role="progressbar"], .account-quota-progress').count(), 0);
    const layout = await detail.evaluate(node => {
      const bounds = element => element.getBoundingClientRect();
      const group = node.closest('.api-service');
      const serviceHeader = group.querySelector('.ai-service-row');
      const usage = node.querySelector('.api-usage');
      const card = bounds(usage);
      const heading = bounds(usage.querySelector('header strong'));
      const refresh = bounds(usage.querySelector('header button'));
      const stats = usage.querySelector('dl');
      const items = [...stats.querySelectorAll('.api-usage-line')];
      const keyRow = node.querySelector('.api-detail-row');
      const textActions = [...keyRow.querySelectorAll('.api-text-action:enabled')];
      const key = bounds(keyRow.querySelector('.api-key-value'));
      const links = bounds(keyRow.querySelector('.api-links'));
      const divider = bounds(group).bottom;
      const nextHeader = group.nextElementSibling?.querySelector('.ai-service-row');
      const adjacent = nextHeader ?? group.previousElementSibling.querySelector('.ai-service-row');
      const headerPositions = header => [
        bounds(header.querySelector('.service-brand-icon')).left,
        bounds(header.querySelector('.ai-service-label strong')).left,
        ...[...header.querySelectorAll('.ai-service-actions button')].flatMap(button => {
          const { left, right } = bounds(button);
          return [left, right];
        }),
      ];
      const collapsed = headerPositions(adjacent);
      const standardHeight = parseFloat(getComputedStyle(node).getPropertyValue('--control-height'));
      const wideTops = items.map(item => bounds(item).top);
      const openSides = style => [style.borderTopWidth, style.borderLeftWidth, style.borderRightWidth]
        .every(width => parseFloat(width) === 0);
      const normal = {
        alignedServiceHeaders: adjacent.querySelector('.api-service-disclosure').getAttribute('aria-expanded') === 'false'
          && headerPositions(serviceHeader).every((position, i) => Math.abs(position - collapsed[i]) <= 1),
        noOuterFrame: openSides(getComputedStyle(group)) && ['::before', '::after'].every(pseudo => {
          const style = getComputedStyle(group, pseudo);
          return style.content === 'none' || style.opacity === '0' || openSides(style);
        }),
        outlinedCard: parseFloat(getComputedStyle(usage).borderTopWidth) > 0,
        innerDividers: items.slice(1).every(item => parseFloat(getComputedStyle(item).borderInlineStartWidth) > 0),
        refreshInCard: card.top <= refresh.top && heading.right < refresh.left &&
          heading.top < refresh.bottom && refresh.top < heading.bottom && refresh.bottom <= bounds(stats).top + 1,
        standardRefresh: Math.abs(refresh.height - standardHeight) < 1,
        metricsInline: Math.max(...wideTops) - Math.min(...wideTops) <= 1,
        keysBelowCard: bounds(keyRow).top >= card.bottom - 1,
        textLinkPointers: textActions.length === 3 && textActions.every(button => {
          const icon = button.querySelector('svg');
          return icon && getComputedStyle(button).cursor === 'pointer' && getComputedStyle(icon).cursor === 'pointer';
        }),
        linksAtRight: key.right <= links.left + 1 && key.top < links.bottom && links.top < key.bottom &&
          Math.abs(links.right - bounds(keyRow).right) <= 1,
        keyRowLast: keyRow === node.lastElementChild,
        dividerLast: getComputedStyle(serviceHeader).borderBottomWidth === '0px' &&
          (!nextHeader || (parseFloat(getComputedStyle(group).borderBottomWidth) > 0 &&
            bounds(keyRow).bottom < divider && divider <= bounds(nextHeader).top + 1)),
      };
      const fittedWidth = node.style.width;
      try {
        node.style.width = '280px';
        const narrow = bounds(node);
        const tops = items.map(item => bounds(item).top);
        const contents = [...node.querySelectorAll('button, input, dt, dd')];
        return {
          ...normal,
          narrowWraps: Math.max(...tops) - Math.min(...tops) > 1,
          narrowFits: node.scrollWidth <= node.clientWidth + 1 && contents.every(element => {
            const rect = bounds(element);
            return rect.left >= narrow.left - 1 && rect.right <= narrow.right + 1;
          }),
        };
      } finally {
        node.style.width = fittedWidth;
      }
    });
    const name = await group.getAttribute('aria-label');
    for (const [requirement, met] of Object.entries(layout))
      assert.ok(met, name + ' usage layout: ' + requirement);
  }
  await active.getByRole('button', { name: '启用', exact: true }).click();
  await active.getByRole('button', { name: '禁用', exact: true }).waitFor();
  await settings.getByText('28.50 CNY', { exact: true }).waitFor();
  if (check) {
    await expectDetails(active, 'deepseek', true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const motion = await active.locator('#api-settings-deepseek').evaluateHandle(panel => {
      const runs = [];
      function record(event) {
        if (event.propertyName === 'grid-template-rows' && event.target.parentElement === panel)
          runs.push(event.target.dataset.open);
      }
      panel.addEventListener('transitionrun', record);
      return { runs, stop: () => panel.removeEventListener('transitionrun', record) };
    });
    try {
      await active.getByRole('button', { name: '禁用', exact: true }).click();
      await expectDetails(active, 'deepseek', false);
      await active.getByRole('button', { name: '启用', exact: true }).click();
      await expectDetails(active, 'deepseek', true);
      assert.deepEqual(await motion.evaluate(observer => observer.runs), ['false', 'true'],
        'Collapsing and expanding each start a grid row height transition');
    } finally {
      await motion.evaluate(observer => observer.stop());
      await motion.dispose();
      await page.emulateMedia({ reducedMotion: null });
    }
    await active.getByText('28.50 CNY', { exact: true }).waitFor();
    const detail = active.locator('#api-settings-deepseek .api-service-details');
    await detail.locator('.api-key-mask').waitFor();
    assert.equal(await detail.getByRole('textbox').count(), 0);
    const refresh = detail.getByRole('button', { name: '刷新用量', exact: true });
    await detail.locator('.api-usage[aria-busy="false"]').waitFor();
    assert.equal((await refresh.textContent()).trim(), '刷新');
    await refresh.locator('svg').waitFor();
    await refresh.click();
    await detail.locator('.api-usage[aria-busy="false"]').waitFor();
    await detail.getByText('28.50 CNY', { exact: true }).waitFor();
    await checkUsageLayout(active, { balance: true });
    const actions = openai.locator('.ai-service-actions').getByRole('button');
    const rectangles = () => actions.evaluateAll(async (buttons) => {
      await Promise.allSettled(buttons.flatMap(button => button.getAnimations().map(a => a.finished)));
      return buttons.map(button => {
        const { x, y, width, height } = button.getBoundingClientRect();
        const cssPixel = v => Math.round(v * 64) / 64;
        return { x: cssPixel(x), y: cssPixel(y), width: cssPixel(width), height: cssPixel(height) };
      });
    });
    const idle = await rectangles();
    const standardHeight = await settings.evaluate(dialog =>
      parseFloat(getComputedStyle(dialog).getPropertyValue('--control-height')));
    assert.deepEqual(idle.map(rect => rect.height), [standardHeight, standardHeight]);
    const enableSize = [Math.round(idle[0].width), Math.round(idle[0].height)];
    assert.deepEqual(connectSizes, [enableSize, enableSize], 'Account Connect must match API Enable');
    console.log('Service buttons (CSS px)', { connect: connectSizes[0], enable: enableSize, remove: idle[1].width });
    await openai.getByRole('button', { name: '启用', exact: true }).click();
    await expectDetails(openai, 'openai', true);
    await expectDetails(active, 'deepseek', false);
    await checkUsageLayout(openai, { balance: false });
    const removeKey = openai.getByRole('button', { name: /^移除密钥/ });
    await removeKey.scrollIntoViewIfNeeded();
    const selected = await rectangles();
    await removeKey.click();
    const confirmed = openai.getByRole('button', { name: /^确认/ });
    await confirmed.waitFor();
    assert.deepEqual(await rectangles(), selected, 'Confirming removal must preserve both capsules');
    await confirmed.click();
    await expectDetails(openai, 'openai', false);
    assert.ok(await openai.getByRole('button', { name: '启用', exact: true }).isDisabled());
    const add = openai.getByRole('button', { name: '添加密钥', exact: true });
    const openaiToggle = openai.locator('button[aria-controls="api-settings-openai"]');
    await openaiToggle.click();
    await expectDetails(openai, 'openai', true);
    await openaiToggle.click();
    await expectDetails(openai, 'openai', false);
    const prompt = page.getByRole('dialog', { name: '添加 API 密钥', exact: true });
    await add.click();
    const sample = prompt.getByLabel('OpenAI API 密钥', { exact: true }).and(prompt.locator('input'));
    await sample.waitFor();
    assert.equal(await sample.getAttribute('placeholder'), null);
    for (const name of ['取消', '验证并保存', '显示密钥'])
      await prompt.getByRole('button', { name, exact: true }).locator('svg').waitFor();
    const textInset = await sample.evaluate(input => {
      const frame = input.closest('.api-key-input-frame');
      return input.getBoundingClientRect().left - frame.getBoundingClientRect().left
        - parseFloat(getComputedStyle(frame).borderLeftWidth) + parseFloat(getComputedStyle(input).paddingLeft);
    });
    assert.ok(Math.abs(textInset - 12) < 0.02, 'Match the 12px inset of a standard settings input');
    await prompt.getByRole('button', { name: '取消', exact: true }).click();
    await prompt.waitFor({ state: 'hidden' });
    await add.click();
    const save = prompt.getByRole('button', { name: '验证并保存', exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      const previous = await sample.elementHandle();
      if (attempt === 0) await save.click();
      else await page.keyboard.press('Enter');
      await prompt.getByRole('alert').filter({ hasText: 'API 密钥格式无效。' }).waitFor();
      await page.waitForFunction(old => {
        const current = document.querySelector('[data-api-key-field] input');
        return current && current !== old && current === document.activeElement;
      }, previous);
      await previous.dispose();
      assert.ok(await save.isEnabled());
      assert.equal(await prompt.getByRole('button', { name: '重新输入' }).count(), 0);
    }
    const errorColors = await prompt.getByRole('alert').evaluate(alert => {
      const root = document.documentElement;
      const wasDark = root.classList.contains('dark');
      const swatch = document.createElement('span');
      swatch.style.color = 'var(--danger)';
      alert.append(swatch);
      try {
        return [false, true].map(dark => {
          root.classList.toggle('dark', dark);
          return [getComputedStyle(alert).color, getComputedStyle(swatch).color];
        });
      } finally {
        root.classList.toggle('dark', wasDark);
        swatch.remove();
      }
    });
    for (const [actual, expected] of errorColors) assert.equal(actual, expected);
    assert.notEqual(errorColors[0][0], errorColors[1][0]);
    await page.keyboard.type('demo-key');
    await prompt.getByRole('button', { name: /显示.*密钥/ }).click();
    await prompt.locator('[data-api-key-field] input[type=text]').waitFor();
    await prompt.getByRole('button', { name: /隐藏.*密钥/ }).click();
    await prompt.locator('[data-api-key-field] input[type=password]').waitFor();
    await prompt.getByRole('button', { name: '验证并保存', exact: true }).click();
    await openai.getByRole('button', { name: /^移除密钥/ }).waitFor();
    await active.getByRole('button', { name: '启用', exact: true }).click();
    await expectDetails(active, 'deepseek', true);
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    const menu = await openModelMenu(page);
    await menu.getByRole('menuitem', { name: '刷新模型列表', exact: true }).click();
    for (const name of ['DeepSeek-V4.1-Flash', 'DeepSeek-V4-Pro'])
      await menu.getByRole('menuitemradio', { name, exact: true }).waitFor();
    await menu.getByRole('menuitem', { name: '刷新模型列表', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await checkInterviewBilling('DeepSeek API', '剩余 28.50 CNY', 'VoxCue-1.3.0-API-billing');
    await openSettings();
    await active.getByRole('button', { name: '禁用', exact: true }).waitFor();
    await settings.locator('#api-settings-deepseek').getByRole('button', { name: /更换.*密钥/ }).waitFor();
  }
  const configuredServices = [
    ['OpenAI API', '已配置', '启用'],
    ['Gemini API', '已配置', '启用'],
    ['DeepSeek', '当前使用中', '禁用'],
    ['Kimi', '已配置', '启用'],
  ];
  assert.deepEqual(await settings.locator('.api-service-disclosure strong').allTextContents(),
    configuredServices.map(([name]) => name), 'All four configured API services keep their expected order');
  for (const [name, status, action] of configuredServices) {
    const row = settings.getByRole('group', { name, exact: true });
    assert.equal(await row.getByRole('button', { name: /^移除密钥/ }).count(), 1, name + ' has a saved key');
    assert.equal(await row.locator('.api-service-disclosure .settings-hint').textContent(), status, name + ' configuration status');
    assert.ok(await row.getByRole('button', { name: action, exact: true }).isEnabled(), name + ' connection action is available');
  }
  await openai.getByRole('button', { name: '启用', exact: true }).click();
  await openai.getByRole('button', { name: '禁用', exact: true }).waitFor();
  await expectDetails(openai, 'openai', true);
  if (check) {
    await openai.getByRole('button', { name: '更换密钥', exact: true }).click();
    const replace = page.getByRole('dialog', { name: '更换 API 密钥', exact: true });
    const field = replace.getByLabel('OpenAI API 密钥', { exact: true }).and(replace.locator('input'));
    await field.waitFor();
    assert.ok(await field.evaluate(input => input.validity.valueMissing && !input.placeholder));
    await replace.getByRole('button', { name: '取消', exact: true }).click();
    await replace.waitFor({ state: 'hidden' });
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    const openaiMenu = await openModelMenu(page);
    await openaiMenu.getByRole('menuitemradio', { name: /6\.2.*sol/i }).waitFor();
    await page.keyboard.press('Escape');
    await checkInterviewBilling('OpenAI API', 'API计费');
    if (!checkOnly) {
      await openSettings();
      await expectDetails(openai, 'openai', true);
    }
  }
  if (checkOnly) {
    await checkProviderLogos();
    await checkNavigationLifetime();
    console.log('API settings interaction checks passed.');
  } else {
    await openai.evaluate(row => row.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await (await app.browserWindow(page)).evaluate(win => win.setTitle('VoxCue · API 密钥模拟预览'));
    console.log(
      `API_PREVIEW_READY — ${configuredServices.length} 家已配置，${await openai.getAttribute('aria-label')} 已启用并展开。余额和回复均为模拟数据。可使用 demo-key 试填。关闭主窗口后自动清理。`,
    );
    await page.waitForEvent('close', { timeout: 0 });
  }
}
let previewFailure;
try {
  await runPreview();
} catch (error) {
  previewFailure = error;
  console.error('API preview failed before teardown' + (rendererOwnerLifetimes ? ' at ' + ownerStageName : '') + ':', error);
  throw error;
} finally {
  ownerStage('electron:teardown');
  try {
    try { await recoveryBrowser?.close(); } finally { await closeUiApp(app); }
    ownerStage('electron:closed');
  } catch (error) {
    if (!previewFailure) throw error;
    console.error('API preview teardown also failed:', error);
  }
}
