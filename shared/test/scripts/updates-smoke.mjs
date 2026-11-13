import { connectUiAccount } from './install-ui-account.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { testRoot, electron } from './test-workspace.mjs';

import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  closeUiApp,
  installUiAccount,
  focusUiWindow,
  waitForRestoredMainWindow,
} from './install-ui-account.mjs';
import { assertDownloadButton, assertInitialDownloadProgress } from './assert-download-button.mjs';
import { assertLoadingIcon } from './assert-loading-icon.mjs';
import { captureRequested } from './capture-requested.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/updates-')));
const fixture = path.join(profile, 'main.cjs');
const executable = process.argv
  .find((arg) => arg.startsWith('--app-executable='))
  ?.slice('--app-executable='.length);
if (process.argv.includes('--packaged-bootstrap') && !executable)
  throw Error('Packaged bootstrap requires an executable from the platform runner');
// Updater transport/installer and model availability are isolated fixtures.
// IPC, window/session lifecycle, React and IndexedDB all run unchanged.
await writeFile(
  fixture,
  `
const {app, dialog} = require('electron');
const {EventEmitter} = require('node:events');
app.setAppPath(${JSON.stringify(process.cwd())});
app.getVersion = () => require(${JSON.stringify(path.resolve('package.json'))}).version;
const driver = new EventEmitter();
driver.behavior = 'latest';
driver.checks = [];
driver.checkForUpdates = async force => {
  driver.checks.push(force === true);
  if (driver.behavior === 'pending') await new Promise(resolve => { driver.finishCheck = resolve; });
  if (driver.behavior === 'error') throw Error('synthetic network failure');
  driver.emit(driver.behavior === 'latest' ? 'update-not-available' : 'update-available', {version:'0.2.0'});
  return null;
};
driver.downloadUpdate = signal => new Promise((resolve, reject) => {
  driver.finishDownload = resolve; driver.failDownload = reject;
  signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), {once:true});
});
driver.quitAndInstall = () => {
  require('node:fs').writeFileSync(require('node:path').join(app.getPath('userData'), 'installed.json'), JSON.stringify({saved:true}));
  app.quit();
};
driver.dispose = async () => {
  // A second quit while cleanup is pending must not bypass the awaited barrier.
  setTimeout(() => app.quit(), 0);
  await new Promise(resolve => setTimeout(resolve, 150));
  require('node:fs').writeFileSync(require('node:path').join(app.getPath('userData'), 'update-cleanup.json'), JSON.stringify({completed:true}));
};
globalThis.updateDriver = driver;
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/updates/driver.js'))}).createUpdateDriver = () => driver;
const components = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/components/service.js'))});
components.ComponentService = class extends components.ComponentService {
  constructor(options) { super({...options, managed:false}); }
};
globalThis.updateConfirmation = 0;
const originalDialog = dialog.showMessageBox.bind(dialog);
dialog.showMessageBox = (...args) => args.at(-1).title === '重启并更新 VoxCue'
  ? Promise.resolve({response:globalThis.updateConfirmation}) : originalDialog(...args);
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
// This regression exercises manual download/retry; automatic mode has its own suite.
await writeFile(
  path.join(profile, 'update-settings.json'),
  JSON.stringify({ schemaVersion: 1, autoDownload: false }),
);
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const launch = async ({ restore = false } = {}) => {
  app = await electron.launch({ args: [fixture], env });
  const entry = restore ? await waitForRestoredMainWindow(app) : await app.firstWindow();
  if (!restore) {
    await entry.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
    assert.equal(
      await entry.evaluate(() =>
        window.desktop.updates({ op: 'install' }).then(
          () => false,
          () => true,
        ),
      ),
      true,
    );
  }
  await installUiAccount(app, { speech: true, components: true });
  const page = await connectUiAccount(app, entry);
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
  return page;
};
const openUpdates = async (page) => {
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '关于与更新', exact: true })
    .click();
  await settings.getByRole('heading', { name: '关于与更新', exact: true }).waitFor();
  await page.waitForFunction(() => !document.documentElement.dataset.viewDirection);
  await settings.evaluate(async (dialog) => {
    await Promise.allSettled(dialog.getAnimations({ subtree: true }).filter((animation) =>
      animation.effect?.getComputedTiming().iterations !== Infinity,
    ).map((animation) => animation.finished));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  return settings;
};
const waitPhase = (page, phase) =>
  waitForAsync(
    page,
    async (phase) => (await window.desktop.updates({ op: 'status' })).phase === phase,
    phase,
  );
const waitForHeldCheck = (before) => app.evaluate(async (_electron, before) => {
  const deadline = Date.now() + 4000;
  while (globalThis.updateDriver.checks.length === before && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  if (globalThis.updateDriver.checks.length !== before + 1)
    throw Error('The five-second hold did not trigger exactly one update check');
}, before);
let feedbackCapture = 0;
const assertFeedbackAlignment = async (settings) => {
  const metrics = await settings.locator('.updates-footer').evaluate((footer) => {
    const first = footer.querySelector('.updates-notes > p');
    const link = footer.querySelector('.updates-feedback');
    const textBox = (element) => {
      const node = [...element.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
      );
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getClientRects()[0];
    };
    return {
      textTop: textBox(first).top,
      linkTop: textBox(link).top,
      overflow: footer.scrollWidth > footer.clientWidth + 1,
    };
  });
  assert.ok(Math.abs(metrics.textTop - metrics.linkTop) < 1, JSON.stringify(metrics));
  assert.equal(metrics.overflow, false);
  await captureRequested(settings, 'updates-feedback-' + ++feedbackCapture);
};
const assertLoadingMotion = async (page, button) => {
  assert.equal(await button.isDisabled(), true);
  const spinner = button.locator('span:has(> svg)');
  if (process.platform === 'darwin') {
    await assertLoadingIcon(page, spinner);
    return 1;
  }
  const initial = await spinner.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      name: style.animationName,
      duration: parseFloat(style.animationDuration),
      transform: style.transform,
    };
  });
  assert.notEqual(initial.name, 'none', 'Busy update icon must have a CSS animation');
  assert.ok(initial.duration > 0, 'Busy update animation must have a positive duration');
  await page.waitForFunction(
    ({ initial }) => {
      const spinner = document.querySelector('.settings-entry button:disabled span:has(> svg)');
      return (
        spinner &&
        getComputedStyle(spinner).transform !== initial &&
        getComputedStyle(spinner).transform !== 'none'
      );
    },
    { initial: initial.transform },
  );
  return initial.duration;
};
try {
  let page = await launch();
  await page
    .getByRole('textbox', { name: '聊天消息', exact: true })
    .fill('更新后需要恢复的合成草稿');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'update.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('synthetic attachment'),
    });
  let settings = await openUpdates(page);
  await settings.getByText('当前已是最新版本。', { exact: true }).waitFor();
  const checkButton = settings.getByRole('button', { name: '检查更新', exact: true });
  // Losing native focus/visibility correctly cancels a product hold. Establish
  // this owned Mac window as AppKit's active app/key window before pointerdown.
  await focusUiWindow(app, page);
  await page.waitForFunction(() => document.visibilityState === 'visible' && document.hasFocus());
  const windowId = await (await app.browserWindow(page)).evaluate((window) => window.id);
  const assertFocusedWindow = async () => {
    if (process.platform !== 'darwin') return;
    const state = await app.evaluate(({ app, BrowserWindow }, id) => ({
      active: app.isActive(),
      focused: BrowserWindow.getFocusedWindow()?.id === id,
      visible: BrowserWindow.fromId(id)?.isVisible(),
    }), windowId);
    assert.deepEqual(state, { active: true, focused: true, visible: true });
  };
  const focusCheckButton = async () => {
    await focusUiWindow(app, page);
    await checkButton.focus();
    await assertFocusedWindow();
  };
  await assertFocusedWindow();
  // Wait for the settings view snapshot to stop intercepting pointer input.
  await checkButton.hover();
  await page.waitForFunction(() => !document.documentElement.dataset.viewDirection);
  const holdBox = await checkButton.evaluate(async (button) => {
    const rect = () => {
      const box = button.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    await new Promise(requestAnimationFrame);
    const before = rect();
    await new Promise(requestAnimationFrame);
    const box = rect();
    if (Object.keys(box).some((key) => Math.abs(box[key] - before[key]) > 1 / 64) ||
        !button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)))
      throw Error('The update hold requires a stable, directly hittable button');
    return box;
  });
  const beforeHold = await app.evaluate(() => globalThis.updateDriver.checks.length);
  await checkButton.evaluate((button) => {
    const events = [];
    const name = (node) => node instanceof Element
      ? `${node.tagName}.${node.className.baseVal ?? node.className} ${node.getAttribute('aria-label') ?? node.textContent?.trim() ?? ''}`.slice(0, 160)
      : node === window ? 'window' : node === document ? 'document' : null;
    const read = () => {
      const rect = button.getBoundingClientRect();
      return {
        at: performance.now(),
        focused: document.hasFocus(),
        visibility: document.visibilityState,
        activeElement: name(document.activeElement),
        connected: button.isConnected,
        disabled: button.disabled,
        hovered: button.matches(':hover'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        centerHit: name(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
        animations: button.getAnimations({ subtree: true }).map((animation) => animation.playState),
      };
    };
    const push = (value) => {
      if (events.length === 96) events.shift();
      events.push(value);
    };
    const listener = (event) => {
      if (!['focus', 'blur', 'visibilitychange'].includes(event.type) &&
          !(event.target instanceof Node && button.contains(event.target)) &&
          !(event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
      push({
        ...read(), type: event.type, trusted: event.isTrusted,
        target: name(event.target), relatedTarget: name(event.relatedTarget),
        x: event.clientX, y: event.clientY, button: event.button, buttons: event.buttons,
      });
    };
    const types = ['pointerdown', 'pointerup', 'pointerleave', 'pointercancel', 'pointerover', 'pointerout', 'focus', 'blur', 'visibilitychange'];
    for (const type of types) window.addEventListener(type, listener, true);
    const unsubscribe = window.desktop.onUpdateEvent((state) => push({
      ...read(), type: 'update-state', phase: state.phase, revision: state.revision,
    }));
    window.updateHoldAudit = {
      sample: (type) => push({ ...read(), type }),
      read: () => ({
        events, current: read(), devicePixelRatio,
        viewport: { width: innerWidth, height: innerHeight },
      }),
      release: () => {
        for (const type of types) window.removeEventListener(type, listener, true);
        unsubscribe();
      },
    };
    window.updateHoldAudit.sample('before-pointer-move');
  });
  await page.mouse.move(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2);
  await assertFocusedWindow();
  await page.mouse.down();
  try {
    await page.waitForTimeout(4700);
    assert.equal(await app.evaluate(() => globalThis.updateDriver.checks.length), beforeHold);
    await waitForHeldCheck(beforeHold);
  } catch (error) {
    const renderer = await page.evaluate(() => window.updateHoldAudit.read()).catch((failure) => ({ unavailable: failure.message }));
    const native = await app.evaluate(({ app, BrowserWindow }, id) => ({
      active: app.isActive(), focusedWindow: BrowserWindow.getFocusedWindow()?.id,
      expectedWindow: id, visible: BrowserWindow.fromId(id)?.isVisible(),
      bounds: BrowserWindow.fromId(id)?.getContentBounds(),
      checks: globalThis.updateDriver.checks,
    }), windowId).catch((failure) => ({ unavailable: failure.message }));
    console.error('Update mouse hold diagnostics: ' + JSON.stringify({ scale: process.env.VOXCUE_TEST_SCALE_FACTOR ?? '1', beforeHold, renderer, native }));
    throw error;
  } finally {
    await page.mouse.up();
    await page.evaluate(() => {
      window.updateHoldAudit.release();
      delete window.updateHoldAudit;
    });
  }
  await settings.getByText('当前已是最新版本。', { exact: true }).waitFor();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.deepEqual(
    await app.evaluate((_electron, before) => globalThis.updateDriver.checks.slice(before), beforeHold),
    [true],
    'A completed long hold bypasses the cache once; release must not issue a normal check',
  );
  await focusCheckButton();
  const beforeKeyboard = await app.evaluate(() => globalThis.updateDriver.checks.length);
  await checkButton.press('Enter');
  await settings.getByText('当前已是最新版本。', { exact: true }).waitFor();
  assert.deepEqual(
    await app.evaluate((_electron, before) => globalThis.updateDriver.checks.slice(before), beforeKeyboard),
    [false],
    'An ordinary keyboard press keeps the normal cached-check operation',
  );
  await focusCheckButton();
  const beforeSpace = await app.evaluate(() => globalThis.updateDriver.checks.length);
  await page.keyboard.down('Space');
  try {
    await page.waitForTimeout(4700);
    assert.equal(await app.evaluate(() => globalThis.updateDriver.checks.length), beforeSpace);
    assert.equal(await checkButton.evaluate((button) => document.activeElement === button), true);
    // A second down while held is a real repeated keydown. It must neither
    // restart the original deadline nor submit another check after it fires.
    await page.keyboard.down('Space');
    await waitForHeldCheck(beforeSpace);
    await settings.getByText('当前已是最新版本。', { exact: true }).waitFor();
    await page.keyboard.down('Space');
  } finally {
    await page.keyboard.up('Space');
  }
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.deepEqual(
    await app.evaluate((_electron, before) => globalThis.updateDriver.checks.slice(before), beforeSpace),
    [true],
    'Repeated Space keydowns retain the original hold and release adds no check',
  );
  await focusCheckButton();
  const beforeBlur = await app.evaluate(() => globalThis.updateDriver.checks.length);
  await page.keyboard.down('Space');
  try {
    await page.keyboard.press('Tab');
    assert.equal(await checkButton.evaluate((button) => document.activeElement === button), false);
    await page.waitForTimeout(5100);
    assert.equal(
      await app.evaluate(() => globalThis.updateDriver.checks.length),
      beforeBlur,
      'Moving keyboard focus cancels the held check for the full five-second interval',
    );
  } finally {
    await page.keyboard.up('Space');
  }
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await app.evaluate(() => globalThis.updateDriver.checks.length),
    beforeBlur,
    'Releasing Space after focus leaves the button must not activate an update check',
  );
  await assertFeedbackAlignment(settings);
  for (const width of [860, 1280]) {
    await (
      await app.browserWindow(page)
    ).evaluate((win, width) => win.setContentSize(width, 800), width);
    await assertFeedbackAlignment(settings);
  }
  await app.evaluate(() => {
    globalThis.updateDriver.behavior = 'pending';
  });
  await settings.getByRole('button', { name: '检查更新', exact: true }).click();
  const checking = settings.getByRole('button', { name: '检查中…', exact: true });
  await checking.waitFor();
  await assertFeedbackAlignment(settings);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await assertLoadingMotion(page, checking);
    await page.screenshot({});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await checking
        .locator('span:has(> svg)')
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
      'Honor the existing system reduced-motion preference',
    );
    assert.equal(
      await checking.isVisible(),
      true,
      'Reduced motion keeps the checking status visible',
    );
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(() => {
    globalThis.updateDriver.behavior = 'latest';
    globalThis.updateDriver.finishCheck();
  });
  await settings.getByRole('button', { name: '检查更新', exact: true }).waitFor();
  assert.equal(
    await settings.locator('button span:has(> svg)').count(),
    0,
    'Completed check removes its spinner',
  );
  await app.evaluate(() => {
    globalThis.updateDriver.behavior = 'error';
  });
  await settings.getByRole('button', { name: '检查更新', exact: true }).click();
  await settings
    .getByRole('alert')
    .getByText('检查更新失败，请检查网络连接或稍后重试。', { exact: true })
    .waitFor();
  await app.evaluate(() => {
    globalThis.updateDriver.behavior = 'available';
  });
  await settings.getByRole('button', { name: '检查更新', exact: true }).click();
  await settings.getByText('发现新版本 0.2.0', { exact: true }).waitFor();
  await assertFeedbackAlignment(settings);
  await assertInitialDownloadProgress(settings.locator('.download-button'), async () => {
    await settings.getByRole('button', { name: '下载更新', exact: true }).click();
    await waitPhase(page, 'downloading');
  });
  await app.evaluate(() => globalThis.updateDriver.emit('download-progress', { percent: 37.8 }));
  await settings.getByText('正在下载更新 37%', { exact: true }).waitFor();
  await assertFeedbackAlignment(settings);
  await assertDownloadButton(
    page,
    settings.getByRole('button', { name: '更新，取消下载', exact: true }),
  );
  await settings.getByRole('button', { name: '更新，取消下载', exact: true }).hover();
  await settings.getByRole('button', { name: '更新，取消下载', exact: true }).click();
  await waitPhase(page, 'available');
  await settings.getByRole('button', { name: '下载更新', exact: true }).click();
  await waitPhase(page, 'downloading');
  await app.evaluate(() =>
    globalThis.updateDriver.failDownload(Error('synthetic checksum failure')),
  );
  await settings
    .getByRole('alert')
    .getByText('更新下载或校验失败，请重试下载。', { exact: true })
    .waitFor();
  await settings.getByRole('button', { name: '下载更新', exact: true }).click();
  await waitPhase(page, 'downloading');
  await app.evaluate(() => {
    globalThis.updateDriver.emit('update-downloaded');
    globalThis.updateDriver.finishDownload();
  });
  await settings.getByRole('button', { name: '重启并更新', exact: true }).waitFor();
  await assertFeedbackAlignment(settings);
  const configuration = {
    mode: 'local',
    options: { sources: ['system'] },
    aiEnabled: true,
    modelId: 'test-model',
    effort: 'auto',
    autoAnswer: true,
  };
  const [interview] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate((configuration) => window.desktop.openInterview(configuration), configuration),
  ]);
  await interview.waitForLoadState();
  await waitForAsync(
    page,
    async () => (await window.desktop.updates({ op: 'status' })).interviewActive,
  );
  assert.equal(
    await settings.getByRole('button', { name: '重启并更新', exact: true }).isDisabled(),
    true,
  );
  assert.match(
    (await page.evaluate(() => window.desktop.updates({ op: 'install' }))).error,
    /面试进行中/,
  );
  assert.equal(
    await interview.evaluate(() =>
      window.desktop.updates({ op: 'install' }).then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  const interviewClosed = interview.waitForEvent('close');
  await interview.evaluate(() => window.desktop.confirmInterviewEnd());
  await interviewClosed;
  await waitForAsync(
    page,
    async () => !(await window.desktop.updates({ op: 'status' })).interviewActive,
  );
  await page.evaluate(() => window.desktop.updateSessionState(true));
  await settings.getByRole('button', { name: '重启并更新', exact: true }).click();
  await waitPhase(page, 'downloaded');
  assert.equal(page.isClosed(), false, 'Default confirmation cancels install');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'state') throw Error('synthetic save failure');
      return put.apply(this, args);
    };
    window.restoreUpdateWrites = () => {
      IDBObjectStore.prototype.put = put;
    };
  });
  await page
    .getByRole('textbox', { name: '聊天消息', exact: true })
    .fill('更新保存失败后恢复的合成草稿');
  await page.getByRole('button', { name: '重试保存聊天', exact: true }).waitFor();
  settings = await openUpdates(page);
  await app.evaluate(() => {
    globalThis.updateConfirmation = 1;
  });
  await settings.getByRole('button', { name: '重启并更新', exact: true }).click();
  await settings
    .getByRole('alert')
    .getByText('更新尚未安装，窗口已保留。请确认聊天已保存后重试。', { exact: true })
    .waitFor();
  assert.equal(page.isClosed(), false);
  await page.evaluate(() => window.restoreUpdateWrites());
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await page.screenshot({ animations: 'disabled' });
  }
  const restarted = app.waitForEvent('close');
  await settings.getByRole('button', { name: '重启并更新', exact: true }).click();
  await restarted;
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'installed.json'), 'utf8')), {
    saved: true,
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'update-cleanup.json'), 'utf8')), {
    completed: true,
  }, 'Repeated quit requests wait for update cleanup to finish');
  page = await launch({ restore: true });
  assert.equal(
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).inputValue(),
    '更新保存失败后恢复的合成草稿',
  );
  await page.locator('.chat-attachment').getByText('update.txt', { exact: false }).waitFor();
  if (process.argv.includes('--packaged-bootstrap')) {
    await closeUiApp(app);
    app = await electron.launch({
      executablePath: path.resolve(executable),
      args: [],
      env,
    });
    await installUiAccount(app);
    await app.evaluate(({ app }) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdates = async () => {
        autoUpdater.emit('update-not-available', { version: app.getVersion() });
        return null;
      };
    });
    const login = await app.firstWindow();
    page = await connectUiAccount(app, login);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
    assert.equal(
      await page.getByRole('textbox', { name: '聊天消息', exact: true }).inputValue(),
      '更新保存失败后恢复的合成草稿',
    );
    await page.locator('.chat-attachment').getByText('update.txt', { exact: false }).waitFor();
    const bytes = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('voxcue-preparation-chats', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const files = await new Promise((resolve, reject) => {
        const request = db.transaction('files').objectStore('files').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return Promise.all(files.map((file) => file.blob.text()));
    });
    assert.deepEqual(bytes, ['synthetic attachment']);
    const version = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).version;
    assert.equal(
      (await page.evaluate(() => window.desktop.updates({ op: 'status' }))).currentVersion,
      version,
    );
  }
  assert.deepEqual(errors, []);
  await console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'mouse/Space five-second holds force once, repeated keydown keeps the deadline, release adds no check, short Enter stays normal and Tab cancels the held timer',
          'checking/download animation advances in light/dark themes, reduced motion respected, completion removes spinner',
          'settings check/download/progress/retry',
          'main-frame authorization',
          'interview blocks install',
          'cancel preserves window',
          'save failure blocks install',
          'successful save before restart',
          'repeated quit waits for asynchronous update cleanup',
          'draft and attachment survive restart',
        ],
        rendererErrors: errors.length,
        packagedBootstrap: process.argv.includes('--packaged-bootstrap'),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, profile }));
} finally {
  if (app) await closeUiApp(app).catch(() => {});
}
