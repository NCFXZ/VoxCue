import { probe } from './window-probe.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { realpathSync, lstatSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { installUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';

assert.equal(process.platform, 'win32');
assert.equal(probe('desktop').interactive, true, 'Native mouse checks require an unlocked desktop');
const testPackage = process.argv
  .find((arg) => arg.startsWith('--test-package='))
  ?.slice('--test-package='.length);
let executablePath;
if (process.argv.includes('--installer-stage')) {
  assert.equal(testPackage, undefined);
  const stage = path.resolve('release/installer-stage/VoxCue-win32-x64');
  assert.equal(realpathSync(stage), stage);
  executablePath = path.join(stage, 'VoxCue.exe');
}
if (testPackage) {
  const packageRoot = path.resolve(testPackage),
    parent = path.dirname(path.dirname(packageRoot));
  assert.equal(path.dirname(parent), realpathSync(os.tmpdir()));
  assert.ok(path.basename(parent).startsWith('voxcue-test-run-'));
  assert.ok(path.basename(path.dirname(packageRoot)).startsWith('platform-layout-'));
  assert.equal(path.basename(packageRoot), 'VoxCue-win32-x64');
  assert.equal(lstatSync(parent).isSymbolicLink(), false);
  assert.equal(realpathSync(parent), parent);
  const owner = JSON.parse(readFileSync(path.join(parent, '.voxcue-test-owner.json'), 'utf8'));
  assert.equal(owner.kind, 'voxcue-test-run-');
  assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
  process.kill(owner.pid, 0);
  executablePath = path.join(packageRoot, 'VoxCue.exe');
}
async function until(read, accept, label) {
  const end = performance.now() + 10000;
  let last;
  do {
    last = await read();
    if (accept(last)) return last;
    await new Promise((r) => setTimeout(r, 70));
  } while (performance.now() < end);
  throw Error(label + ': ' + JSON.stringify(last));
}
const profile = path.join(testRoot, 'profile');
await mkdir(profile);
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: executablePath ? [] : ['.'],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
const cursor = probe('cursor');
const icon = path.resolve('public/voxcue.ico');
let floating,
  closedByControl = false;
