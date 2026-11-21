import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from '../../../shared/scripts/workspace.mjs';
import config from '../../../shared/vite.config.mjs';
import { electron, testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';

const { build } = await import(pathToFileURL(workspace.platformRequire.resolve('vite')).href);
const entry = path.join(testRoot, 'index.html');
const profile = path.join(testRoot, 'profile');
await mkdir(profile);
await writeFile(entry, '<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="./ui.tsx"></script></html>');
await writeFile(path.join(testRoot, 'ui.tsx'), 'import ' +
  JSON.stringify(path.join(workspace.platformRoot, 'test/fixtures/sync-conflicts.tsx')) + ';');
await build({
  ...config, configFile: false, root: testRoot, publicDir: false, logLevel: 'error',
  build: { target: 'esnext', outDir: path.join(testRoot, 'dist'), rollupOptions: { input: entry } },
});
const host = path.join(testRoot, 'entry.cjs');
await writeFile(host, `const { app, BrowserWindow } = require('electron');
app.setPath('userData',${JSON.stringify(profile)});
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 760, height: 590, webPreferences: {
    contextIsolation: true, sandbox: true, nodeIntegration: false
  } });
  win.loadFile(${JSON.stringify(path.join(testRoot, 'dist/index.html'))});
});`);
const app = await electron.launch({ args: [host], env: {
  ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '', ELECTRON_RUN_AS_NODE: undefined,
} });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => console.error(error.message));
  const notice = page.getByRole('complementary', { name: '资料冲突' });
  await notice.getByText('有 4 条资料在本地与云端存在冲突。').waitFor();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const button = settings.getByRole('button', { name: '查看冲突', exact: true });
  const list = page.getByRole('dialog', { name: '资料冲突', exact: true });
  const save = list.getByRole('button', { name: '保留所选版本' });
  const header = list.locator(':scope > .dialog-heading');
  async function checkHeaderButtons() {
    const buttons = header.getByRole('button');
    const names = await buttons.evaluateAll(els => els.map(el => el.getAttribute('aria-label') || el.textContent));
    assert.deepEqual(names, ['全选云端', '全选本地', '关闭对话框']);
    assert.equal(await header.locator('button.ui-button').count(), 3);
    assert.deepEqual(await buttons.locator('svg[aria-hidden="true"]').evaluateAll(icons =>
      icons.map(icon => icon.getAttribute('data-sf-icon'))), ['CloudDone', 'Monitor', 'X']);
    const [dialog, title, subtitle, cloud, local, close] = await Promise.all([
      list.boundingBox(), header.getByRole('heading').boundingBox(),
      header.getByText('选择需要保留的资料。', { exact: true }).boundingBox(),
      ...[0, 1, 2].map(i => buttons.nth(i).boundingBox()),
    ]);
    assert.equal(dialog.width, Math.min(560, (await page.evaluate(() => innerWidth)) * 0.9));
    assert.ok(subtitle.y >= title.y + title.height && Math.abs(subtitle.x - title.x) < 1);
    const titleBlockCenter = (title.y + subtitle.y + subtitle.height) / 2;
    assert.ok(Math.abs(titleBlockCenter - (close.y + close.height / 2)) < 1);
    assert.ok(title.x + title.width <= cloud.x && cloud.x + cloud.width < local.x &&
      local.x + local.width < close.x && close.x + close.width <= dialog.x + dialog.width);
    assert.ok([cloud, local].every(box => Math.abs(box.y + box.height / 2 - close.y - close.height / 2) < 1));
  }
  const openDialog = async () => { await button.click(); await list.waitFor(); };
  const chosen = () => page.evaluate(() => window.fixtureChoices);
  const reset = () => page.evaluate(() => window.conflictTest.reset());
  const finish = (failed) => page.evaluate(failed => window.conflictTest.finish(failed), failed);
  async function checkTarget() {
    await page.waitForFunction(() => document.activeElement?.closest('[data-settings-target="sync-conflicts"]') &&
      document.activeElement.textContent.trim() === '查看冲突');
  }
  await notice.getByRole('button', { name: /前往设置/ }).click();
  await checkTarget();
  await settings.getByRole('button', { name: '关闭设置' }).click();
  const badge = page.getByRole('button', { name: /^合成文件：资料冲突$/ });
  const menu = page.getByRole('group', { name: '合成文件同步状态' });
  const aggregate = page.getByRole('button', { name: /^汇总资料库：资料冲突$/ });
  const aggregateMenu = page.getByRole('group', { name: '汇总资料库同步状态' });
  async function checkResolving(name, popover) {
    await popover.waitFor({ state: 'hidden' });
    const trigger = page.getByRole('button', { name: name + '：正在同步', exact: true });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.getAttribute('aria-busy'), 'true');
    assert.ok(await trigger.evaluate(el => el === document.activeElement));
    const icon = trigger.locator('svg[data-sf-icon="CloudSync"]');
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      assert.equal(await icon.evaluate(el => getComputedStyle(el).animationName),
        reducedMotion === 'reduce' ? 'none' : 'sync-pulse');
    }
    await trigger.press('Enter');
    await popover.getByText('正在同步', { exact: true }).waitFor();
    assert.equal(await popover.getByRole('button').count(), 0);
    await page.keyboard.press('Escape');
    await popover.waitFor({ state: 'hidden' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  for (const [side, label] of [['cloud', '保留云端版本'], ['local', '保留本地版本']]) {
    await aggregate.click();
    assert.deepEqual(await aggregateMenu.getByRole('button').allTextContents(), ['保留云端版本', '保留本地版本', '前往设置']);
    await aggregateMenu.getByRole('button', { name: label }).click();
    await checkResolving('汇总资料库', aggregateMenu);
    assert.deepEqual(await chosen(), ['base:aggregate/' + side]);
    await finish();
    await page.getByRole('button', { name: '汇总资料库：已同步', exact: true }).waitFor();
    await reset();
  }
  await badge.click();
  await menu.getByText('资料冲突', { exact: true }).waitFor();
  assert.deepEqual(await menu.getByRole('button').allTextContents(), ['保留云端版本', '保留本地版本', '前往设置']);
  const [cloudButton, localButton, linkButton] = await Promise.all((await menu.getByRole('button').all()).map(el => el.boundingBox()));
  assert.ok(cloudButton.x < localButton.x && Math.abs(cloudButton.y - localButton.y) <= 1 && linkButton.y > cloudButton.y);
  await menu.getByRole('button', { name: '前往设置' }).click();
  await checkTarget();
  assert.ok(!(await menu.isVisible()));
  await settings.getByRole('button', { name: '关闭设置' }).click();
  for (const [side, label] of [['cloud', '保留云端版本'], ['local', '保留本地版本']]) {
    await badge.click();
    await page.evaluate(() => window.conflictTest.rejectNext());
    await menu.getByRole('button', { name: label }).click();
    await menu.getByRole('status').filter({ hasText: '未能提交所选版本，请核对后重试。' }).waitFor();
    assert.deepEqual(await chosen(), []);
    await menu.getByRole('button', { name: label }).click();
    await checkResolving('合成文件', menu);
    assert.deepEqual(await chosen(), ['file:file/' + side]);
    await finish();
    await reset();
  }
  await notice.getByRole('button', { name: /前往设置/ }).click();
  await settings.getByText('有 4 条资料在本地与云端存在冲突。', { exact: true }).waitFor();
  await settings.getByText('有 1 条资料未能同步。', { exact: true }).waitFor();
  const row = settings.locator('[data-settings-target="sync-conflicts"]');
  assert.ok(await row.evaluate(el => {
    const heading = el.querySelector('strong').getBoundingClientRect();
    const subtitle = el.querySelector('p').getBoundingClientRect();
    const action = el.querySelector('button').getBoundingClientRect();
    return heading.top < subtitle.top && heading.left === subtitle.left && subtitle.right <= action.left + 1;
  }));
  assert.equal(await button.locator('svg[data-sf-symbol]').count(), 1);
  const material = el => {
    const style = getComputedStyle(el, '::before');
    return [style.backgroundColor, style.backdropFilter];
  };
  const settingsMaterial = await settings.locator('.settings-content-heading').evaluate(material);
  await openDialog();
  for (const name of ['个人信息', '系统设计面试',
    '合成面试库', '汇总资料库'])
    await list.getByRole('group', { name, exact: true }).waitFor();
  assert.equal(await list.getByText('个人信息', { exact: true }).count(), 2);
  assert.equal(await list.getByText(/设计文档\.txt|实现说明\.txt|截图 ·|简历原件|简历\.pdf/).count(), 0);
  await checkHeaderButtons();
  assert.equal(await save.isEnabled(), false);
  const library = list.getByRole('group', { name: '汇总资料库', exact: true });
  assert.deepEqual(await library.locator('label').allTextContents(), ['云端', '本地']);
  assert.equal(await list.locator('time').count(), 0);
  assert.equal(await list.getByText(/修改时间|\d{4}年/).count(), 0);
  await list.getByText('云端没有这份资料，选择云端会移除本地副本。').waitFor();
  const libraryCloud = library.getByRole('radio', { name: '云端' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const toggle of await list.locator('h3 .selection-toggle').all()) {
    assert.ok(await toggle.evaluate(el => {
      const title = el.querySelector('span').getBoundingClientRect();
      const arrow = el.querySelector('svg').getBoundingClientRect();
      return arrow.left >= title.right && arrow.left - title.right <= 10;
    }));
  }
  for (const row of await list.locator('.sync-version-list li').all()) {
    assert.ok(await row.evaluate(el => {
      const name = el.querySelector('.sync-item-name').getBoundingClientRect();
      const [cloud, local] = [...el.querySelectorAll('label')].map(label => label.getBoundingClientRect());
      return cloud.top >= name.bottom && Math.abs(cloud.top - local.top) <= 1 &&
        Math.abs(cloud.left - name.left) <= 1 && local.left - cloud.right >= 12;
    }));
  }
  const dot = el => {
    const style = getComputedStyle(el, '::before');
    return { radius: getComputedStyle(el).borderRadius, round: style.borderRadius, mask: style.maskImage,
      opacity: style.opacity, motion: style.transitionProperty, duration: style.transitionDuration };
  };
  const off = await libraryCloud.evaluate(dot);
  assert.equal(off.radius, '50%');
  assert.equal(off.round, '50%');
  assert.equal(off.mask, 'none');
  assert.equal(off.opacity, '0');
  assert.ok(off.motion.includes('transform') && off.duration.split(',').some(time => parseFloat(time) > 0));
  // The app uses superellipses for most controls. A 50% radius alone produces
  // a rounded square there. Compare the painted ring/dot to both actual curves.
  async function assertPaintedCircle() {
    const capture = async () => {
      const png = await libraryCloud.screenshot({ scale: 'css', animations: 'disabled' });
      return app.evaluate(({ nativeImage }, data) =>
        [...nativeImage.createFromBuffer(Buffer.from(data, 'base64')).toBitmap()], png.toString('base64'));
    };
    const pixels = await capture();
    for (const shape of ['round', 'superellipse(2)']) {
      const override = await page.addStyleTag({ content:
        `.sync-version-choice input[type=radio], .sync-version-choice input[type=radio]::before { corner-shape: ${shape} !important; }` });
      try {
        const reference = await capture();
        const changed = reference.filter((value, index) => Math.abs(value - pixels[index]) > 12).length;
        assert.ok(shape === 'round' ? changed === 0 : changed > 6, JSON.stringify({ shape, changed }));
      } finally { await override.evaluate(el => el.remove()); }
    }
  }
  await assertPaintedCircle();
  await libraryCloud.check();
  await libraryCloud.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
  assert.ok(await libraryCloud.evaluate(el => getComputedStyle(el, '::before').opacity === '1'));
  await assertPaintedCircle();
  await page.keyboard.press('ArrowRight');
  assert.ok(await library.getByRole('radio', { name: '本地' }).isChecked());
  await libraryCloud.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
  assert.equal((await libraryCloud.evaluate(dot)).opacity, '0');
  assert.equal((await library.getByRole('radio', { name: '本地' }).evaluate(dot)).opacity, '1');
  for (const [group, sample] of [['知识库', '汇总资料库'], ['个人信息', '个人信息'], ['面试记录', '系统设计面试']]) {
    await list.getByRole('button', { name: '收起' + group }).click();
    assert.equal(await list.getByRole('group', { name: sample, exact: true }).count(), 0);
    await list.getByRole('button', { name: '展开' + group }).click();
    await list.getByRole('group', { name: sample, exact: true }).waitFor();
  }
  assert.ok(await library.getByRole('radio', { name: '本地' }).isChecked());
  await list.getByRole('button', { name: '取消' }).click();
  await list.waitFor({ state: 'hidden' });
  assert.deepEqual(await chosen(), []);
  await openDialog();
  assert.equal(await save.isEnabled(), false);
  await library.getByRole('radio', { name: '本地' }).check();
  await save.click();
  await list.waitFor({ state: 'hidden' });
  assert.deepEqual(await chosen(), ['base:aggregate/local']);
  await settings.getByText('有 3 条资料在本地与云端存在冲突。', { exact: true }).waitFor();
  await openDialog();
  assert.equal(await library.count(), 0);
  const cloud = list.getByRole('radio', { name: '云端', exact: true });
  const local = list.getByRole('radio', { name: '本地', exact: true });
  await list.getByRole('button', { name: '全选云端' }).click();
  assert.equal(await cloud.evaluateAll(els => els.filter(el => el.checked).length), 3);
  await list.getByRole('button', { name: '全选本地' }).click();
  assert.equal(await local.evaluateAll(els => els.filter(el => el.checked).length), 3);
  await page.evaluate(() => window.conflictTest.replace('record:interview'));
  const record = list.getByRole('group', { name: '系统设计面试', exact: true });
  assert.equal(await record.getByRole('radio', { name: '本地' }).isChecked(), false);
  await page.evaluate(() => window.conflictTest.rejectNext());
  await save.click();
  await list.getByRole('alert').waitFor();
  assert.deepEqual(await chosen(), ['base:aggregate/local']);
  assert.equal(await list.getByRole('group', { name: '个人信息', exact: true }).getByRole('radio', { name: '本地' }).isChecked(), true);
  await save.click();
  await list.waitFor({ state: 'hidden' });
  assert.deepEqual((await chosen()).sort(), ['base:aggregate/local', 'profile:main/local', 'base:base/local'].sort());
  await settings.getByText('有 1 条资料在本地与云端存在冲突。', { exact: true }).waitFor();
  await finish('profile:main');
  await settings.getByText('有 2 条资料在本地与云端存在冲突。', { exact: true }).waitFor();
  await openDialog();
  await list.getByText('资料已变化，请重新选择要保留的版本。', { exact: true }).waitFor();
  assert.equal(await save.isEnabled(), false);
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'hidden' });
  await reset();
  await (await app.browserWindow(page)).evaluate(win => win.setContentSize(580, 440));
  await openDialog();
  await checkHeaderButtons();
  const footer = list.locator(':scope > .modal-footer');
  const before = await footer.boundingBox();
  const headerBefore = await header.boundingBox();
  await list.locator(':scope > .dialog-scroll').evaluate(el => { el.scrollTop = 56; });
  await page.waitForFunction(() => {
    const heading = document.querySelector('.sync-problem-dialog[open] > .dialog-heading');
    return heading && Number(getComputedStyle(heading, '::before').opacity) > 0;
  });
  assert.deepEqual(await header.evaluate(material), settingsMaterial);
  assert.ok(Math.abs((await header.boundingBox()).y - headerBefore.y) < 1);
  const firstGroup = await list.locator('.sync-version-group').first().boundingBox();
  assert.ok(firstGroup.y < headerBefore.y + headerBefore.height && firstGroup.y + firstGroup.height > headerBefore.y);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await local.first().evaluate(el => getComputedStyle(el, '::before').transitionDuration), '0s');
  assert.ok(await library.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await local.last().scrollIntoViewIfNeeded();
  const after = await footer.boundingBox();
  assert.ok(Math.abs(before.y - after.y) < 1 && after.y + after.height <= 441);
  await list.getByRole('button', { name: '全选云端' }).click();
  await save.click();
  await list.waitFor({ state: 'hidden' });
  assert.equal((await chosen()).length, 4);
  assert.equal(await button.count(), 0);
  await finish();
  await settings.getByRole('button', { name: '查看错误', exact: true }).click();
  const errors = page.getByRole('dialog', { name: '同步失败', exact: true });
  await errors.getByText('云端数据大小无效。', { exact: true }).waitFor();
  assert.equal(await errors.getByRole('button', { name: /^全选/ }).count(), 0);
  assert.equal(await errors.getByRole('listitem').count(), 1);
  await page.keyboard.press('Escape');
  await reset();
  await openDialog();
  await list.getByRole('button', { name: '全选本地' }).click();
  await page.evaluate(() => window.conflictTest.switchOwner());
  await list.waitFor({ state: 'hidden' });
  assert.deepEqual(await chosen(), []);
  console.log('PASS: grouped local names, Mac conflict notice and badge navigation, native radio selection, partial and batch resolution, changed versions, owner change and narrow-window footer.');
} finally { await closeUiApp(app); }
