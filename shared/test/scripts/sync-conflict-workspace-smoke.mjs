import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import viteConfig from '../../vite.config.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';

const { build } = await import(pathToFileURL(workspace.platformRequire.resolve('vite')).href);
const entry = path.join(testRoot, 'index.html');
const dist = path.join(testRoot, 'dist');
const profile = path.join(testRoot, 'profile');
const host = path.join(testRoot, 'fixture.cjs');
await mkdir(profile);
await writeFile(entry, '<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:">' +
  '<div id="root"></div><script type="module" src="./ui.tsx"></script></html>');
await writeFile(path.join(testRoot, 'ui.tsx'),
  'import ' + JSON.stringify(path.join(workspace.sharedRoot, 'test/fixtures/sync-conflict-workspace.tsx')) + ';');
await build({
  ...viteConfig, configFile: false, root: testRoot, publicDir: false, logLevel: 'error',
  cacheDir: path.join(testRoot, 'vite-cache'),
  build: { target: 'esnext', outDir: dist, rollupOptions: { input: entry } },
});
await writeFile(host, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
app.setPath('sessionData', ${JSON.stringify(profile)});
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 760, height: 590, webPreferences: {
    contextIsolation: true, sandbox: true, nodeIntegration: false
  } });
  win.loadFile(${JSON.stringify(path.join(dist, 'index.html'))});
});
app.on('window-all-closed', () => app.quit());`);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [host], env });
try {
  const page = await app.firstWindow();
  const win = await app.browserWindow(page);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.conflictFixture);
  const progress = () => page.evaluate(() => window.conflictFixture.choices);
  const contentSize = (width, height) => win.evaluate((window, size) => window.setContentSize(...size), [width, height]);
  for (const labels of [
    { language: 'zh-CN', dark: false, width: 760, height: 550,
      settings: '设置', closeSettings: '关闭设置', title: '资料冲突', open: '查看冲突', jump: '前往设置',
      notice: '有 3 条资料在本地与云端存在冲突。', remaining: '有 1 条资料在本地与云端存在冲突。',
      prompt: '选择需要保留的资料。', cloud: '云端', local: '本地', allCloud: '全选云端', allLocal: '全选本地',
      save: '保留所选版本', close: '关闭对话框', cancel: '取消', collapse: '收起知识库', expand: '展开知识库',
      profile: '个人信息', missing: '云端没有这份资料，选择云端会移除本地副本。' },
    { language: 'en', dark: true, width: 540, height: 440,
      settings: 'Settings', closeSettings: 'Close settings', title: 'Data conflicts', open: 'View conflicts', jump: 'Open settings',
      notice: 'Conflicts between local and cloud versions: 3.', remaining: 'Conflicts between local and cloud versions: 1.',
      prompt: 'Choose which versions to keep.', cloud: 'Cloud', local: 'Local',
      allCloud: 'Select all cloud versions', allLocal: 'Select all local versions',
      save: 'Keep selected versions', close: 'Close dialog', cancel: 'Cancel', collapse: 'Collapse Knowledge bases',
      expand: 'Expand Knowledge bases', profile: 'Profile', missing: 'There is no cloud copy. Choosing Cloud will remove the local copy.' },
  ]) {
    await contentSize(labels.width, labels.height);
    await page.evaluate(({ language, dark }) => window.conflictFixture.configure(language, dark), labels);
    const notice = page.getByRole('complementary', { name: labels.title, exact: true });
    await notice.getByText(labels.notice, { exact: true }).waitFor();
    await notice.getByRole('button', { name: labels.jump, exact: true }).click();
    const settings = page.getByRole('dialog', { name: labels.settings, exact: true });
    const open = settings.getByRole('button', { name: labels.open, exact: true });
    await open.waitFor();
    await page.waitForFunction(() => document.activeElement?.closest('[data-settings-target="sync-conflicts"]'));
    const conflict = page.getByRole('dialog', { name: labels.title, exact: true });
    const heading = conflict.locator(':scope > .dialog-heading');
    const save = conflict.getByRole('button', { name: labels.save, exact: true });
    const allCloud = heading.getByRole('button', { name: labels.allCloud, exact: true });
    const allLocal = heading.getByRole('button', { name: labels.allLocal, exact: true });
    const close = heading.getByRole('button', { name: labels.close, exact: true });
    await open.click();
    await heading.getByText(labels.prompt, { exact: true }).waitFor();
    assert.equal(await save.isEnabled(), false);
    for (const name of [labels.profile, 'Planning', 'Dispatch'])
      await conflict.getByRole('group', { name, exact: true }).waitFor();
    assert.equal(await conflict.getByRole('radio').count(), 6, 'Attachments share the parent decision');
    assert.equal(await conflict.getByText(/invoice\.txt|preview/).count(), 0);
    await conflict.getByText(labels.missing, { exact: true }).waitFor();
    const geometry = await heading.evaluate(async header => {
      const dialog = header.closest('dialog');
      await Promise.allSettled(dialog.getAnimations().filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
        .map(animation => animation.finished));
      const rect = dialog.getBoundingClientRect();
      const title = header.querySelector('h2');
      const subtitle = header.querySelector('.dialog-subtitle');
      const actions = [...header.querySelectorAll('button')];
      return {
        width: rect.width,
        expectedWidth: Math.min(560, innerWidth * 0.9),
        titleVisible: title.scrollWidth <= title.clientWidth + 1,
        subtitleVisible: subtitle.scrollWidth <= subtitle.clientWidth + 1,
        buttons: actions.map(button => {
          const box = button.getBoundingClientRect();
          return {
            center: box.top + box.height / 2,
            leftInset: box.left - rect.left,
            rightInset: rect.right - box.right,
            hits: button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
          };
        }),
      };
    });
    assert.ok(Math.abs(geometry.width - geometry.expectedWidth) < 1, JSON.stringify(geometry));
    assert.ok(geometry.titleVisible && geometry.subtitleVisible, JSON.stringify(geometry));
    assert.equal(geometry.buttons.length, 3);
    for (const item of geometry.buttons)
      assert.ok(item.leftInset >= 0 && item.rightInset >= 0 && item.hits &&
        Math.abs(item.center - geometry.buttons[0].center) < 1, JSON.stringify(geometry));
    assert.equal(await heading.locator('button svg[data-ui-icon][aria-hidden="true"]').count(), 3);
    for (const toggle of await conflict.locator('.selection-toggle').all())
      assert.ok(await toggle.evaluate(button =>
        button.querySelector('svg').getBoundingClientRect().left >= button.querySelector('span').getBoundingClientRect().right));
    if (labels.dark) {
      const scroll = conflict.locator(':scope > .dialog-scroll');
      const footer = conflict.locator(':scope > .modal-footer');
      const headerTop = (await heading.boundingBox()).y;
      const footerTop = (await footer.boundingBox()).y;
      await scroll.evaluate(el => { el.scrollTop = 56; });
      await page.waitForFunction(() => {
        const header = document.querySelector('.sync-problem-dialog[open] > .dialog-heading');
        return header && Number(getComputedStyle(header, '::before').opacity) > 0;
      });
      assert.ok(Math.abs((await heading.boundingBox()).y - headerTop) < 1);
      assert.ok(Math.abs((await footer.boundingBox()).y - footerTop) < 1);
      await scroll.evaluate(el => { el.scrollTop = 0; });
    }
    const dispatch = conflict.getByRole('group', { name: 'Dispatch', exact: true });
    const radio = (row, name) => row.getByRole('radio', { name, exact: true });
    const cloud = radio(dispatch, labels.cloud);
    const local = radio(dispatch, labels.local);
    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    assert.equal(dark, labels.dark);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.deepEqual(await cloud.evaluate(el => {
      const style = getComputedStyle(el), dot = getComputedStyle(el, '::before');
      return [style.borderRadius, dot.borderRadius, dot.opacity, dot.maskImage, dot.transitionProperty.includes('transform')];
    }), ['50%', '50%', '0', 'none', true]);
    await cloud.check();
    await cloud.press('ArrowRight');
    assert.equal(await local.isChecked(), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(await local.evaluate(el => {
      const dot = getComputedStyle(el, '::before');
      return [dot.opacity, dot.transitionDuration];
    }), ['1', '0s']);
    await conflict.getByRole('button', { name: labels.collapse, exact: true }).click();
    assert.equal(await dispatch.count(), 0);
    await allCloud.click();
    assert.equal(await conflict.getByRole('radio', { name: labels.cloud, checked: true }).count(), 2);
    await allLocal.click();
    await conflict.getByRole('button', { name: labels.expand, exact: true }).click();
    assert.equal(await local.isChecked(), true);
    const record = conflict.getByRole('group', { name: 'Planning', exact: true });
    await radio(record, labels.cloud).check();
    await page.evaluate(() => window.conflictFixture.changeRecordVersion());
    await page.waitForFunction(() => ![...document.querySelectorAll('fieldset[aria-label="Planning"] input')].some(radio => radio.checked));
    await close.click();
    assert.deepEqual(await progress(), []);
    await open.click();
    assert.equal(await save.isEnabled(), false);
    await allLocal.click();
    await radio(record, labels.cloud).check();
    await save.click();
    await conflict.waitFor({ state: 'hidden' });
    assert.deepEqual((await progress()).sort(), ['base:review/local', 'profile:main/local', 'record:session/cloud']);
    await page.evaluate(() => window.conflictFixture.settle('record:session'));
    await settings.getByText(labels.remaining, { exact: true }).waitFor();
    await open.click();
    assert.equal(await conflict.getByRole('radio').count(), 2);
    await conflict.getByRole('button', { name: labels.cancel, exact: true }).click();
    await settings.getByRole('button', { name: labels.closeSettings, exact: true }).click();
  }

  await contentSize(760, 550);
  await page.evaluate(() => window.conflictFixture.configure('zh-CN', false));
  const badge = label => page.getByRole('button', { name: 'invoice.txt：' + label, exact: true });
  const popup = page.getByRole('group', { name: 'invoice.txt同步状态', exact: true });
  await badge('资料冲突').click();
  const actions = popup.getByRole('button');
  assert.deepEqual(await actions.allTextContents(), ['保留云端版本', '保留本地版本', '前往设置']);
  const [cloudBox, localBox, jumpBox] = await Promise.all([0, 1, 2].map(index => actions.nth(index).boundingBox()));
  assert.ok(cloudBox.x < localBox.x && Math.abs(cloudBox.y - localBox.y) < 1 && jumpBox.y > cloudBox.y);
  await actions.nth(0).click();
  await popup.waitFor({ state: 'hidden' });
  assert.deepEqual(await progress(), ['file:invoice/cloud']);
  const syncing = badge('正在同步');
  assert.equal(await syncing.getAttribute('aria-busy'), 'true');
  assert.equal(await syncing.evaluate(el => el === document.activeElement), true);
  const icon = label => badge(label).locator('svg').evaluate(el => el.innerHTML);
  const syncingIcon = await icon('正在同步');
  await page.evaluate(() => window.conflictFixture.settle());
  const doneIcon = await icon('已同步');
  const icons = new Map();
  for (const [status, label] of [
    ['unsynced', '未同步'], ['paused', '已暂停同步'], ['checking', '待核对同步状态'],
    ['deleting', '正在删除'], ['pausing', '正在取消同步'], ['error', '同步失败'], ['conflict', '资料冲突'],
  ]) {
    await page.evaluate(status => window.conflictFixture.badge(status), status);
    icons.set(status, await icon(label));
  }
  for (const state of ['checking', 'deleting', 'pausing']) assert.equal(icons.get(state), syncingIcon);
  assert.equal(icons.get('unsynced'), icons.get('paused'));
  assert.equal(icons.get('error'), icons.get('conflict'));
  assert.equal(new Set([syncingIcon, doneIcon, icons.get('unsynced'), icons.get('error')]).size, 4);

  await page.evaluate(() => window.conflictFixture.configure('zh-CN', false));
  await badge('资料冲突').click();
  await popup.getByRole('button', { name: '前往设置', exact: true }).click();
  await popup.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '查看冲突', exact: true }).click();
  const conflict = page.getByRole('dialog', { name: '资料冲突', exact: true });
  await conflict.getByRole('button', { name: '全选云端', exact: true }).click();
  await page.evaluate(() => window.conflictFixture.changeOwner());
  await conflict.waitFor({ state: 'hidden' });
  assert.deepEqual(await progress(), []);
  await page.evaluate(() => window.conflictFixture.localMode());
  assert.equal(await page.locator('.sync-indicator-button').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: zh-CN/en conflict groups, header bounds, accessible circular choices, stale decisions, partial resolution, badge icons, retry and account isolation.');
} finally {
  await closeUiApp(app);
}
