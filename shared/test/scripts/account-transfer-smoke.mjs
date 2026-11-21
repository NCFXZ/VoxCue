import { evaluateHistory } from './stored-history-fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { assertSettingsHighlight } from './assert-settings-highlight.mjs';
import { assertMenuBackdrop } from './assert-menu-backdrop.mjs';
import { assertPasswordVisibility, assertPasswordClearedOnClose } from './assert-password-visibility.mjs';
import { captureRequested } from './capture-requested.mjs';
import { Store, Auth, Services, loadConfig, createApi, routes } from './server-reference.mjs';

const config = loadConfig({
  AUTH_KEY: 'ab'.repeat(32),
  DATABASE_FILE: path.join(testRoot, 'accounts.sqlite'),
  FEATURE_BACKUPS: '1',
});
const store = new Store(config.database);
const auth = new Auth(store, config, true);
const services = new Services(auth);
const api = createApi(auth, () => {}, routes(services));
const users = ['a', 'b', 'c'].map((name) => ({
  id: randomUUID(),
  email: 'source-' + name + '@example.test',
  masked: 'so***' + name + '@example.test',
  password: 'Synthetic account pass ' + name,
}));
const profileKey = 'copilot-personal-info-v1';
const recordedId = randomUUID();
const screenshotId = randomUUID();
const samplePng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaDgAAAHEAUFzHAXEAAAAAElFTkSuQmCC';
const recordingStart = 1700000000000;
const migrationSubtitle = '迁移后，本机来源账户的所选资料将被删除，云端副本保留。';
let app;
let serverClosed = false;

