import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';

// AppKit's actual content-view hit test catches native drag interception that
// Playwright's renderer input alone cannot detect. No global mouse input is sent.
const releaseDesktop = holdDesktopAwake();
const probe = path.join(testRoot, 'login-hit-probe.node');
execFileSync('/usr/bin/xcrun', [
  'clang++',
  '-std=c++17',
  '-fobjc-arc',
  '-DNAPI_VERSION=8',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-arch',
  'arm64',
  '-mmacosx-version-min=14.2',
  '-I',
  path.join(workspace.platformRoot, '.cache/node-api-headers'),
  path.join(workspace.platformRoot, 'test/fixtures/login-hit-probe.mm'),
  '-framework',
  'AppKit',
  '-o',
  probe,
]);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', probe], { stdio: 'pipe' });
const fixture = path.join(testRoot, 'login-actions.cjs');
await writeFile(
  fixture,
  `
const {app,safeStorage}=require('electron'),path=require('node:path');
const root=${JSON.stringify(workspace.platformRoot)},base=path.join(root,'dist-electron/shared/electron');
app.setAppPath(root);app.commandLine.appendSwitch('use-mock-keychain');
const Client=require(path.join(base,'backend/cloud/client.js')).CloudAccountClient;
const state={configured:true,verified:false,user:null};globalThis.accountCalls=[];
Client.prototype.snapshot=()=>state;Client.prototype.call=async function(call){
 globalThis.accountCalls.push(call);return {ok:true,state,...(call.action==='code'?{challenge:{
 id:'b0000000-0000-4000-8000-000000000001',expiresInSeconds:300,retryAfterSeconds:60}}:{})};
};
for(const [module,name] of [['backend/auth/service.js','ChatGPTAuthService'],['backend/copilot/auth.js','CopilotAuthService']])
 require(path.join(base,module))[name].prototype.session=async()=>null;
require(root+'/dist-electron/macos/electron/credentials.js').createCredentialEncryption=()=>({encrypt:v=>safeStorage.encryptString(v),decrypt:v=>safeStorage.decryptString(v)});
require(path.join(base,'main.js'));
`,
);
let passed = 0;
try {
  for (const scale of ['1', '1.25', '1.5', '1.75', '2']) {
    let app;
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
      const page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
      const win = await app.browserWindow(page);
      const windowId = await win.evaluate((window) => window.id);
      const button = (name) => page.getByRole('button', { name, exact: true });
      const hitPoint = async (point, expected, label) => {
        const deadline = Date.now() + 5000;
        let state;
        do {
          requireUnlockedDesktop();
          state = await app.evaluate(
            ({ app, BrowserWindow }, { probe, point, windowId, owner }) => {
              if (!app.getPath('userData').startsWith(owner + '/'))
                throw Error('Synthetic profile required');
              const load = process
                .getBuiltinModule('module')
                .createRequire(app.getAppPath() + '/package.json');
              return JSON.parse(
                load(probe).probe(
                  BrowserWindow.fromId(windowId).getNativeWindowHandle(),
                  point.x,
                  point.y,
                ),
              );
            },
            { probe, point, windowId, owner: testRoot },
          );
          if (state.nativeHit && state.contentReceivesMouse === expected) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        } while (Date.now() < deadline);
        assert.fail(label + ': ' + JSON.stringify({ point, expected, state }));
      };
      const hit = async (locator, label) => {
        const point = await locator.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return {
            x: (box.left + box.width / 2) / innerWidth,
            y: (box.top + box.height / 2) / innerHeight,
          };
        });
        await hitPoint(point, true, label);
      };
      const click = async (name) => {
        assert.equal(await button(name).isDisabled(), false);
        await hit(button(name), name);
        await button(name).click();
      };
      for (const dark of [false, true]) {
        await page.evaluate(
          (value) => document.documentElement.classList.toggle('dark', value),
          dark,
        );
        for (const size of [
          [1000, 660],
          [860, 580],
        ]) {
          await win.evaluate((window, [width, height]) => {
            window.setSize(width, height);
            window.focus();
          }, size);
          const band = await page.locator('.login-drag-region').evaluate((node) => {
            const box = node.getBoundingClientRect();
            return {
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              viewport: innerWidth,
              viewportHeight: innerHeight,
              region: getComputedStyle(node).webkitAppRegion,
            };
          });
          assert.equal(band.left, 0);
          assert.equal(band.top, 0);
          assert.equal(band.height, 72);
          // Normalize floating point output to Chromium's 1/64 CSS layout grid.
          assert.equal(Math.round(band.width * 64), band.viewport * 64);
          assert.equal(band.region, 'drag');
          for (const x of [0.25, 0.5, 0.95])
            await hitPoint(
              { x, y: 36 / band.viewportHeight },
              false,
              'Top strip belongs to native window dragging',
            );
          await hitPoint(
            { x: 0.95, y: 76 / band.viewportHeight },
            true,
            'Content immediately below strip must receive mouse',
          );
          for (const selector of [
            '.login-copy',
            '.login-preview .floating-toolbar',
            '.login-preview .floating-panel > header',
            '.login-footer',
          ])
            await hit(page.locator(selector).first(), selector);
          await click('找回密码');
          await page.getByRole('heading', { name: '重置密码', exact: true }).waitFor();
          await page.getByLabel('邮箱', { exact: true }).fill('invalid');
          assert.equal(await button('获取验证码').isDisabled(), true);
          await page.getByLabel('邮箱', { exact: true }).fill('synthetic@example.test');
          await click('获取验证码');
          const cooldown = page.getByRole('button', { name: /秒后重发/ });
          await cooldown.waitFor();
          assert.equal(await cooldown.isDisabled(), true);
          const seconds = Number((await cooldown.innerText()).match(/\d+/)[0]);
          assert.ok(seconds > 0 && seconds <= 60);
          assert.deepEqual(await app.evaluate(() => globalThis.accountCalls.at(-1)), {
            action: 'code',
            email: 'synthetic@example.test',
            purpose: 'reset',
          });
          await click('返回登录');
          await click('注册');
          await page.getByRole('heading', { name: '创建账号', exact: true }).waitFor();
          await click('获取验证码');
          await page.getByRole('button', { name: /秒后重发/ }).waitFor();
          assert.deepEqual(await app.evaluate(() => globalThis.accountCalls.at(-1)), {
            action: 'code',
            email: 'synthetic@example.test',
            purpose: 'register',
          });
          await click('返回登录');
          await click('登录');
          await page.getByRole('alert').filter({ hasText: '请输入密码' }).waitFor();
          console.log(
            `PASS Mac native login hit routing ${scale} ${dark ? 'dark' : 'light'} ${size.join('x')}: top-only drag, reset/register/code/return/login and cooldown`,
          );
          passed++;
        }
      }
      assert.deepEqual(errors, []);
      if (process.argv.includes('--preview') && scale === '2') {
        await click('注册');
        await click('返回登录');
        await app.evaluate(({ app, BrowserWindow }, id) => {
          const window = BrowserWindow.fromId(id);
          app.focus({ steal: true });
          window.show();
          window.moveTop();
          window.focus();
        }, windowId);
        console.log(
          'ACTION_REQUIRED: optional owned synthetic login review; no real code is sent. Close this test window or press Enter to finish.',
        );
        let timer, onEnter;
        try {
          await Promise.race([
            new Promise((resolve) => {
              onEnter = resolve;
              process.stdin.once('data', onEnter);
            }),
            page.waitForEvent('close', { timeout: 0 }),
            new Promise((resolve) => {
              timer = setTimeout(resolve, 120000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
          process.stdin.off('data', onEnter);
          process.stdin.pause();
        }
      }
    } finally {
      if (app) await closeUiApp(app);
    }
  }
} finally {
  releaseDesktop();
}
assert.equal(passed, 20);
console.log(
  JSON.stringify({ passed, total: 20, nativeAppKitHitTesting: true, globalInputSent: false }),
);
