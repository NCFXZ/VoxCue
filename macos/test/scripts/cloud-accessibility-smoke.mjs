import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import {
  installUiAccount,
  connectUiAccount,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Chromium media emulation, not a change to macOS accessibility preferences.
const app = await electron.launch({
  args: ['.'],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
try {
  await installUiAccount(app, { components: true, speech: true });
  const main = await connectUiAccount(app, await app.firstWindow());
  await app.evaluate(({ app }) => {
    const load = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const Client = load(
      app.getAppPath() + '/dist-electron/shared/electron/backend/cloud/client.js',
    ).CloudAccountClient;
    const api = Client.prototype.api;
    Client.prototype.api = function (route, ...args) {
      if (route.startsWith('/v1/backups'))
        return Promise.resolve({
          items: [],
          nextCursor: null,
          storage: {
            currentBytes: { profile: 1000000, history: 40000000, knowledgebase: 60000000 },
            storedBytes: { profile: 1000000, history: 40000000, knowledgebase: 60000000 },
            reservedBytes: { profile: 0, history: 0, knowledgebase: 0 },
            capacityBytes: 100000000,
            knowledgeCapacityBytes: 100000000,
          },
        });
      return api.call(this, route, ...args);
    };
  });
  const cdp = await main.context().newCDPSession(main);
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  const outcomes = [];
  for (const scheme of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, scheme) => {
      nativeTheme.themeSource = scheme;
    }, scheme);
    for (const width of [960, 1280, 1600]) {
      await (
        await app.browserWindow(main)
      ).evaluate((win, width) => win.setSize(width, 800), width);
      for (const [name, value] of [
        ['prefers-reduced-motion', 'reduce'],
        ['prefers-reduced-transparency', 'reduce'],
        ['prefers-contrast', 'more'],
        ['forced-colors', 'active'],
      ]) {
        await cdp.send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-color-scheme', value: scheme },
            { name, value },
          ],
        });
        assert.equal(
          await main.evaluate(
            ([name, value]) => matchMedia(`(${name}: ${value})`).matches,
            [name, value],
          ),
          true,
        );
        for (const category of [
          'VoxCue 账号',
          'AI 服务',
          '本地组件',
          '面试设置',
          '通用',
          '关于与更新',
        ]) {
          await settings
            .getByRole('navigation', { name: '设置分类' })
            .getByRole('button', { name: category, exact: true })
            .click();
          if (category === '面试设置') {
            const font = settings.getByRole('slider', { name: '面试字体大小', exact: true });
            await font.focus();
            await font.press('End');
            assert.equal(await font.inputValue(), '24');
          }
          await main.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const geometry = await settings.evaluate((dialog) => {
            const heading = dialog.querySelector('.settings-content-heading'),
              content = dialog.querySelector('.settings-content-body');
            const a = dialog.getBoundingClientRect(),
              b = heading.getBoundingClientRect(),
              scroll = content.getBoundingClientRect();
            return {
              visible:
                a.left >= 0 && a.top >= 0 && a.right <= innerWidth && a.bottom <= innerHeight,
              gutter: b.right <= scroll.left + content.clientWidth + 1,
              material: getComputedStyle(document.documentElement)
                .getPropertyValue('--web-material-filter')
                .trim(),
            };
          });
          assert.equal(
            geometry.visible,
            true,
            JSON.stringify({ scheme, width, name, category, geometry }),
          );
          assert.equal(geometry.gutter, true);
          if (name !== 'prefers-reduced-motion') assert.equal(geometry.material, 'none');
          if (category === 'VoxCue 账号') {
            await settings.getByRole('button', { name: '刷新容量', exact: true }).click();
            await settings.getByText('可用 0.00 MB · 已用 101.00 MB', { exact: true }).waitFor();
            assert.ok(
              await settings
                .locator('.cloud-storage-bar')
                .evaluate((node) => node.scrollWidth <= node.clientWidth),
            );
            if (name === 'forced-colors') {
              const colors = await settings.evaluate((node) => {
                const track = node.querySelector('.settings-switch');
                return {
                  track: getComputedStyle(track).backgroundColor,
                  thumb: getComputedStyle(track.firstElementChild).backgroundColor,
                  segments: [...node.querySelectorAll('.cloud-storage-bar > span')].map(
                    (span) => getComputedStyle(span).backgroundColor,
                  ),
                };
              });
              assert.notEqual(colors.thumb, colors.track);
              assert.notEqual(colors.thumb, 'rgba(0, 0, 0, 0)');
              assert.equal(new Set(colors.segments).size, 3);
            }
          }
          if (process.argv.includes('--preview') && width === 960 && category === 'VoxCue 账号') {
            const file = path.join(testRoot, `${scheme}-${name}.png`);
            await main.screenshot({ path: file });
          }
          if (
            process.argv.includes('--preview') &&
            name === 'prefers-reduced-motion' &&
            ((width === 1600 && category === '面试设置') ||
              (width === 1280 && category === 'VoxCue 账号'))
          )
            await main.screenshot({ path: path.join(testRoot, `${scheme}-${width}.png`) });
          outcomes.push({ scheme, width, name, category });
        }
      }
    }
  }
  console.log(
    JSON.stringify({
      passed: outcomes.length,
      mediaEmulation: true,
      nativeSystemPreferencesChanged: false,
      maximumInterviewFont: 24,
    }),
  );
  if (process.argv.includes('--preview')) {
    console.log('VISUAL_DIRECTORY=' + testRoot);
    // WebContents captures omit the native vibrancy behind transparent pixels.
    // Cover the entire work area with our own synthetic background before a
    // capture of this one owned window. Never capture other windows/the desktop.
    const backgroundId = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const background = new BrowserWindow({
        ...screen.getPrimaryDisplay().workArea,
        frame: false,
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await background.loadURL(
        'data:text/html,' +
          encodeURIComponent(
            '<style>body{margin:0;background:repeating-linear-gradient(35deg,#84b8da 0 60px,#f2d0ad 60px 120px);font:40px system-ui;color:#273e50}div{padding:50px}</style>' +
              '<div>VoxCue synthetic backdrop<br>Only owned test windows<br>ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>0123456789</div>'.repeat(
                8,
              ),
          ),
      );
      background.showInactive();
      return background.id;
    });
    const win = await app.browserWindow(main);
    await win.evaluate((window) => {
      window.setSize(1000, 760);
      window.center();
      window.moveTop();
      window.focus();
    });
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: 'VoxCue 账号', exact: true })
      .click();
    for (const scheme of ['light', 'dark']) {
      await app.evaluate(({ nativeTheme }, scheme) => {
        nativeTheme.themeSource = scheme;
      }, scheme);
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }],
      });
      await main.waitForTimeout(200);
      const id = await win.evaluate((window) => window.getMediaSourceId().split(':')[1]);
      assert.match(id, /^\d+$/);
      const capture = spawnSync(
        '/usr/sbin/screencapture',
        ['-x', '-o', '-l', id, path.join(testRoot, `native-${scheme}.png`)],
        { encoding: 'utf8', timeout: 10000 },
      );
      console.log('NATIVE_PREVIEW=' + JSON.stringify({ scheme, passed: capture.status === 0 }));
    }
    await app.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(),
      backgroundId,
    );
    await new Promise((resolve) => setTimeout(resolve, 45000));
  }
} finally {
  await closeUiApp(app);
}