try {
  await installUiAccount(app, { speech: true, components: true });
  const login = await app.firstWindow();
  const [main] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  await main.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  const title = 'VoxCueNative' + process.pid;
  const mainHandle = await app.evaluate(({ BrowserWindow }, title) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setTitle(title);
    win.setAppDetails({ appId: 'com.voxcue.native.' + title, relaunchDisplayName: title });
    return win.getNativeWindowHandle().readBigUInt64LE().toString();
  }, title);
  const initial = probe('window', mainHandle, icon);
  assert.equal(initial.backdropResult, 0);
  assert.equal(initial.backdrop, 3);
  assert.ok(initial.iconHash);
  assert.equal(initial.iconHash, initial.sourceIconHash);
  await until(
    () => probe('taskbar', title),
    (v) => v.matches > 0,
    'Main taskbar entry missing',
  );
  const clickControl = async (label) => {
    await app.evaluate(({ BrowserWindow }, title) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === title);
      win.show();
      win.moveTop();
      win.focus();
    }, title);
    await main.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    if (!probe('window', mainHandle, icon).foreground) {
      const input = await main
        .getByRole('textbox', { name: '聊天消息', exact: true })
        .boundingBox();
      assert.ok(input);
      const activate = await app.evaluate(
        ({ BrowserWindow, screen }, box) => {
          const bounds = BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === box.title)
            .getContentBounds();
          return screen.dipToScreenPoint({
            x: Math.round(bounds.x + box.x + box.width / 2),
            y: Math.round(bounds.y + box.y + box.height / 2),
          });
        },
        { ...input, title },
      );
      probe('click', mainHandle, activate.x, activate.y);
      await until(
        () => probe('window', mainHandle, icon),
        (value) => value.foreground,
        'Synthetic main window did not activate',
      );
    }
    const box = await main.getByRole('button', { name: label, exact: true }).boundingBox();
    assert.ok(box);
    const point = await app.evaluate(
      ({ BrowserWindow, screen }, box) => {
        const bounds = BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === box.title)
          .getContentBounds();
        return screen.dipToScreenPoint({
          x: Math.round(bounds.x + box.x + box.width / 2),
          y: Math.round(bounds.y + box.y + box.height / 2),
        });
      },
      { ...box, title },
    );
    // Windows can refuse programmatic foreground activation. A real click
    // activates the intended test window; require native hit ownership first.
    await until(
      () => probe('hit', mainHandle, point.x, point.y),
      (value) => value.expected,
      'Window controls are occluded',
    );
    probe('click', mainHandle, point.x, point.y);
  };
  await main.evaluate(() => {
    globalThis.windowControlClicks = [];
    document.addEventListener('click', (event) => {
      const label = event.target.closest('.window-controls button')?.getAttribute('aria-label');
      if (label) globalThis.windowControlClicks.push(label);
    });
  });
  await app.evaluate(({ ipcMain }) => {
    globalThis.controlIpc = [];
    ipcMain.on('window:action', (event, ...args) =>
      globalThis.controlIpc.push({ args, mainFrame: event.senderFrame === event.sender.mainFrame }),
    );
  });
  await clickControl('最小化');
  await until(
    () =>
      app.evaluate(
        ({ BrowserWindow }, title) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === title)
            .isMinimized(),
        title,
      ),
    (v) => v,
    'Native minimize button failed',
  );
  await app.evaluate(({ BrowserWindow }, title) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === title);
    win.restore();
    win.focus();
  }, title);
  await clickControl('最大化或还原');
  await until(
    () =>
      app.evaluate(
        ({ BrowserWindow }, title) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === title)
            .isMaximized(),
        title,
      ),
    (v) => v,
    'Native maximize button failed',
  );
  await clickControl('最大化或还原');
  await until(
    () =>
      app.evaluate(
        ({ BrowserWindow }, title) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === title)
            .isMaximized(),
        title,
      ),
    (v) => !v,
    'Native restore button failed',
  );
  for (const theme of ['light', 'dark', 'system']) {
    await main.evaluate((theme) => window.desktop.setNativeTheme(theme), theme);
    assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), theme);
    assert.equal(probe('window', mainHandle, icon).backdrop, 3);
    const expectedDark = await app.evaluate(({ nativeTheme }) =>
      Number(nativeTheme.shouldUseDarkColors),
    );
    await until(
      () => probe('window', mainHandle, icon),
      (value) => value.darkResult === 0 && value.dark === expectedDark,
      'Native HWND theme failed to follow application theme',
    );
  }
  assert.equal(
    (await main.evaluate(() => window.desktop.screenCapturePermission('check'))).status,
    'not-required',
  );
  await assert.rejects(
    main.evaluate(() => window.desktop.screenCapturePermission('request')),
    /无需单独申请/,
  );
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const sender = BrowserWindow.getAllWindows()[0].webContents,
      event = { sender, senderFrame: sender.mainFrame };
    const theme = ipcMain._invokeHandlers.get('appearance:theme');
    for (const args of [[], ['dark', 1], [{}], ['invalid']]) {
      let denied = false;
      try {
        theme(event, ...args);
      } catch {
        denied = true;
      }
      if (!denied) throw Error('Invalid theme accepted');
    }
    for (const channel of ['appearance:theme', 'interview:screen-permission']) {
      let denied = false;
      try {
        ipcMain._invokeHandlers.get(channel)({ ...event, senderFrame: {} }, 'check');
      } catch {
        denied = true;
      }
      if (!denied) throw Error('Subframe accepted');
    }
  });
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  [floating] = await Promise.all([
    app.waitForEvent('window'),
    main
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  await floating.locator('.floating-composer textarea').waitFor();
  const floatingHandle = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#interview'))
      .getNativeWindowHandle()
      .readBigUInt64LE()
      .toString(),
  );
  assert.equal(probe('window', mainHandle, icon).visible, false);
  await until(
    () => probe('taskbar', title),
    (v) => v.matches === 0,
    'Main taskbar remained visible',
  );
  assert.ok(probe('window', floatingHandle, icon).extendedStyle & 8);
  for (const value of [0, 50, 100]) {
    await floating.evaluate((value) => {
      localStorage.setItem('voxcue-frosted-transparency-v2', JSON.stringify(value));
      window.dispatchEvent(new StorageEvent('storage', { key: 'voxcue-frosted-transparency-v2' }));
    }, value);
    await main.waitForFunction(
      (value) => document.documentElement.dataset.frostedTransparency === String(value),
      value,
    );
    const surface = await floating.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        panel: Number(style.getPropertyValue('--frosted-panel-light')),
        reading: Number(style.getPropertyValue('--frosted-reading-light')),
        shadow: getComputedStyle(document.querySelector('.floating-composer textarea')).textShadow,
      };
    });
    assert.ok(surface.reading >= surface.panel);
    assert.equal(surface.shadow, 'none');
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#interview'))
          .getOpacity(),
      ),
      1,
    );
  }
  await floating.emulateMedia({ forcedColors: 'active' });
  await floating.waitForFunction(
    () => getComputedStyle(document.querySelector('.floating-panel')).backdropFilter === 'none',
  );
  await floating.emulateMedia({ forcedColors: 'none' });
  const [behind] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(async ({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('#interview'),
      );
      const win = new BrowserWindow({
        ...current.getBounds(),
        show: true,
        frame: false,
        skipTaskbar: true,
        webPreferences: { sandbox: true, contextIsolation: true },
      });
      await win.loadURL(
        'data:text/html,' +
          encodeURIComponent(
            '<body style="margin:0;background:rgb(40,80,100);width:100vw;height:100vh"><script>window.clicks=0;document.addEventListener("click",()=>window.clicks++)</script>',
          ),
      );
      globalThis.nativeBehind = win;
    }),
  ]);
  const behindHandle = await app.evaluate(() =>
    globalThis.nativeBehind.getNativeWindowHandle().readBigUInt64LE().toString(),
  );
  const toScreen = (point) =>
    app.evaluate(({ screen, BrowserWindow }, point) => {
      const bounds = BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#interview'))
        .getContentBounds();
      return screen.dipToScreenPoint({
        x: Math.round(bounds.x + point.x),
        y: Math.round(bounds.y + point.y),
      });
    }, point);
  const gap = await toScreen(
    await floating.evaluate(() => {
      const [a, b] = [...document.querySelectorAll('.floating-panel')].map((e) =>
        e.getBoundingClientRect(),
      );
      return { x: (a.right + b.left) / 2, y: a.top + a.height / 2 };
    }),
  );
  probe('move', gap.x, gap.y);
  await until(
    () => probe('window', floatingHandle, icon),
    (v) => !!(v.extendedStyle & 32),
    'Blank area did not pass native clicks',
  );
  probe('click', behindHandle, gap.x, gap.y);
  await behind.waitForFunction(() => window.clicks === 1);
  const box = await floating.locator('.floating-composer textarea').boundingBox(),
    input = await toScreen({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await floating.evaluate(() => {
    globalThis.nativeMoves = [];
    window.addEventListener(
      'mousemove',
      (e) => {
        globalThis.nativeMoves.push({
          x: e.clientX,
          y: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
        });
        if (globalThis.nativeMoves.length > 6) globalThis.nativeMoves.shift();
      },
      true,
    );
  });
  probe('move', input.x, input.y);
  await until(
    () => probe('window', floatingHandle, icon),
    (v) => !(v.extendedStyle & 32),
    'Input remained click-through',
  ).catch(async (error) => {
    console.error(
      JSON.stringify({
        input,
        box,
        cursor: probe('cursor'),
        moves: await floating.evaluate(() => globalThis.nativeMoves),
      }),
    );
    throw error;
  });
  await floating.locator('.floating-composer textarea').evaluate((element) => {
    const box = element.getBoundingClientRect();
    window.dispatchEvent(
      new MouseEvent('mouseout', {
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
        relatedTarget: null,
      }),
    );
  });
  assert.equal(
    probe('window', floatingHandle, icon).extendedStyle & 32,
    0,
    'A queued leave at an interactive point must not re-enable passthrough',
  );
  probe('click', floatingHandle, input.x, input.y);
  await floating.waitForFunction(
    () => document.activeElement === document.querySelector('.floating-composer textarea'),
  );
  probe('down', floatingHandle, input.x, input.y);
  probe('move', gap.x, gap.y);
  assert.equal(probe('window', floatingHandle, icon).extendedStyle & 32, 0);
  probe('up');
  probe('move', gap.x + 1, gap.y);
  await until(
    () => probe('window', floatingHandle, icon),
    (v) => !!(v.extendedStyle & 32),
    'Release failed to restore hit testing',
  );
  await app.evaluate(() => globalThis.nativeBehind.destroy());
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('#interview'),
    );
    win.minimize();
    win.restore();
    win.setAlwaysOnTop(false);
  });
  assert.ok(probe('window', floatingHandle, icon).extendedStyle & 8);
  const closed = floating.waitForEvent('close');
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
  await closed;
  floating = undefined;
  await until(
    () => probe('window', mainHandle, icon),
    (v) => v.visible,
    'Main failed to restore',
  );
  await until(
    () => probe('taskbar', title),
    (v) => v.matches > 0,
    'Taskbar entry failed to restore',
  );
  assert.equal(probe('window', mainHandle, icon).iconHash, initial.iconHash);
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  [floating] = await Promise.all([
    app.waitForEvent('window'),
    main
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  await floating.locator('.floating-composer textarea').waitFor();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    dialog.showErrorBox = () => {};
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#interview'))
      .webContents.forcefullyCrashRenderer();
  });
  await until(
    () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#interview')),
      ),
    (value) => !value,
    'Crashed Renderer left interview window alive',
  );
  floating = undefined;
  await until(
    () => probe('window', mainHandle, icon),
    (value) => value.visible,
    'Renderer crash left main hidden',
  );
  await until(
    () => probe('taskbar', title),
    (value) => value.matches > 0,
    'Renderer crash left taskbar entry hidden',
  );
  assert.equal(probe('window', mainHandle, icon).iconHash, initial.iconHash);
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox.bind(dialog);
    dialog.showMessageBox = (...args) =>
      args.at(-1)?.title === '关闭 VoxCue'
        ? Promise.resolve({ response: 1, checkboxChecked: false })
        : original(...args);
  });
  const appClosed = app.waitForEvent('close', { timeout: 15000 });
  await clickControl('关闭窗口');
  await appClosed;
  closedByControl = true;
  console.log(
    JSON.stringify({
      status: 'passed',
      realWindowControls: ['minimize', 'maximize', 'restore', 'close'],
      realWin32Input: true,
      rendererCrashRecovery: true,
      nativeTaskbar: true,
      acrylic: true,
      icoMatchesSource: true,
      topmost: true,
      selectionLock: true,
      forcedColorsFallback: true,
      wholeWindowOpacity: 1,
      screenPermission: 'not-required',
      packaged: !!executablePath,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      await app
        .evaluate(() => ({
          systemVersion: process.getSystemVersion(),
          release: process.getBuiltinModule('os').release(),
        }))
        .catch(() => ({ closed: true })),
    ),
  );
  console.error(
    JSON.stringify(
      await app.evaluate(() => ({ ipc: globalThis.controlIpc })).catch(() => ({ closed: true })),
    ),
  );
  for (const main of app.windows().filter((w) => !w.isClosed()))
    console.error(
      JSON.stringify(
        await main.evaluate(() => ({
          url: location.hash,
          clicks: globalThis.windowControlClicks,
          controls: [
            ...document.querySelectorAll('.window-controls,.titlebar,.window-controls button'),
          ].map((e) => ({
            tag: e.tagName,
            region: getComputedStyle(e).webkitAppRegion,
            rect: e.getBoundingClientRect().toJSON(),
          })),
        })),
      ),
    );
  if (floating && !floating.isClosed())
    console.error(
      JSON.stringify(
        await floating.evaluate(() => ({
          classes: document.documentElement.className,
          capabilities: window.desktop.presentation,
          forced: matchMedia('(forced-colors: active)').matches,
          contrast: matchMedia('(prefers-contrast: more)').matches,
          panel: getComputedStyle(document.querySelector('.floating-panel')).backdropFilter,
        })),
      ),
    );
  throw error;
} finally {
  probe('up');
  probe('move', cursor.x, cursor.y);
  if (!closedByControl)
    await app.evaluate(() => globalThis.nativeBehind?.destroy()).catch(() => {});
  if (floating && !floating.isClosed())
    await app
      .evaluate(({ BrowserWindow, dialog }) => {
        dialog.showErrorBox = () => {};
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#interview'))
          ?.destroy();
      })
      .catch(() => {});
  if (!closedByControl) await closeUiApp(app);
}
