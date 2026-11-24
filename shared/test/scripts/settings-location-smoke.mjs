import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, focusUiWindow, closeUiApp } from './install-ui-account.mjs';
import { assertSettingsHighlight } from './assert-settings-highlight.mjs';

const screenshots = process.argv.find(value => value.startsWith('--screenshots='))?.slice(14);
if (screenshots && !path.isAbsolute(screenshots)) throw Error('Screenshot directory must be absolute');
if (screenshots) await mkdir(screenshots, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|userprofile|home|appdata|localappdata|lang|lc_all|sessionname|voxcue_test_scale_factor)$/i.test(name)));
let app;
const errors = [];
async function mark(page, row) {
  await page.evaluate(() => document.querySelectorAll('[data-location-highlight]').forEach(node => node.removeAttribute('data-location-highlight')));
  await row.evaluate(node => {
    node.setAttribute('data-location-highlight', '');
    node.style.setProperty('--location-highlight-duration', '1900ms');
    node.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await assertSettingsHighlight(row);
  const clearance = await row.evaluate(node => {
    const box = node.getBoundingClientRect();
    const skin = getComputedStyle(node, '::before');
    const style = getComputedStyle(node);
    const top = box.top + parseFloat(style.borderTopWidth) + parseFloat(skin.top);
    const bottom = box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(skin.bottom);
    const controls = node.matches('.speech-device-grid, .audio-device-editor')
      ? [...node.querySelectorAll('.speech-select, .choice-trigger')].map(control => control.getBoundingClientRect()) : [];
    const card = node.closest('.account-service')?.querySelector('.account-usage-card');
    const next = node.matches('.speech-controls > .remote-connection-settings') ? node.nextElementSibling : null;
    const recording = node.matches('.speech-device-grid') ? node.nextElementSibling?.querySelector('#auto-record-label') : null;
    return {
      audio: controls.length ? [Math.min(...controls.map(control => control.top)) - top,
        bottom - Math.max(...controls.map(control => control.bottom))] : null,
      cardGap: card && node.matches('.settings-entry') ? card.getBoundingClientRect().top - bottom : null,
      recordingGap: recording ? recording.getBoundingClientRect().top - bottom : null,
      remote: next && {
        dividerCovered: bottom >= next.getBoundingClientRect().top + parseFloat(getComputedStyle(next).borderTopWidth),
        headingGap: next.querySelector('h3').getBoundingClientRect().top - bottom,
      },
    };
  });
  if (clearance.audio) assert.ok(clearance.audio.every(gap => gap >= 12),
    'Audio controls need breathing room inside the highlight: ' + JSON.stringify(clearance));
  if (clearance.recordingGap !== null) assert.ok(clearance.recordingGap > 0,
    'The audio device highlight must stop before the recording label: ' + JSON.stringify(clearance));
  // DOM rectangles can differ by floating-point noise at fractional display scales.
  if (clearance.cardGap !== null) assert.ok(Math.round(clearance.cardGap * 64) >= 12 * 64,
    'A separate rounded quota card must stay clear of the header highlight: ' + JSON.stringify(clearance));
  if (clearance.remote) assert.ok(clearance.remote.dividerCovered && clearance.remote.headingGap >= 10,
    'Remote highlight must cover the lower divider and stay clear of the next heading: ' + JSON.stringify(clearance));
}
async function capture(page, row, filename) {
  if (!screenshots) return;
  const clip = await row.evaluate(node => {
    const scope = node.closest('.settings-content, .interview-settings-dialog');
    const box = node.getBoundingClientRect();
    const bounds = scope.getBoundingClientRect();
    const header = scope.querySelector('.settings-content-heading, .dialog-heading')?.getBoundingClientRect();
    const top = Math.max(bounds.top + 4, header ? header.bottom + 8 : 0, box.top - 64);
    const bottom = Math.min(bounds.bottom - 4, box.bottom + 52);
    return { x: Math.ceil(bounds.left + 1), y: Math.ceil(top),
      width: Math.floor(bounds.width - 2), height: Math.floor(bottom - top) };
  });
  assert.ok(clip.height > 0 && clip.width > 0);
  await page.screenshot({ path: path.join(screenshots, filename + '.png'), clip, animations: 'disabled', scale: 'device' });
}
try {
  app = await electron.launch({ args: [await offlineElectronEntry()], env: {
    ...env, COPILOT_TEST_USER_DATA: path.join(testRoot, 'settings-location'), VITE_DEV_SERVER_URL: '', VOXCUE_ACCOUNT_API: '',
  } });
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { ComponentService } = require(app.getAppPath() + '/dist-electron/shared/electron/backend/components/service.js');
    const previous = ComponentService.prototype.state;
    ComponentService.prototype.state = function () {
      const state = previous.call(this);
      return { ...state, phase: 'needed', items: state.items.map(item => ({ ...item, phase: item.id === 'rag' ? 'pending' : 'ready' })) };
    };
    const { SpeechHost } = require(app.getAppPath() + '/dist-electron/shared/electron/backend/speech/host.js');
    const call = SpeechHost.prototype.call;
    SpeechHost.prototype.call = function (request) {
      if (request.op === 'devices' || request.op === 'status') return Promise.resolve({
        state: 'idle', model: 'Synthetic speech port', devices: [
          { id: 'synthetic-output', name: '测试播放设备', source: 'system' },
          { id: 'synthetic-microphone', name: '测试麦克风', source: 'microphone' },
        ],
      });
      return call.call(this, request);
    };
  });
  const login = await app.firstWindow();
  const page = await connectUiAccount(app, login);
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const win = await app.browserWindow(page);
  await win.evaluate(window => window.setContentSize(1280, 860));
  await focusUiWindow(app, page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.locator('.app-dialog.settings-dialog');
  const cases = [
    ['01-migration', 'VoxCue 账号', '[data-settings-target="account-migration"]'],
    ['02-component-card', '本地组件', '[data-settings-target="rag"]'],
    ['03-ai-service', 'AI 服务', '[data-settings-target="chatgpt"]'],
    ['04-audio-devices', '面试设置', '[data-settings-target="audio-devices"]'],
    ['05-speech-model', '面试设置', '[data-settings-highlight-group]:has([data-settings-target="speech-model"])'],
    ['06-remote-connection', '面试设置', '[data-settings-target="remote-connection"]'],
  ];
  for (const [filename, category, selector] of cases) {
    await settings.getByRole('button', { name: category, exact: true }).click();
    const row = settings.locator(selector);
    await row.waitFor();
    await mark(page, row);
    await capture(page, row, filename + '-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
    await assertSettingsHighlight(row);
    await capture(page, row, filename + '-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  }
  await win.evaluate(window => window.setContentSize(880, 740));
  for (const category of ['VoxCue 账号', '本地组件', 'AI 服务', '面试设置']) {
    await settings.getByRole('button', { name: category, exact: true }).click();
    for (const row of await settings.locator('[data-settings-target]').all()) {
      const group = row.locator('xpath=ancestor-or-self::*[@data-settings-highlight-group][1]');
      const target = await group.count() ? group : row;
      await mark(page, target);
    }
  }
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await win.evaluate(window => window.setContentSize(1280, 860));
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const start = page.getByRole('dialog', { name: '开始面试', exact: true });
  const opened = app.waitForEvent('window');
  await start.getByRole('button', { name: '确认开始', exact: true }).click();
  const floating = await opened;
  floating.setDefaultTimeout(15000);
  floating.on('pageerror', error => errors.push(error.message));
  await floating.getByRole('button', { name: '面试设置', exact: true }).waitFor();
  await focusUiWindow(app, floating);
  await floating.emulateMedia({ reducedMotion: 'reduce' });
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const dialog = floating.getByRole('dialog', { name: '面试设置', exact: true });
  const audio = dialog.locator('.interview-audio-settings > .audio-device-editor');
  await mark(floating, audio);
  assert.ok(await audio.evaluate(node => {
    const section = node.parentElement;
    const heading = section.querySelector('h3');
    const next = section.nextElementSibling;
    return !node.contains(heading) && getComputedStyle(node).borderBottomStyle === 'solid' &&
      Math.abs(section.getBoundingClientRect().bottom - next.getBoundingClientRect().top) < 1;
  }), 'Floating audio headings remain outside the highlight while the lower divider stays aligned');
  await capture(floating, audio, '07-interview-audio-dark');
  assert.deepEqual(errors, []);
  console.log('PASS: settings highlight margins, divider coverage, standalone heading clearance, A-style rounded card clipping, main audio targets, floating audio groups, dark/light and narrow layouts; owned synthetic data only');
} finally { if (app) await closeUiApp(app); }
