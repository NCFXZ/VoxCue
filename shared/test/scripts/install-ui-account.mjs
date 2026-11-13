import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import workspace from '../../scripts/workspace.mjs';
import { testRoot } from './test-workspace.mjs';
export async function focusUiWindow(app, page) {
  if (process.platform === 'win32') {
    const { focusOwnedWindow } = await import(
      pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/window-probe.mjs')).href
    );
    return focusOwnedWindow(app, page, workspace.platformRequire('electron'));
  }
  if (process.platform !== 'darwin') return;
  const host = await app.evaluate(({ app }) => ({
    executable: app.getPath('exe'),
    profile: app.getPath('userData'),
    pid: process.pid,
  }));
  const allowed = [
    workspace.platformRequire('electron'),
    path.join(workspace.platformRoot, '.tools/electron-dev/Electron.app/Contents/MacOS/Electron'),
  ];
  if (
    !allowed.includes(host.executable) ||
    !host.profile.startsWith(testRoot + path.sep) ||
    host.pid !== app.process().pid
  )
    throw Error('Native focus requires this run’s verified development host and profile');
  const id = await (await app.browserWindow(page)).evaluate((window) => window.id);
  const deadline = Date.now() + 4000;
  let focused = false;
  while (!focused && Date.now() < deadline) {
    // Launch Services activation is asynchronous. Raise the exact target after
    // requesting activation, and allow another attempt if macOS changed focus.
    if (!(await app.evaluate(({ app }) => app.isActive()))) {
      execFileSync('/usr/bin/open', ['-a', path.resolve(host.executable, '../../..')], {
        stdio: 'pipe',
        timeout: 3000,
      });
    }
    await page.bringToFront();
    focused = await app.evaluate(async ({ app, BrowserWindow }, id) => {
      const window = BrowserWindow.fromId(id);
      if (!window || window.isDestroyed()) throw Error('Owned Mac focus window closed');
      if (window.isVisible() && !window.isMinimized() && window.isFocusable()) {
        app.focus({ steal: true });
        window.moveTop();
        window.focus();
      }
      const until = Date.now() + 500;
      do {
        if (app.isActive() && window.isVisible() && BrowserWindow.getFocusedWindow()?.id === id)
          return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } while (Date.now() < until);
      return false;
    }, id);
  }
  if (!focused) {
    const state = await app.evaluate(
      ({ app, BrowserWindow }, id) => ({
        targetId: id,
        active: app.isActive(),
        focusedId: BrowserWindow.getFocusedWindow()?.id,
        dockVisible: app.dock?.isVisible(),
        windows: BrowserWindow.getAllWindows().map((value) => ({
          id: value.id,
          visible: value.isVisible(),
          minimized: value.isMinimized(),
          focusable: value.isFocusable(),
          focused: value.isFocused(),
        })),
      }),
      id,
    );
    throw Error('Owned Mac app/key window did not acquire native focus: ' + JSON.stringify(state));
  }
  await page.waitForFunction(() => document.hasFocus());
}
export async function openReasoningControl(
  page,
  triggerLabel = '聊天模型',
  effortLabel = '思考强度',
) {
  const popup = page.getByRole('dialog', { name: effortLabel, exact: true });
  if (await popup.isVisible()) {
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: triggerLabel, exact: true }).click();
  await popup.waitFor();
  return popup;
}
export async function openModelMenu(page, triggerLabel = '聊天模型', effortLabel = '思考强度') {
  const triggerId = await page
    .getByRole('button', { name: triggerLabel, exact: true, includeHidden: true })
    .getAttribute('id');
  const popup = await openReasoningControl(page, triggerLabel, effortLabel);
  const owner = {
    triggerId,
    popupId: await popup.getAttribute('id'),
  };
  try {
    // The first click after a reload opens the model list while the provider
    // session is restored. With a resolved session the popup opens on effort.
    const chooseModel = popup.getByRole('button', { name: '选择模型', exact: true });
    if (await chooseModel.count()) await chooseModel.click();
    await popup.getByRole('menu', { name: '选择模型', exact: true })
      .getByRole('menuitemradio').first().waitFor();
  } catch (error) {
    const diagnostic = await page
      .evaluate(async ({ triggerId, popupId }) => {
        const trigger = triggerId ? document.getElementById(triggerId) : null;
        const controlledId = trigger?.getAttribute('aria-controls');
        const describe = (node) =>
          node
            ? {
                role: node.getAttribute('role'),
                label: node.getAttribute('aria-label'),
                panel: node.querySelector('.reasoning-popup-view')?.getAttribute('data-panel'),
                visible: node.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
                hidden: node.getAttribute('aria-hidden'),
                inert: node.inert || !!node.closest('[inert]'),
                menuItems: node.querySelectorAll('[role="menuitemradio"]').length,
              }
            : null;
        const state = {
          triggerId,
          popupId,
          controlledId,
          sameOwner: !!controlledId && controlledId === popupId,
          expanded: trigger?.getAttribute('aria-expanded'),
          nativeDialogOpen: trigger?.closest('dialog')?.open,
          owned: describe(controlledId ? document.getElementById(controlledId) : null),
          original: describe(popupId ? document.getElementById(popupId) : null),
        };
        let timer;
        try {
          const models = await Promise.race([
            (location.hash === '#interview'
              ? window.desktop.interviewModels()
              : window.desktop.chatModels(false)
            )
              .then((result) => ({
                modelsOk: result.ok,
                configuredModels: result.ok ? result.models.length : null,
              }))
              .catch(() => ({ modelsOk: false, configuredModels: null })),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve({ modelsLookupTimedOut: true }), 1000);
            }),
          ]);
          return { ...state, ...models };
        } finally {
          clearTimeout(timer);
        }
      }, owner)
      .catch(() => ({ unavailable: true, ...owner }));
    console.error('OWNED_MODEL_MENU_DIAGNOSTIC', diagnostic);
    throw error;
  }
  return popup;
}
export async function enterDemoUiAccount(app, login) {
  await app.evaluate(() => globalThis.primaryAccountFixture.login());
  return login.evaluate(() => window.desktop.enterDemo());
}
export async function waitForRestoredMainWindow(app) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    // The offline main opens index.html without a fragment. The hidden Mac
    // language bootstrap opens index.html#login and closes during restoration.
    const main = app.windows().find((page) => !page.isClosed() && page.url().endsWith('/index.html'));
    if (main) {
      await main.getByRole('button', { name: '用户菜单', exact: true })
        .waitFor({ timeout: Math.max(1, deadline - Date.now()) });
      return main;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error('Primary account did not restore its main window');
}
export async function enterPrimaryUiAccount(app, login) {
  await app.evaluate(
    ({ app }, fixture) => {
      if (!globalThis.primaryAccountFixture) {
        const require = process
          .getBuiltinModule('module')
          .createRequire(app.getAppPath() + '/package.json');
        require(fixture)(app.getAppPath());
      }
      // This explicit login path starts with only the owned synthetic marker cleared.
      globalThis.primaryAccountFixture.logout();
    },
    fileURLToPath(new URL('../fixtures/install-primary-account.cjs', import.meta.url)),
  );
  // The offline account port must be installed before refreshing configured state.
  await login.reload();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await login.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.type === 'submit' && button.textContent === '登录' && !button.disabled,
    ),
  );
  const opened = app.waitForEvent('window');
  await login.getByLabel('邮箱', { exact: true }).fill('synthetic@example.test');
  await login.getByLabel('密码', { exact: true }).fill('Synthetic UI passphrase 2026!');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  const main = await opened;
  await main.waitForLoadState('domcontentloaded');
  await main.getByRole('button', { name: '用户菜单', exact: true }).waitFor();
  return main;
}
export async function connectUiAccount(app, login, service = 'chatgpt') {
  await login.waitForLoadState('domcontentloaded');
  const main = login.url().endsWith('#login') ? await enterPrimaryUiAccount(app, login) : login;
  // Exercise the same explicit provider selection as a user. This updates the
  // renderer that owns the test without requiring a probe on the next reload.
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
  const row = settings.locator('.ai-service-row').filter({
    hasText: service === 'copilot' ? 'GitHub Copilot' : 'ChatGPT',
  });
  const connected = row.getByRole('button', { name: '断开连接', exact: true });
  await row.waitFor();
  if (!(await connected.isVisible()))
    await row.getByRole('button', { name: '连接', exact: true }).click();
  await connected.waitFor();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  return main;
}
// Called only by Playwright in an isolated test process. No real OAuth/AI/audio.
export async function closeUiApp(app) {
  try {
    if (app.process().exitCode !== null || app.process().signalCode !== null) return;
  } catch {
    // Playwright releases its process dispatcher after an expected native close.
    return;
  }
  let closed = false;
  await app
    .evaluate(
      ({ app, dialog }, owner) => {
        const path = process.getBuiltinModule('path');
        const fs = process.getBuiltinModule('fs');
        // A child can have an isolated TMPDIR below the owning run. Verify the run
        // marker and exact owner instead of treating the child's TMPDIR as its parent.
        const root = fs.realpathSync(owner.root);
        const marker = JSON.parse(
          fs.readFileSync(path.join(root, '.voxcue-test-owner.json'), 'utf8'),
        );
        const profile = path.resolve(app.getPath('userData'));
        const relative = path.relative(root, profile);
        if (
          !path.basename(root).startsWith('voxcue-test-run-') ||
          marker.kind !== 'voxcue-test-run-' ||
          marker.pid !== owner.pid ||
          !relative ||
          relative.startsWith('..') ||
          path.isAbsolute(relative)
        )
          throw Error('UI teardown requires isolated temporary userData');
        const original = dialog.showMessageBox.bind(dialog);
        dialog.showMessageBox = (...args) =>
          ['关闭 VoxCue', 'Close VoxCue'].includes(args.at(-1)?.title)
            ? Promise.resolve({ response: 1, checkboxChecked: false })
            : original(...args);
      },
      { root: testRoot, pid: process.pid },
    )
    .catch((error) => {
      if (/Target page, context or browser has been closed/.test(error.message)) closed = true;
      else throw error;
    });
  if (closed) return;
  if (process.platform === 'darwin') {
    // macOS intentionally remains in the Dock after its last window closes.
    // Finish the normal save/close handshake before asking Playwright to quit.
    const closed = app.windows().map((window) => window.waitForEvent('close', { timeout: 20000 }));
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.close();
    });
    await Promise.all(closed);
  }
  let timer;
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          app.process().kill();
          reject(Error('Isolated Electron teardown timed out; test process terminated.'));
        }, 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function installUiAccount(app, { speech = false, components = false } = {}) {
  // Wait for main's synchronous module registration before replacing test ports.
  // Inspector evaluation during a CommonJS load can observe partial exports.
  await (await app.firstWindow()).waitForLoadState('domcontentloaded');
  const speechPorts = {
    win32: 'test/fixtures/install-speech-port.cjs',
    darwin: 'test/fixtures/install-speech-port.cjs',
  };
  if (speech && !speechPorts[process.platform])
    throw Error('No native speech fixture for this platform');
  const speechFixture = speech ? path.resolve(speechPorts[process.platform]) : undefined;
  await app.evaluate(
    ({ app }, { speech, speechFixture, components }) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const path = require('node:path');
      const root = app.getAppPath();
      if (components) {
        // These UI regressions exercise controls with synthetic model availability.
        // Download/cache regressions keep the real component service by default.
        const { ComponentService } = require(
          path.join(root, 'dist-electron/shared/electron/backend/components/service.js'),
        );
        const original = ComponentService.prototype.state;
        ComponentService.prototype.state = function () {
          const state = original.call(this);
          return {
            ...state,
            phase: 'ready',
            error: null,
            items: state.items.map((item) => ({ ...item, phase: 'ready', received: item.bytes })),
          };
        };
        ComponentService.prototype.status = async function () {
          return this.state();
        };
        ComponentService.prototype.ready = () => true;
      }
      const { ChatGPTAuthService } = require(
        path.join(root, 'dist-electron/shared/electron/backend/auth/service.js'),
      );
      const { ChatGPTService } = require(
        path.join(root, 'dist-electron/shared/electron/backend/chat/service.js'),
      );
      const session = () =>
        globalThis.uiAccountActive
          ? {
              mode: 'chatgpt',
              user: { id: 'synthetic-account', name: 'Test', email: '' },
              expiresAt: Date.now() + 3600000,
            }
          : null;
      ChatGPTAuthService.prototype.session = async () => session();
      ChatGPTAuthService.prototype.usageIdentity = async () => ({
        account: 'synthetic-account',
        email: 'synthetic@example.test',
      });
      ChatGPTAuthService.prototype.signIn = async () => {
        globalThis.uiAccountActive = true;
        return session();
      };
      ChatGPTAuthService.prototype.signOut = async () => {
        globalThis.uiAccountActive = false;
        return { warning: null };
      };
      const { CodexUsageRuntime } = require(
        path.join(root, 'dist-electron/shared/electron/backend/chat/codexUsage.js'),
      );
      CodexUsageRuntime.prototype.account = async () => ({
        email: 'synthetic@example.test',
        planType: 'unknown',
      });
      CodexUsageRuntime.prototype.limits = async () => ({});
      ChatGPTService.prototype.models = async () => [
        {
          id: 'test-model',
          label: 'Test Model',
          description: '',
          provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
          reasoningEfforts: ['low', 'high'],
        },
      ];
      ChatGPTService.prototype.usage = async () => ({
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        updatedAt: null,
      });
      ChatGPTService.prototype.stream = async (request, emit) => {
        emit({ id: request.id, type: 'delta', text: 'Synthetic interview answer' });
        return { answerText: 'Synthetic interview answer', usage: null, sources: [] };
      };
      if (speech) {
        const { SpeechHardwareProbe } = require(
          path.join(root, 'dist-electron/shared/electron/backend/speech/hardware.js'),
        );
        // Shared UI scenarios use a deterministic platform capability. Actual
        // driver probing is verified separately by the native Windows suite.
        SpeechHardwareProbe.prototype.read = async () => ({
          cuda: process.platform === 'win32',
          metal: process.platform === 'darwin',
          qwenCpu: true,
        });
        SpeechHardwareProbe.prototype.cpu = async () => ({ qwenCpu: true });
        if (components)
          require(
            path.join(root, 'dist-electron/shared/electron/backend/speech/models.js'),
          ).speechModelInstalled = () => true;
        require(speechFixture)(root);
        const { SpeechHost } = require(
          path.join(root, 'dist-electron/shared/electron/backend/speech/host.js'),
        );
        const call = SpeechHost.prototype.call;
        const stop = SpeechHost.prototype.stop;
        const clearClock = (host) => {
          clearTimeout(host.syntheticFinal);
          clearInterval(host.syntheticProgress);
        };
        // Both native fixtures retain their platform access checks. Drive the
        // common synthetic audio timeline here, including processed silence.
        SpeechHost.prototype.call = async function (request) {
          if (request.op === 'devices' || request.op === 'status') return call.call(this, request);
          clearClock(this);
          const result = await call.call(this, { op: 'status' });
          if (request.op === 'start' && request.options.sources.includes('system')) {
            this.syntheticFinal = setTimeout(() => {
              const at = Date.now();
              this.emit({ type: 'audio-progress', source: 'system', pending: true });
              this.emit({
                type: 'segment',
                segment: {
                  id: 'synthetic-system',
                  source: 'system',
                  text: 'Synthetic interviewer question',
                  final: true,
                  startMs: at - 1800,
                  endMs: at,
                  silenceStartMs: at - 800,
                  reason: 'silence',
                },
              });
              this.emit({
                type: 'audio-progress',
                source: 'system',
                pending: false,
                processedThroughMs: at,
              });
            }, 50);
            this.syntheticProgress = setInterval(
              () =>
                this.emit({
                  type: 'audio-progress',
                  source: 'system',
                  pending: false,
                  processedThroughMs: Date.now(),
                }),
              50,
            );
          }
          return {
            ...result,
            state: request.op === 'start' ? 'running' : request.op === 'pause' ? 'paused' : 'idle',
          };
        };
        SpeechHost.prototype.stop = function () {
          clearClock(this);
          return stop.call(this);
        };
      }
    },
    { speech, speechFixture, components },
  );
}
