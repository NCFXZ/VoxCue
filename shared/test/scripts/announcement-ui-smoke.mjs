import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import workspace from '../../scripts/workspace.mjs';
import packageInfo from '../../package.json' with { type: 'json' };
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, enterPrimaryUiAccount, waitForRestoredMainWindow, focusUiWindow, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';
import { assertNoticeStackMotion, assertNoticeQueueTransition } from './assert-notice-stack-motion.mjs';

const feedFile = path.join(testRoot, 'announcement-feed.json');
const entryFile = path.join(testRoot, 'announcement-entry.cjs');
const numbers = packageInfo.version.split('.').map(Number);
const nextVersion = [numbers[0], numbers[1], numbers[2] + 1].join('.');
const notice = (id, patch = {}) => ({
  id, title: id, subtitle: 'Owned synthetic announcement', expiresAt: '2099-01-01T00:00:00Z', ...patch,
});
await writeFile(feedFile, JSON.stringify({ schemaVersion: 1, announcements: [
  notice('wrong-exact', { versionFilter: { type: 'eq', version: nextVersion } }),
  notice('wrong-above', { versionFilter: { type: 'gt', version: packageInfo.version } }),
  notice('wrong-below', { versionFilter: { type: 'lt', version: packageInfo.version } }),
  notice('signed-in', { audience: 'signed-in', title: '已登录公告' }),
  notice('expired', { expiresAt: '2000-01-01T00:00:00Z' }),
  notice('expires-first', { audience: 'signed-out', expiresAt: 'FIRST_FETCH_PLUS_8_SECONDS', title: '即将过期的合成公告' }),
  notice('counter', { audience: 'signed-out', versionFilter: { type: 'lt', version: nextVersion },
    title: { 'zh-CN': '公告预览', en: 'Announcement preview' },
    subtitle: { 'zh-CN': '这是一条本机合成公告，用于验证版本、登录状态和关闭行为。', en: 'Synthetic notice for version, sign-in and dismissal checks.' },
    button: { label: { 'zh-CN': '前往语音设置', en: 'Open speech settings' }, icon: 'settings', action: { type: 'navigate', target: 'speech-model' } },
  }),
  notice('web', { title: '网页公告', subtitle: '较长的合成公告说明，用于验证卡片高度变化。\n\n第二段继续检查边框与内容是否一起平滑变高或变矮。', button: { label: { 'zh-CN': '查看教程', en: 'Read guide' },
    action: { type: 'url', url: { 'zh-CN': 'https://voxcue.com.cn/', en: 'https://voxcue.com.cn/en/' } } } }),
  notice('no-action', { title: '没有操作按钮的公告' }),
] }));
await writeFile(entryFile, [
  "const {app}=require('electron');",
  "if(app.isPackaged)throw Error('Synthetic announcement fixture cannot run in a package');",
  "const fs=require('node:fs'),path=require('node:path');",
  'const feedFile=' + JSON.stringify(feedFile) + ';',
  'const root=' + JSON.stringify(workspace.platformRoot) + ';',
  "const offlineFetch=globalThis.fetch;",
  "globalThis.fetch=async function(input,options){",
  " if(input!=='https://voxcue.com.cn/app/announcements.json')return offlineFetch(input,options);",
  " const feed=JSON.parse(fs.readFileSync(feedFile,'utf8'));",
  " for(const item of feed.announcements)if(item.expiresAt==='FIRST_FETCH_PLUS_8_SECONDS')item.expiresAt=new Date(Date.now()+8000).toISOString();",
  " fs.writeFileSync(feedFile,JSON.stringify(feed));",
  " return new Response(JSON.stringify(feed),{headers:{'content-type':'application/json'}});",
  "};",
  "require(path.join(root,'dist-electron/shared/electron/main.js'));",
].join('\n'));
const entry = await offlineElectronEntry(entryFile);
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|userprofile|home|appdata|localappdata|lang|lc_all|sessionname)$/i.test(name)));
let app, page;
const errors = [];
async function launch(restored = false, signedIn = false) {
  app = await electron.launch({ args: [entry], env: { ...env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, signedIn ? 'cloud-preview' : 'local-preview'),
    VITE_DEV_SERVER_URL: '', VOXCUE_ACCOUNT_API: '',
  } });
  await installUiAccount(app, { speech: true, components: true });
  if (restored) page = await waitForRestoredMainWindow(app);
  else {
    const login = await app.firstWindow();
    await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
    if (signedIn) page = await enterPrimaryUiAccount(app, login);
    else {
      const opened = app.waitForEvent('window');
      await login.getByRole('button', { name: '跳过登录', exact: true }).click();
      page = await opened;
    }
  }
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  const win = await app.browserWindow(page);
  await win.evaluate(w => w.setContentSize(1280, 860));
  await focusUiWindow(app, page);
  await app.evaluate(({ shell }) => {
    globalThis.announcementLinks = [];
    shell.openExternal = async url => { globalThis.announcementLinks.push(url); };
  });
}
const banner = (english = false) => page.getByRole('complementary', { name: english ? 'Announcement' : '公告', exact: true });
async function language(value) {
  await page.evaluate(value => {
    localStorage.setItem('voxcue-language-v1', value);
    dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
  }, value);
}
const savedCount = id => page.evaluate(id => JSON.parse(localStorage.getItem('voxcue-announcement-dismissals-v1') ?? '{}')[id], id);

