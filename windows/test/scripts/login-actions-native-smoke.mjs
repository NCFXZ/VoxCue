import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { probe, stableTarget } from './window-probe.mjs';

assert.equal(process.platform, 'win32');
const scales = ['1', '1.25', '1.5', '1.75', '2'];
const options = process.argv.slice(2);
const requestedScale = options[0]?.slice('--scale='.length);
assert.ok(
  options.length <= 1 &&
    (!options.length || (options[0].startsWith('--scale=') && scales.includes(requestedScale))),
  'Use no option or --scale=1|1.25|1.5|1.75|2',
);
assert.equal(probe('desktop').interactive, true, 'Native login checks require an unlocked desktop');
const cursor = probe('cursor');
const fixture = path.join(testRoot, 'login-actions.cjs');
await writeFile(
  fixture,
  `
const {app}=require('electron'),path=require('node:path');
const root=process.cwd();app.setAppPath(root);
const base=path.join(root,'dist-electron/shared/electron');
const {CloudAccountClient}=require(path.join(base,'backend/cloud/client.js'));
const state={configured:true,verified:false,user:null};
globalThis.accountCalls=[];
CloudAccountClient.prototype.snapshot=()=>state;
CloudAccountClient.prototype.call=async function(call){
 globalThis.accountCalls.push(call);
 return {ok:true,state,...(call.action==='code'?{challenge:{
  id:'b0000000-0000-4000-8000-000000000001',expiresInSeconds:300,retryAfterSeconds:60
 }}:{})};
};
for(const [module,name] of [['backend/auth/service.js','ChatGPTAuthService'],['backend/copilot/auth.js','CopilotAuthService']])
 require(path.join(base,module))[name].prototype.session=async()=>null;
require(path.join(base,'main.js'));
`,
);
async function until(read, accept, label) {
  const end = performance.now() + 5000;
  let value;
  do {
    value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (performance.now() < end);
  throw Error(label + ': ' + JSON.stringify(value));
}
try {
  for (const scale of requestedScale ? [requestedScale] : scales) {
    let app, page, win, info;
    const scene = { scale, phase: 'launch', target: null, theme: null, requestedSize: null };
    try {
      app = await electron.launch({
        args: [await offlineElectronEntry(fixture)],
        env: {
          ...process.env,
          COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile-' + scale),
          VITE_DEV_SERVER_URL: '',
          VOXCUE_TEST_SCALE_FACTOR: scale,
          ELECTRON_RUN_AS_NODE: undefined,
        },
      });
      page = await app.firstWindow();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
      win = await app.browserWindow(page);
      info = await win.evaluate((window) => {
        window.show();
        window.setAlwaysOnTop(true, 'normal');
        window.moveTop();
        window.focus();
        return {
          id: window.id,
          pid: process.pid,
          handle: window.getNativeWindowHandle().readBigUInt64LE().toString(),
        };
      });
      const pointAt = async (box, x = 0.5, y = 0.5) => {
        const projection = await app.evaluate(
          ({ BrowserWindow, screen }, { id, box, x, y }) => {
            const bounds = BrowserWindow.fromId(id).getContentBounds();
            const dip = {
              x: Math.round(bounds.x + box.x + box.width * x),
              y: Math.round(bounds.y + box.y + box.height * y),
            };
            return { point: screen.dipToScreenPoint(dip), dip, contentBounds: bounds };
          },
          { id: info.id, box, x, y },
        );
        scene.target = { box, x, y, ...projection };
        return projection.point;
      };
      const ownedWindowState = () =>
        probe('window', info.handle, path.resolve('public/voxcue.ico'));
      const focusOwnedWindow = async () => {
        scene.phase = 'focus-owned-window';
        assert.equal(probe('desktop').interactive, true);
        await app.evaluate(({ app, BrowserWindow }, info) => {
          const window = BrowserWindow.fromId(info.id);
          if (
            !window ||
            window.isDestroyed() ||
            window.getNativeWindowHandle().readBigUInt64LE().toString() !== info.handle
          )
            throw Error('The synthetic login window identity changed');
          if (window.isAlwaysOnTop()) throw Error('The synthetic login must retain normal z-order');
          app.focus({ steal: true });
          window.show();
          window.moveTop();
          window.focus();
        }, info);
        await until(
          ownedWindowState,
          (value) => value.visible && value.foreground && !(value.extendedStyle & 8),
          'The isolated login must be foreground with normal z-order before native input',
        );
      };
      const hit = async (locator, expected, x = 0.5) => {
        scene.phase = 'native-hit-' + expected;
        const point = await stableTarget(locator, (box) => pointAt(box, x));
        await until(
          () => {
            const result = probe('hittest', info.handle, point.x, point.y).result;
            const ownership = probe('hit', info.handle, point.x, point.y);
            return { result, owned: ownership.expected, ownership };
          },
          (value) => value.result === expected && value.owned,
          'Native hit test for ' + (await locator.innerText()),
        );
        return point;
      };
      const click = async (locator) => {
        await focusOwnedWindow();
        assert.equal(await locator.isDisabled(), false);
        const point = await hit(locator, 1);
        const state = ownedWindowState();
        if (!state.foreground) console.error('Native foreground owner', probe('foreground'));
        assert.ok(
          state.foreground && !(state.extendedStyle & 8),
          'The synthetic login must keep foreground ownership until native input: ' +
            JSON.stringify(state),
        );
        // The probe rechecks the input desktop and WindowFromPoint immediately
        // before its real mouse press; do not retry a rejected press.
        scene.phase = 'native-click';
        probe('click', info.handle, point.x, point.y);
      };
      const button = (name) => page.getByRole('button', { name, exact: true });
      const band = page.locator('.login-drag-region');
      // Activate away from the later drag origin so Windows cannot interpret
      // its button-down as a caption double-click instead of starting a move.
      const activation = await hit(band, 2, 0.05);
      scene.phase = 'activation-click';
      probe('click', info.handle, activation.x, activation.y);
      await win.evaluate((window) => window.setAlwaysOnTop(false));
      await focusOwnedWindow();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const initial = await win.evaluate((window) => window.getBounds());
      const dragStart = await hit(band, 2);
      scene.phase = 'caption-drag';
      probe('drag', info.handle, dragStart.x, dragStart.y, dragStart.x + 32, dragStart.y + 20);
      scene.phase = 'caption-drag-movement';
      await until(
        () => win.evaluate((window) => window.getBounds()),
        (bounds) => Math.abs(bounds.x - initial.x) > 10 || Math.abs(bounds.y - initial.y) > 10,
        'The top band must move the native window',
      );
      await win.evaluate((window, bounds) => window.setBounds(bounds), initial);
      for (const dark of [false, true]) {
        scene.theme = dark ? 'dark' : 'light';
        await page.evaluate(
          (value) => document.documentElement.classList.toggle('dark', value),
          dark,
        );
        for (const size of [
          [1000, 660],
          [860, 580],
        ]) {
          scene.requestedSize = size;
          scene.phase = 'resize-and-band-hit';
          await win.evaluate((window, [width, height]) => window.setSize(width, height), size);
          const bandBox = await band.boundingBox();
          assert.ok(bandBox && Math.abs(bandBox.y) < 1 && Math.abs(bandBox.height - 72) < 1);
          assert.ok(Math.abs(bandBox.width - (await page.evaluate(() => innerWidth))) < 1);
          for (const x of [0.05, 0.5, 0.95]) {
            const point = await pointAt(bandBox, x);
            assert.equal(probe('hittest', info.handle, point.x, point.y).result, 2);
          }
          await hit(page.getByRole('heading', { name: '登录 VoxCue', exact: true }), 1);
          await hit(page.locator('.login-preview .floating-toolbar'), 1);
          await hit(page.locator('.login-preview .floating-panel > header').first(), 1);
          await hit(page.locator('.login-footer'), 1);
          await click(button('找回密码'));
          await page.getByRole('heading', { name: '重置密码', exact: true }).waitFor();
          assert.equal(
            await page.getByLabel('新密码', { exact: true }).getAttribute('placeholder'),
            '输入密码',
          );
          await page.getByText('不少于8个字符', { exact: true }).waitFor();
          assert.equal(
            await page.getByLabel('新密码', { exact: true }).getAttribute('minlength'),
            '8',
          );
          await page.getByLabel('邮箱', { exact: true }).fill('invalid');
          assert.equal(await button('获取验证码').isDisabled(), true);
          await page.getByLabel('邮箱', { exact: true }).fill('synthetic@example.test');
          const before = await app.evaluate(() => globalThis.accountCalls.length);
          await click(button('获取验证码'));
          const resend = page.getByRole('button', { name: /秒后重发/ });
          await resend.waitFor();
          assert.equal(await resend.isDisabled(), true);
          const seconds = Number((await resend.innerText()).match(/\d+/)[0]);
          assert.ok(seconds > 0 && seconds <= 60);
          assert.deepEqual(
            await app.evaluate((_, count) => globalThis.accountCalls.slice(count), before),
            [{ action: 'code', email: 'synthetic@example.test', purpose: 'reset' }],
          );
          await click(button('返回登录'));
          await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
          await click(button('注册'));
          await page.getByRole('heading', { name: '创建账号', exact: true }).waitFor();
          assert.equal(
            await page.getByLabel('密码', { exact: true }).getAttribute('placeholder'),
            '输入密码',
          );
          await page.getByText('不少于8个字符', { exact: true }).waitFor();
          assert.equal(
            await page.getByLabel('密码', { exact: true }).getAttribute('minlength'),
            '8',
          );
          await click(button('获取验证码'));
          await page.getByRole('button', { name: /秒后重发/ }).waitFor();
          assert.deepEqual(await app.evaluate(() => globalThis.accountCalls.at(-1)), {
            action: 'code',
            email: 'synthetic@example.test',
            purpose: 'register',
          });
          await click(button('返回登录'));
          await click(button('登录'));
          await page.getByRole('alert').filter({ hasText: '密码不正确' }).waitFor();
          console.log(
            `PASS native login ${scale} ${dark ? 'dark' : 'light'} ${size.join('x')}: top-only drag, reset/register/code/return/login, cooldown`,
          );
        }
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      const readProbe = (...args) => {
        try {
          return probe(...args);
        } catch {
          return { unavailable: true };
        }
      };
      const renderer = page
        ? await page
            .evaluate((relative) => {
              const describe = (element) => ({
                tag: element.tagName,
                classes: element.getAttribute('class'),
                region: getComputedStyle(element).getPropertyValue('-webkit-app-region'),
                box: element.getBoundingClientRect().toJSON(),
              });
              const stack = relative ? document.elementsFromPoint(relative.x, relative.y) : [];
              // Chromium's native draggable map can also include an inert or clipped child
              // which does not participate in the renderer's pointer hit stack.
              const dragRects = relative ? [...document.querySelectorAll('.login-page *')].filter(element => {
                const box = element.getBoundingClientRect();
                return relative.x >= box.left && relative.x < box.right &&
                  relative.y >= box.top && relative.y < box.bottom &&
                  ['drag', 'no-drag'].includes(getComputedStyle(element).getPropertyValue('-webkit-app-region'));
              }) : [];
              return {
                dpr: devicePixelRatio,
                innerWidth,
                innerHeight,
                viewport: visualViewport && {
                  width: visualViewport.width,
                  height: visualViewport.height,
                  scale: visualViewport.scale,
                  offsetLeft: visualViewport.offsetLeft,
                  offsetTop: visualViewport.offsetTop,
                },
                band: document.querySelector('.login-drag-region')?.getBoundingClientRect().toJSON(),
                relative,
                stack: stack.map(describe),
                dragRects: dragRects.map(describe),
                preview: document.querySelector('.login-preview-content')?.getBoundingClientRect().toJSON(),
              };
            }, scene.target ? {
              x: scene.target.dip.x - scene.target.contentBounds.x,
              y: scene.target.dip.y - scene.target.contentBounds.y,
            } : null)
            .catch(() => ({ unavailable: true }))
        : null;
      const window = app && info
        ? await app
            .evaluate(({ BrowserWindow, screen }, id) => {
              const window = BrowserWindow.fromId(id);
              if (!window || window.isDestroyed()) return { unavailable: true };
              const display = screen.getDisplayMatching(window.getBounds());
              return {
                bounds: window.getBounds(),
                contentBounds: window.getContentBounds(),
                visible: window.isVisible(),
                focused: window.isFocused(),
                topmost: window.isAlwaysOnTop(),
                zoomFactor: window.webContents.getZoomFactor(),
                display: {
                  scaleFactor: display.scaleFactor,
                  bounds: display.bounds,
                  workArea: display.workArea,
                },
              };
            }, info.id)
            .catch(() => ({ unavailable: true }))
        : null;
      const point = scene.target?.point;
      console.error('NATIVE_LOGIN_DIAGNOSTIC', JSON.stringify({
        ...scene,
        owner: info,
        renderer,
        window,
        desktop: readProbe('desktop'),
        foreground: readProbe('foreground'),
        nativeGeometry: info ? readProbe('geometry', info.handle, info.pid) : null,
        hit: info && point ? readProbe('hit', info.handle, point.x, point.y) : null,
        hittest: info && point ? readProbe('hittest', info.handle, point.x, point.y) : null,
      }));
      throw error;
    } finally {
      if (app) await closeUiApp(app);
    }
  }
} finally {
  probe('move', cursor.x, cursor.y);
}