async function launch(device) {
  const port = api.server.address().port;
  const fixture = path.join(testRoot, 'account-transfer.cjs');
  const base = path.join(workspace.platformRoot, 'dist-electron/shared/electron');
  await writeFile(
    fixture,
    [
      'const { ComponentService } = require(' +
        JSON.stringify(path.join(base, 'backend/components/service.js')) +
        ');',
      'const state = ComponentService.prototype.state;',
      "ComponentService.prototype.status = async function () { const s = state.call(this); return { ...s, phase: 'ready', items: s.items.map(i => ({ ...i, phase: 'ready', received: i.bytes })) }; };",
      'ComponentService.prototype.ready = () => true;',
      'const { KnowledgeHost } = require(' +
        JSON.stringify(path.join(base, 'backend/knowledge/host.js')) +
        ');',
      'KnowledgeHost.prototype.listDocuments = async () => [];',
      'KnowledgeHost.prototype.indexDocument = async ({ documentId }) => ({ documentId });',
      'require(' + JSON.stringify(path.join(base, 'main.js')) + ');',
    ].join('\n'),
  );
  app = await electron.launch({
    args: [await offlineElectronEntry(fixture, { loopbackPort: port })],
    env: {
      ...process.env,
      COPILOT_TEST_USER_DATA: path.join(testRoot, device),
      VOXCUE_ACCOUNT_API: 'http://127.0.0.1:' + port,
      VOXCUE_ACCOUNT_ALLOW_LOCAL: '1',
      VITE_DEV_SERVER_URL: '',
    },
  });
  return app.firstWindow();
}
async function login(page, user) {
  const opened = app.waitForEvent('window');
  if (user) {
    await page.getByLabel('邮箱', { exact: true }).fill(user.email);
    await page.getByLabel('密码', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
  } else await page.getByRole('button', { name: '跳过登录' }).click();
  const main = await opened;
  await main.getByRole('navigation', { name: '主导航' }).waitFor();
  return main;
}
async function logout(page, local = false) {
  const settingsClose = page.getByRole('button', { name: '关闭设置', exact: true });
  if (await settingsClose.isVisible()) await settingsClose.click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  const name = local ? '返回登录' : '退出登录';
  await page.getByRole('menuitem', { name, exact: true }).click();
  const opened = app.waitForEvent('window');
  await page
    .getByRole('dialog', { name, exact: true })
    .getByRole('button', { name, exact: true })
    .click();
  return opened;
}
async function settings(page) {
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
}
function interviewRecord(id, title, imageId) {
  return {
    id,
    title,
    titleStatus: 'ready',
    startedAt: recordingStart,
    endedAt: recordingStart + 2000,
    status: 'ended',
    transcripts: [],
    answers: imageId
      ? [{ id: 'answer', question: 'Synthetic question', content: 'Synthetic answer', images: [{ id: imageId }] }]
      : [],
    mock: false,
  };
}
async function seed(page, name, id = name, imageId, background = '') {
  await evaluateHistory(page,
    async ([profileKey, name, background, record]) => {
      localStorage.setItem(profileKey, JSON.stringify({ name, background, jobDescription: '' }));
      await fixtureHistory.replace([record]);
      window.dispatchEvent(new CustomEvent('voxcue-sync-applied', { detail: 'profile' }));
    },
    [profileKey, name, background, interviewRecord(id, name, imageId)],
  );
}
async function appendRecord(page, id, title) {
  await evaluateHistory(page, async (record) => {
    const records = await fixtureHistory.read();
    await fixtureHistory.replace([...records, record]);
    window.dispatchEvent(new CustomEvent('voxcue-local-change', {
      detail: { kind: 'history', keys: ['record:' + record.id] },
    }));
  }, interviewRecord(id, title));
}
const recordingsForFixture = (page) => page.evaluate(
  (recordId) => window.desktop.recordings({ op: 'list', recordId }), recordedId,
);
const fixtureImage = (page) => page.evaluate((id) => window.desktop.interviewImage({ op: 'read', id }), screenshotId);
function cloudHistory(user) {
  const names = ['record:' + recordedId, 'image:' + screenshotId];
  return services.backups.list(user.id).items.filter((item) => names.includes(item.name));
}
async function seedMedia(user) {
  await app.evaluate(
    async ({ app }, { userId, recordId, start, screenshotId, samplePng }) => {
      const req = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const backend = app.getAppPath() + '/dist-electron/shared/electron/backend/';
      const { RecordingLibrary } = req(backend + 'interview/recordings.js');
      const { InterviewRecording } = req(backend + 'speech/recording.js');
      const library = new RecordingLibrary(
        req('node:path').join(app.getPath('userData'), 'interview-recordings-v1'),
      );
      const clip = new InterviewRecording(
        library.prepare('account:' + userId, recordId, false),
        start,
      );
      clip.append(
        'system',
        Float32Array.from({ length: 32000 }, (_, i) => 0.1 * Math.sin(i / 8)),
        16000,
        start,
      );
      await clip.close(start + 2000);
      const { profileDirectory } = req(backend + '../accountProfilePaths.js');
      const { InterviewImageStore } = req(backend + 'interview/images.js');
      const directory = profileDirectory(app.getPath('userData'), 'account:' + userId);
      const images = new InterviewImageStore(
        req('node:path').join(directory, 'interview-images-v1'),
      );
      await images.save([
        {
          id: screenshotId,
          preview: 'data:image/png;base64,' + samplePng,
          file: { name: 'temporary.png', bytes: Buffer.from(samplePng, 'base64') },
        },
      ]);
      await images.dispose();
    },
    { userId: user.id, recordId: recordedId, start: recordingStart, screenshotId, samplePng },
  );
}
async function playImportedRecording(page) {
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.getByRole('button', { name: '查看面试记录：private-a', exact: true }).click();
  const audio = page.locator('.record-player audio');
  await audio.evaluate((element) => {
    element.muted = true;
  });
  await page.getByRole('button', { name: '播放录音', exact: true }).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('.record-player audio');
    return audio && !audio.error && audio.duration === 2 && audio.currentTime > 0.1;
  });
}
function contents(page) {
  return evaluateHistory(page,
    async (profileKey) => {
      const profile = JSON.parse(localStorage.getItem(profileKey));
      return {
        name: profile?.name || null,
        background: profile?.background || '',
        records: (await fixtureHistory.read()).map((r) => r.id).sort(),
      };
    },
    profileKey,
  );
}
function knowledgeData(page, addBase = null) {
  return page.evaluate((addBase) => new Promise((resolve, reject) => {
    const open = indexedDB.open('copilot-local-documents');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['bases', 'documents'], addBase ? 'readwrite' : 'readonly');
      if (addBase) tx.objectStore('bases').add(addBase);
      const bases = tx.objectStore('bases').getAll();
      const documents = tx.objectStore('documents').getAll();
      tx.oncomplete = () => {
        db.close();
        resolve({
          bases: bases.result.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
          documents: documents.result.map(({ name }) => name),
        });
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  }), addBase);
}
async function migration(page) {
  await page.getByRole('button', { name: '数据迁移', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '数据迁移', exact: true });
  await modal.waitFor();
  assert.equal(await modal.locator('.dialog-subtitle').innerText(), migrationSubtitle);
  return modal;
}
async function checkSourceMenu(page, sources) {
  const modal = await migration(page);
  const trigger = modal.getByRole('button', { name: '来源账号', exact: true });
  await trigger.waitFor();
  await modal.evaluate((el) => Promise.allSettled(el.getAnimations().map(a => a.finished)));
  const before = await modal.boundingBox();
  await trigger.click();
  const menu = page.getByRole('menu');
  const options = menu.getByRole('menuitemradio');
  await options.last().waitFor();
  assert.deepEqual(await options.allTextContents(), sources);
  await page.waitForFunction(() => {
    const menu = document.querySelector('[role="menu"][data-state="open"]');
    return menu && !menu.hasAttribute('data-menu-height-motion') && menu.clientHeight > 0;
  });
  const layout = await menu.evaluate((el) => {
    const row = document.querySelector('.migration-source-row');
    const trigger = row.querySelector('button').getBoundingClientRect();
    const label = row.querySelector('span').getBoundingClientRect();
    const popup = el.getBoundingClientRect();
    const scroll = el.querySelector('.dropdown-scroll');
    const clipped = Array.from(el.querySelectorAll('[role="menuitemradio"]')).filter(item => {
      const { left, right, top, bottom } = item.getBoundingClientRect();
      return [top + 2, bottom - 2].some(y => !item.contains(document.elementFromPoint((left + right) / 2, y)));
    }).map(item => item.textContent);
    return {
      columnLeft: label.right + parseFloat(getComputedStyle(row).columnGap),
      columnRight: row.getBoundingClientRect().right,
      controlWidth: parseFloat(getComputedStyle(row).getPropertyValue('--settings-control-width')),
      trigger: [trigger.left, trigger.right], popup: [popup.left, popup.right],
      overflow: scroll.scrollHeight - scroll.clientHeight, clipped,
    };
  });
  const available = layout.columnRight - layout.columnLeft;
  const expectedWidth = Math.min(available, Math.max(layout.controlWidth, available * 2 / 3));
  for (const [left, right] of [layout.trigger, layout.popup]) {
    assert.ok(Math.abs(right - left - expectedWidth) <= 1 && Math.abs(right - layout.columnRight) <= 1,
      'The source selector and popup must share the right edge and responsive width: ' + JSON.stringify(layout));
  }
  assert.ok(layout.overflow <= 1, 'Three source accounts should fit without scrolling');
  assert.deepEqual(layout.clipped, [], 'Each source row must be fully visible and reachable');
  assert.deepEqual(await modal.boundingBox(), before, 'Opening the source menu must preserve dialog bounds');
  await assertMenuBackdrop(app, page, 'settings');
  await options.last().click();
  assert.equal(await trigger.innerText(), sources.at(-1));
  await page.waitForFunction(() => document.activeElement?.matches('.migration-source-row button'));
  await modal.getByRole('button', { name: '取消', exact: true }).click();
}
async function select(page, source, current, expectedOptions) {
  const modal = await migration(page);
  const trigger = modal.getByRole('button', { name: '来源账号', exact: true });
  await trigger.click();
  const label = source.masked ?? source;
  const option = page.getByRole('menuitemradio', { name: label, exact: true });
  await option.waitFor();
  const options = await page.getByRole('menuitemradio').allTextContents();
  assert.ok(!options.includes(current.masked ?? current));
  assert.ok(options.every((text) => users.every((user) => !text.includes(user.email))));
  if (expectedOptions) assert.deepEqual(options, expectedOptions);
  await option.click();
  assert.equal(await trigger.innerText(), label);
  await modal.getByRole('button', { name: '下一步', exact: true }).click();
  if (source.email) await modal.getByLabel('输入 ' + label + ' 的 VoxCue 密码', { exact: true }).waitFor();
  else await modal.getByRole('button', { name: '确认迁移', exact: true }).waitFor();
  assert.equal(await modal.locator('.dialog-subtitle').innerText(), migrationSubtitle);
  assert.equal(await modal.locator('input[type=password]').count(), Number(!!source.email));
  const prompt = await modal.innerText();
  assert.ok(users.every((user) => !prompt.includes(user.email)));
  return modal;
}
async function confirm(page, modal, replace = false) {
  assert.equal(await modal.locator('.dialog-subtitle').innerText(), migrationSubtitle);
  await modal.getByRole('button', { name: '确认迁移', exact: true }).click();
  if (replace) {
    const warning = page.getByRole('dialog', { name: '替换冲突资料' });
    await warning.getByRole('button', { name: '替换并迁移', exact: true }).click();
  }
  await modal.waitFor({ state: 'hidden' });
  await page.getByText('资料已迁移。', { exact: true }).waitFor();
}
async function assertConflictGroups(warning, expected) {
  await warning.waitFor();
  assert.deepEqual(await warning.getByRole('heading', { level: 3 }).allTextContents(), Object.keys(expected));
  for (const [group, titles] of Object.entries(expected)) {
    const list = warning.getByRole('list', { name: group, exact: true });
    assert.deepEqual(await list.getByRole('listitem').allTextContents(), titles);
  }
}
async function selectBackgroundOnly(modal) {
  await modal.getByRole('checkbox', { name: '面试记录 (部分冲突)', exact: true }).uncheck();
  await modal.getByRole('checkbox', { name: '知识库 (部分冲突)', exact: true }).uncheck();
  await modal.getByRole('checkbox', { name: '(冲突) 姓名', exact: true }).uncheck();
  await modal.getByRole('checkbox', { name: '个人信息', exact: true }).waitFor();
  assert.ok(await modal.getByRole('checkbox', { name: '简历摘要', exact: true }).isChecked());
}
async function checkCappedExpansion(modal) {
  const sizes = await modal.evaluate(async dialog => {
    const toggle = dialog.querySelector('.migration-group .selection-toggle');
    const height = () => dialog.getBoundingClientRect().height;
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const start = height();
    const limit = start + 40;
    dialog.style.maxHeight = limit + 'px';
    try {
      toggle.click();
      await frame();
      // Sample the real layout at fixed points so slow test machines do not skip frames.
      const transitions = dialog.getAnimations({ subtree: true });
      for (const animation of transitions) animation.pause();
      const sample = progress => {
        for (const animation of transitions)
          animation.currentTime = progress * animation.effect.getComputedTiming().endTime;
        return height();
      };
      const quarter = sample(0.25);
      const half = sample(0.5);
      const end = sample(1);
      for (const animation of transitions) animation.finish();
      await frame();
      toggle.click();
      await frame();
      await Promise.allSettled(dialog.getAnimations({ subtree: true }).map(a => a.finished));
      return { start, limit, quarter, half, end, collapsed: height() };
    } finally {
      dialog.style.removeProperty('max-height');
    }
  });
  const { start, limit, quarter, half, end, collapsed } = sizes;
  assert.ok(Math.abs(end - limit) < 1 && Math.abs(collapsed - start) < 1,
    'Expansion must reach the available height and collapse back: ' + JSON.stringify(sizes));
  assert.ok(quarter > start && half > quarter && end - half > 1 && quarter - start > end - half,
    'The dialog must decelerate toward its capped height: ' + JSON.stringify(sizes));
}
async function checkSelectionHeader(page, modal) {
  // Give the expanded fixture the same overflow as a longer list of records.
  const limit = await page.addStyleTag({ content: '.account-migration-dialog { max-height: 300px; }' });
  const scroll = modal.locator(':scope > .dialog-scroll');
  try {
    await page.waitForFunction(() =>
      document.querySelector('.account-migration-dialog[data-scrollable] .migration-groups'));
    await modal.evaluate(el =>
      Promise.allSettled(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    await scroll.evaluate(el => { el.scrollTop = 0; });
    await page.waitForFunction(() => {
      const heading = document.querySelector('.account-migration-dialog > .dialog-heading');
      return getComputedStyle(heading, '::before').opacity === '0';
    });
    const heading = modal.locator(':scope > .dialog-heading');
    const top = (await heading.boundingBox()).y;
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForFunction(() => {
      const heading = document.querySelector('.account-migration-dialog > .dialog-heading');
      return getComputedStyle(heading, '::before').opacity === '1';
    });
    const layout = await modal.evaluate(dialog => {
      const header = dialog.querySelector('.dialog-heading');
      const area = dialog.querySelector('.dialog-scroll');
      const rect = header.getBoundingClientRect();
      const trackStart = parseFloat(getComputedStyle(area, '::-webkit-scrollbar-track').marginTop);
      const layer = getComputedStyle(header, '::before');
      const settings = getComputedStyle(document.querySelector('.settings-content-heading'), '::before');
      return {
        top: rect.top, height: rect.height, trackStart,
        clear: rect.right <= area.getBoundingClientRect().left + area.clientWidth + 1,
        material: [layer.backgroundColor, layer.backdropFilter],
        settingsMaterial: [settings.backgroundColor, settings.backdropFilter],
      };
    });
    assert.ok(Math.abs(layout.top - top) < 1 && layout.trackStart >= layout.height - 1 && layout.clear,
      'The fixed migration header must clear the scrollbar: ' + JSON.stringify(layout));
    assert.deepEqual(layout.material, layout.settingsMaterial);
    assert.match(layout.material[1], /blur\(/);
    await page.emulateMedia({ contrast: 'more' });
    assert.ok(await heading.evaluate(el => {
      const layer = getComputedStyle(el, '::before');
      return layer.backdropFilter === 'none' && layer.backgroundColor === getComputedStyle(el.closest('dialog')).backgroundColor;
    }), 'High contrast must use the solid dialog surface');
  } finally {
    await page.emulateMedia({ contrast: 'no-preference' });
    await scroll.evaluate(el => { el.scrollTop = 0; });
    await limit.evaluate(el => el.remove());
  }
}
const localNotice = (page) => page.getByRole('complementary', { name: '本地资料提醒' });

try {
  for (const user of users)
    store.addUser({
      id: user.id,
      email: user.email,
      created_at: Date.now(),
      password_hash: await auth.passwords.hash(user.password),
    });
  await services.start();
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  const [a, b, c] = users;
  const emptyAccount = { name: null, background: '', records: [] };
  let main = await login(await launch('device-one'));
  assert.equal(await localNotice(main).count(), 0);
  await seed(main, 'local-only', 'local-only', undefined, 'Leave this on the local account');
  main = await login(await logout(main, true), a);
  assert.deepEqual(await contents(main), emptyAccount);
  await localNotice(main).getByRole('button', { name: '前往设置' }).click();
  const importRow = main.locator('[data-settings-target="account-migration"]');
  await main.waitForFunction(() => {
    const row = document.querySelector(
      '[data-settings-target="account-migration"][data-location-highlight]',
    );
    const bounds = row?.getBoundingClientRect();
    const panel = row?.closest('.settings-content-body')?.getBoundingClientRect();
    return (
      row?.contains(document.activeElement) &&
      bounds &&
      panel &&
      bounds.top >= panel.top &&
      bounds.bottom <= panel.bottom
    );
  });
  await importRow.getByRole('button').waitFor();
  await assertSettingsHighlight(importRow);
  let modal = await select(main, '本地账户', a);
  await modal.getByRole('button', { name: '展开个人信息', exact: true }).click();
  await modal.getByRole('checkbox', { name: '简历摘要', exact: true }).uncheck();
  await confirm(main, modal);
  assert.deepEqual(await contents(main), { name: 'local-only', background: '', records: ['local-only'] });
  await localNotice(main).waitFor({ state: 'detached' });
  await seed(main, 'private-a', recordedId, screenshotId, 'Synthetic background');
  await seedMedia(a);
  await main.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.getByRole('textbox', { name: '聊天消息' }).fill('A 的私有草稿');
  await main.getByRole('button', { name: '知识库', exact: true }).click();
  await main.getByRole('button', { name: '创建知识库', exact: true }).first().click();
  const editor = main.getByRole('dialog', { name: '创建知识库', exact: true });
  await editor.getByLabel('知识库名称', { exact: true }).fill('A 的资料库');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  const library = main.getByRole('dialog', { name: 'A 的资料库', exact: true });
  await library.getByLabel('导入知识库文档').setInputFiles({
    name: 'private-a.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A personal reference'),
  });
  await library.getByText('private-a.txt', { exact: true }).waitFor();
  await library.getByRole('button', { name: '关闭对话框', exact: true }).click();
  const sourceKnowledge = await knowledgeData(main);
  const sourceBase = sourceKnowledge.bases.find((base) => base.name === 'A 的资料库');
  assert.ok(sourceBase);
  await settings(main);
  await main.getByRole('switch', { name: '同步面试记录', exact: true }).click();
  await main.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.getByRole('button', { name: 'private-a：已同步', exact: true }).waitFor();
  const cloudBeforeMove = cloudHistory(a);
  assert.equal(cloudBeforeMove.length, 2);
  assert.ok(cloudBeforeMove.every((item) => item.revision > 0 && item.headVersion && item.sha256));
  main = await login(await logout(main), b);
  assert.deepEqual(await contents(main), emptyAccount);
  assert.deepEqual(await recordingsForFixture(main), []);
  const dismissNotice = localNotice(main).getByRole('button', { name: '不再提醒本地资料迁移' });
  await main.mouse.move(0, 0);
  assert.equal(
    await dismissNotice.evaluate((button) => getComputedStyle(button).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await localNotice(main).getByRole('button', { name: '前往设置' }).press('Tab');
  assert.deepEqual(
    await dismissNotice.evaluate((button) => ({
      focused: button.matches(':focus-visible'),
      fill: getComputedStyle(button).backgroundColor,
      outline: getComputedStyle(button).outlineStyle,
    })),
    { focused: true, fill: 'rgba(0, 0, 0, 0)', outline: 'solid' },
  );
  await dismissNotice.hover();
  await main.waitForFunction(() => {
    const button = document.querySelector('aside button:hover');
    return button && getComputedStyle(button).backgroundColor !== 'rgba(0, 0, 0, 0)';
  });
  await dismissNotice.click();
  await localNotice(main).waitFor({ state: 'detached' });
  assert.equal(await main.getByRole('textbox', { name: '聊天消息' }).inputValue(), '');
  await main.getByRole('button', { name: '知识库', exact: true }).click();
  await main.getByRole('button', { name: '创建知识库', exact: true }).first().waitFor();
  assert.equal(await main.locator('.knowledge-card').filter({ hasText: 'A 的资料库' }).count(), 0);
  await seed(main, 'private-b');
  await appendRecord(main, recordedId, 'B 的面试');
  await knowledgeData(main, { ...sourceBase, name: 'B 的资料库' });
  const originalB = { name: 'private-b', background: '', records: [recordedId, 'private-b'].sort() };
  const allConflicts = { 个人信息: ['姓名'], 面试记录: ['private-a'], 知识库: ['A 的资料库'] };
  await settings(main);
  modal = await select(main, a, b);
  const layout = await modal.evaluate((dialog) => {
    const rect = (selector) => dialog.querySelector(selector).getBoundingClientRect();
    const title = rect('.dialog-heading h2'), subtitle = rect('.dialog-subtitle');
    const close = rect('.dialog-close-button'), label = rect('.cloud-account-form > label');
    return {
      centerOffset: (title.top + subtitle.bottom - close.top - close.bottom) / 2,
      passwordGap: label.top - subtitle.bottom,
    };
  });
  assert.ok(Math.abs(layout.centerOffset) <= 1, 'The heading and close button must share a center line');
  assert.ok(layout.passwordGap >= 8 && layout.passwordGap <= 20, 'Keep the password prompt close to the subtitle');
  const sourceLabel = '输入 ' + a.masked + ' 的 VoxCue 密码';
  const firstSource = modal.getByLabel(sourceLabel, { exact: true });
  await assertPasswordVisibility(modal, firstSource, a.password);
  await captureRequested(modal, 'VoxCue-1.3.0-migration-password');
  await assertPasswordClearedOnClose(modal, firstSource, () =>
    modal.getByRole('button', { name: '取消', exact: true }).click());
  assert.deepEqual(await contents(main), originalB);
  modal = await select(main, a, b);
  const source = modal.getByLabel(sourceLabel, { exact: true });
  assert.equal(await source.getAttribute('type'), 'password');
  assert.equal(await source.inputValue(), '');
  assert.equal(await modal.getByRole('button', { name: '显示密码', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.ok(await modal.getByRole('button', { name: '验证密码', exact: true }).isDisabled());
  await source.fill(b.password);
  await modal.getByRole('button', { name: '验证密码' }).click();
  await modal.getByRole('alert').waitFor();
  assert.deepEqual(await contents(main), originalB);
  await source.fill(a.password);
  await modal.getByRole('button', { name: '验证密码' }).click();
  await modal.getByRole('button', { name: '确认迁移', exact: true }).waitFor();
  assert.deepEqual(await contents(main), originalB);
  assert.equal(await modal.locator('.dialog-subtitle').innerText(), migrationSubtitle);
  await modal.getByRole('checkbox', { name: /个人信息.*部分冲突/ }).waitFor();
  await checkCappedExpansion(modal);
  for (const [group, child] of [
    ['个人信息', '(冲突) 姓名'],
    ['面试记录', '(冲突) private-a'],
    ['知识库', '(冲突) A 的资料库'],
  ]) {
    await modal.getByRole('button', { name: '展开' + group, exact: true }).click();
    assert.ok(await modal.getByRole('checkbox', { name: child, exact: true }).isChecked());
  }
  await checkSelectionHeader(main, modal);
  await modal.getByRole('button', { name: '确认迁移', exact: true }).click();
  let warning = main.getByRole('dialog', { name: '替换冲突资料' });
  await assertConflictGroups(warning, allConflicts);
  await warning.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(await contents(main), originalB);
  await selectBackgroundOnly(modal);

  // Change the selected target field after preview to force a real commit failure.
  const setBackground = (page, value) => page.evaluate(([key, background]) => {
    const current = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...current, background }));
  }, [profileKey, value]);
  await setBackground(main, 'Edited on B after preview');
  await modal.getByRole('button', { name: '确认迁移', exact: true }).click();
  await modal.getByText('迁移期间本地资料已更改，请重试。', { exact: true }).waitFor();
  assert.deepEqual(await contents(main), { ...originalB, background: 'Edited on B after preview' });
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  main = await login(await logout(main), a);
  assert.deepEqual(await contents(main), {
    name: 'private-a', background: 'Synthetic background', records: [recordedId],
  });
  assert.deepEqual(await knowledgeData(main), sourceKnowledge);
  assert.equal((await fixtureImage(main)).ok, true);
  assert.ok((await recordingsForFixture(main)).length);

  main = await login(await logout(main), b);
  await setBackground(main, '');
  await settings(main);
  modal = await select(main, a, b);
  await modal.locator('input[type=password]').fill(a.password);
  await modal.getByRole('button', { name: '验证密码' }).click();
  await modal.getByRole('button', { name: '展开个人信息', exact: true }).click();
  await selectBackgroundOnly(modal);
  await confirm(main, modal);
  assert.deepEqual(await contents(main), { ...originalB, background: 'Synthetic background' });
  const partialKnowledge = await knowledgeData(main);
  assert.equal(partialKnowledge.bases.find((base) => base.id === sourceBase.id)?.name, 'B 的资料库');
  assert.deepEqual(partialKnowledge.documents, []);

  modal = await select(main, a, b);
  await modal.locator('input[type=password]').fill(a.password);
  await modal.getByRole('button', { name: '验证密码' }).click();
  await modal.getByRole('button', { name: '展开个人信息', exact: true }).click();
  assert.equal(await modal.getByRole('checkbox', { name: '简历摘要', exact: true }).count(), 0);
  for (const group of Object.keys(allConflicts))
    await modal.getByRole('checkbox', { name: group + ' (部分冲突)', exact: true }).waitFor();
  await modal.getByRole('button', { name: '确认迁移', exact: true }).click();
  warning = main.getByRole('dialog', { name: '替换冲突资料' });
  await assertConflictGroups(warning, allConflicts);
  await warning.getByRole('button', { name: '取消', exact: true }).click();
  await modal.getByRole('checkbox', { name: '面试记录 (部分冲突)', exact: true }).uncheck();
  await modal.getByRole('checkbox', { name: '面试记录', exact: true }).waitFor();
  await modal.getByRole('button', { name: '确认迁移', exact: true }).click();
  await assertConflictGroups(warning, { 个人信息: ['姓名'], 知识库: ['A 的资料库'] });
  await warning.getByRole('button', { name: '取消', exact: true }).click();
  await modal.getByRole('checkbox', { name: '面试记录', exact: true }).check();
  await confirm(main, modal, true);
  const migratedImage = await fixtureImage(main);
  assert.equal(migratedImage.dataUrl, 'data:image/png;base64,' + samplePng);
  assert.equal(
    (await main.evaluate(() => window.desktop.cloudAccount({ action: 'status' }))).state.user.id,
    b.id,
  );
  assert.deepEqual(await contents(main), {
    name: 'private-a',
    background: 'Synthetic background',
    records: [recordedId, 'private-b'].sort(),
  });
  await main.getByRole('button', { name: '关闭设置', exact: true }).click();
  await playImportedRecording(main);
  await main.getByRole('button', { name: '知识库', exact: true }).click();
  await main.locator('.knowledge-card').filter({ hasText: 'A 的资料库' }).click();
  await main
    .getByRole('dialog', { name: 'A 的资料库' })
    .getByText('private-a.txt', { exact: true })
    .waitFor();
  await main
    .getByRole('dialog', { name: 'A 的资料库' })
    .getByRole('button', { name: '关闭对话框' })
    .click();
  main = await login(await logout(main), a);
  assert.deepEqual(await contents(main), emptyAccount);
  const remainingKnowledge = await knowledgeData(main);
  assert.ok(!remainingKnowledge.bases.some((base) => base.id === sourceBase.id));
  assert.deepEqual(remainingKnowledge.documents, []);
  assert.equal((await fixtureImage(main)).ok, false);
  assert.deepEqual(await recordingsForFixture(main), []);
  assert.equal(await localNotice(main).count(), 0);
  await main.waitForFunction(
    () => document.querySelector('[aria-label="聊天消息"]')?.value === 'A 的私有草稿',
  );
  // A fresh upload from A proves that its normal history sync has run after the move.
  const newSourceRecord = randomUUID();
  await appendRecord(main, newSourceRecord, '迁移后新增的面试');
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.getByRole('button', { name: '迁移后新增的面试：已同步', exact: true }).waitFor();
  assert.deepEqual(cloudHistory(a), cloudBeforeMove);
  assert.deepEqual(await contents(main), { ...emptyAccount, records: [newSourceRecord] });
  main = await login(await logout(main));
  assert.deepEqual(await contents(main), {
    name: null, background: 'Leave this on the local account', records: [],
  });
  await settings(main);
  const chooseB = await select(main, b, '本地账户', [a.masked, b.masked]);
  await chooseB.getByRole('button', { name: '取消', exact: true }).click();
  await main.getByRole('button', { name: '关闭设置', exact: true }).click();
  await seed(main, 'local-updated');
  main = await login(await logout(main, true), a);
  await localNotice(main).getByRole('button', { name: '前往设置' }).waitFor();
  assert.deepEqual(await contents(main), { ...emptyAccount, records: [newSourceRecord] });
  assert.deepEqual(cloudHistory(a), cloudBeforeMove);
  const readLocalRevision = (page) => page.evaluate(async () =>
    (await window.desktop.cloudAccount({ action: 'status' })).state.localImportRevision,
  );
  const newRevision = await readLocalRevision(main);
  assert.ok(newRevision);
  main = await login(await logout(main), b);
  assert.equal(await readLocalRevision(main), newRevision);
  assert.equal(await localNotice(main).count(), 0);
  main = await login(await logout(main), c);
  await settings(main);
  await checkSourceMenu(main, ['本地账户', a.masked, b.masked]);
  await closeUiApp(app);
  app = undefined;
  main = await login(await launch('device-two'), a);
  assert.deepEqual(await contents(main), emptyAccount);
  assert.equal(await localNotice(main).count(), 0);
  await settings(main);
  const empty = await migration(main);
  await empty.getByText('这台设备上没有其他可迁移的账户。', { exact: true }).waitFor();
  assert.equal(await empty.getByRole('button', { name: '来源账号', exact: true }).count(), 0);
  await empty.getByRole('button', { name: '取消', exact: true }).click();
  await main.getByRole('button', { name: '关闭设置', exact: true }).click();
  await seed(main, 'offline-source');
  await api.close();
  serverClosed = true;
  main = await login(await logout(main));
  await settings(main);
  const offline = await select(main, a, '本地账户');
  await offline.locator('input[type=password]').fill(b.password);
  await offline.getByRole('button', { name: '验证密码' }).click();
  await offline.getByText('来源账号的离线迁移密码不正确。', { exact: true }).waitFor();
  assert.equal((await contents(main)).name, null);
  await offline.locator('input[type=password]').fill(a.password);
  await offline.getByRole('button', { name: '验证密码' }).click();
  await confirm(main, offline);
  assert.deepEqual(await contents(main), { name: 'offline-source', background: '', records: ['offline-source'] });
  const movedOffline = await select(main, a, '本地账户');
  await movedOffline.locator('input[type=password]').fill(a.password);
  await movedOffline.getByRole('button', { name: '验证密码' }).click();
  await movedOffline.getByText('这个账户在本机没有可迁移的资料。', { exact: true }).waitFor();
  assert.ok(await movedOffline.getByRole('button', { name: '确认迁移', exact: true }).isDisabled());
  await movedOffline.getByRole('button', { name: '取消', exact: true }).click();
  console.log(
    'PASS account isolation, local and password-protected moves, selective source removal, cancellation and failed commit, conflict groups, original documents and recordings, preserved cloud versions after sync, and offline migration',
  );
} catch (error) {
  if (app)
    for (const page of app.windows())
      console.error(
        await page
          .getByRole('alert')
          .allTextContents()
          .catch(() => []),
      );
  throw error;
} finally {
  if (app) await closeUiApp(app);
  if (!serverClosed) await api.close();
  await services.close();
  auth.passwords.pool.close();
  store.close();
}