try {
  await launch();
  await banner().getByText('即将过期的合成公告', { exact: true }).waitFor();
  await banner().getByText('公告预览', { exact: true }).waitFor();
  const result = await page.evaluate(() => window.desktop.announcements());
  assert.equal(result.ok, true);
  assert.deepEqual(result.announcements.map(item => item.id), ['counter', 'web', 'no-action']);

  await page.evaluate(() => localStorage.setItem('voxcue-update-notice-v1', JSON.stringify({ version: '0.0.1', pending: false })));
  await page.reload();
  await page.getByRole('complementary', { name: '更新完成', exact: true }).waitFor();
  assert.equal(await banner().count(), 0, 'Update completion takes priority over announcements');
  await assertNoticeQueueTransition(page, '关闭提示');
  await banner().getByText('公告预览', { exact: true }).waitFor();

  for (const value of ['zh-CN', 'en']) {
    await language(value);
    const english = value === 'en';
    const notice = banner(english);
    const action = notice.getByRole('button', { name: english ? 'Open speech settings' : '前往语音设置', exact: true });
    await action.waitFor();
    assert.equal(await action.locator('svg').count(), 1);
    assert.ok(await action.evaluate(node => node.querySelector('svg') === node.firstElementChild), 'Settings icon stays on the left');
    assert.equal(await notice.getByRole('button', { name: english ? "Don't show again" : '不再显示', exact: true }).count(), 1);
    const win = await app.browserWindow(page);
    await win.evaluate(w => w.setContentSize(880, 740));
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      assert.ok(await notice.evaluate(node => {
        const box = node.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1 &&
          [...node.querySelectorAll('button')].every(button => getComputedStyle(button).cursor === 'default');
      }), 'Notice fits the narrow window with arrow cursors');
    }
    await win.evaluate(w => w.setContentSize(1280, 860));
  }
  await language('zh-CN');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await banner().getByRole('button', { name: '前往语音设置', exact: true }).click();
  const settings = page.locator('.app-dialog.settings-dialog');
  await settings.waitFor();
  await page.waitForFunction(() => !!document.querySelector('.settings-dialog [data-settings-target="speech-model"]')?.closest('[data-location-highlight]'));
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await captureRequested(page, 'announcement-preview');
  await assertNoticeStackMotion(page);

  await assertNoticeQueueTransition(page, '关闭公告', true);
  assert.equal(await savedCount('counter'), 1);
  await banner().getByText('网页公告', { exact: true }).waitFor();
  for (const value of ['zh-CN', 'en']) {
    await language(value);
    const english = value === 'en';
    const action = banner(english).getByRole('button', { name: english ? 'Read guide' : '查看教程', exact: true });
    await action.waitFor();
    assert.ok(await action.evaluate(node => node.querySelector('svg') === node.lastElementChild), 'Jump icon stays on the right');
    await action.focus(); await action.press('Enter');
    assert.equal(await app.evaluate(() => globalThis.announcementLinks.at(-1)), 'https://voxcue.com.cn/' + (english ? 'en/' : ''));
  }
  await language('zh-CN');
  await assertNoticeQueueTransition(page, '不再显示', true);
  assert.equal(await savedCount('web'), 3);
  await banner().getByText('没有操作按钮的公告', { exact: true }).waitFor();
  assert.equal(await banner().getByRole('button').count(), 2);
  await assertNoticeQueueTransition(page, '不再显示');
  await banner().waitFor({ state: 'hidden' });
  await closeUiApp(app); app = undefined;

  for (const count of [2, 3]) {
    await launch(true);
    await banner().getByText('公告预览', { exact: true }).waitFor();
    await banner().getByRole('button', { name: '关闭公告', exact: true }).click();
    assert.equal(await savedCount('counter'), count);
    await closeUiApp(app); app = undefined;
  }
  await launch(true);
  await page.evaluate(() => window.desktop.announcements());
  assert.equal(await banner().count(), 0, 'Three X dismissals and explicit opt-outs survive a full restart');
  await closeUiApp(app); app = undefined;
  await launch(false, true);
  await banner().getByText('已登录公告', { exact: true }).waitFor();
  const signed = await page.evaluate(() => window.desktop.announcements());
  assert.equal(signed.ok, true);
  assert.ok(signed.announcements.some(item => item.id === 'signed-in'));
  assert.ok(!signed.announcements.some(item => item.id === 'counter'), 'Main-account sign-in controls audience matching');
  assert.deepEqual(errors, []);
  console.log('PASS: real announcement IPC/feed validation, login/version/expiry filtering, live expiry, update priority, localized actions/icons, settings highlight, no-action cards, X x3 across app restarts, permanent dismissal and per-owner separation; owned synthetic profiles only');
} finally { if (app) await closeUiApp(app); }
