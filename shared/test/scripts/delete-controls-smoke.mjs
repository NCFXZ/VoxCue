import { waitForAsync } from './wait-for-async.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { verifyContinuousCorners } from './continuous-corners.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const directory = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/delete-controls-')));
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: directory, VITE_DEV_SERVER_URL: '' },
});
const checks = [],
  errors = [];
const settle = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );

async function observeDeleteMorph(control, trigger) {
  await control.evaluate((button) => {
    const measure = () => ({
      idle: Number(getComputedStyle(button.querySelector('.confirm-delete-idle')).opacity),
      confirm: Number(getComputedStyle(button.querySelector('.confirm-delete-confirm')).opacity),
    });
    const frames = [measure()];
    const armed = button.classList.contains('is-confirming');
    globalThis.deleteMorph = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (button.classList.contains('is-confirming') === armed) return;
        observer.disconnect();
        const started = performance.now();
        const sample = () => {
          frames.push(measure());
          const running = button
            .getAnimations({ subtree: true })
            .some((animation) => animation.playState === 'running' || animation.pending);
          if ((running && performance.now() - started < 1000) || frames.length < 3)
            requestAnimationFrame(sample);
          else resolve(frames);
        };
        requestAnimationFrame(sample);
      });
      observer.observe(button, { attributes: true, attributeFilter: ['class'] });
    });
  });
  await trigger();
  const frames = await control.page().evaluate(() => globalThis.deleteMorph);
  assert(frames.some(({ idle, confirm }) => idle > 0 && idle < 1 && confirm > 0 && confirm < 1));
  assert.deepEqual(frames.at(-1), { idle: frames[0].confirm, confirm: frames[0].idle });
}

try {
  await installUiAccount(app, { components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { KnowledgeHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js',
    );
    KnowledgeHost.prototype.initialize = async () => {};
    KnowledgeHost.prototype.listDocuments = async () => [];
    KnowledgeHost.prototype.invalidateDocument = async () => null;
    KnowledgeHost.prototype.removeDocument = async () => null;
  });
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '今天想准备哪一部分面试？', exact: true }).waitFor();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await waitForAsync(page, async () =>
    (await indexedDB.databases()).some(({ name }) => name === 'copilot-local-documents'),
  );
  await page.evaluate(async () => {
    localStorage.setItem(
      'copilot-personal-info-v1',
      JSON.stringify({
        name: '合成候选人',
        background: '合成简历摘要',
        jobDescription: '合成 JD 摘要',
        customInstructions: '自然口语回答',
        skills: [
          {
            id: 'skill',
            title: '合成技能',
            content: '仅用于交互回归。',
            sources: [{ title: '测试来源', url: 'https://example.com/docs' }],
          },
        ],
      }),
    );
    localStorage.setItem('copilot-interview-knowledge-base-v1', JSON.stringify('delete-base-1'));
    localStorage.setItem(
      'copilot-interview-history-v1',
      JSON.stringify([
        {
          id: 'delete-record',
          title: '合成面试记录',
          startedAt: 1000,
          endedAt: 5000,
          status: 'ended',
          mock: false,
          transcripts: [],
          answers: [],
        },
      ]),
    );
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('copilot-local-documents', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['bases', 'documents'], 'readwrite');
      for (const [id, name] of [
        ['delete-base-1', '待删资料'],
        ['delete-base-2', '保留资料'],
      ])
        tx.objectStore('bases').put({ id, name, createdAt: 1 });
      for (const [id, baseId, name] of [
        ['delete-doc-1', 'delete-base-1', '待删.md'],
        ['delete-doc-2', 'delete-base-2', '保留.md'],
        ['legacy-resume', 'personal-resume', '旧简历.txt'],
      ])
        tx.objectStore('documents').put({
          id,
          baseId,
          name,
          type: 'text/plain',
          size: 16,
          createdAt: 1,
          blob: new Blob(['Synthetic original only']),
        });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  const info = page.getByRole('button', { name: '个人信息', exact: true });
  const panel = page.getByRole('complementary', { name: '个人信息', exact: true });
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1')));
  const first = (target) => panel.getByRole('button', { name: '删除：' + target, exact: true });
  const second = (target) => page.getByRole('button', { name: '确认删除：' + target, exact: true });
  await info.click();
  await settle(page);
  for (const label of ['简历摘要', '职位描述摘要', '自定义指令', '面试技能'])
    await panel.locator(`details[aria-label="${label}"] > summary`).click();
  await settle(page);
  const resume = first('简历摘要');
  await resume.scrollIntoViewIfNeeded();
  const before = await resume.boundingBox();
  const scroll = await panel.locator('.personal-panel-scroll').evaluate((e) => e.scrollTop);
  const handle = await resume.elementHandle();
  await resume.click();
  assert.equal((await saved()).background, '合成简历摘要');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await panel.getByRole('region', { name: '确认删除资料', exact: true }).count(), 0);
  assert.equal(await panel.locator('.personal-panel-scroll').evaluate((e) => e.scrollTop), scroll);
  const confirm = second('简历摘要');
  assert.equal(await confirm.evaluate((e, previous) => e === previous, handle), true);
  assert.equal(await confirm.evaluate((e) => e.classList.contains('button-destructive')), true);
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="确认删除：简历摘要"]')?.getBoundingClientRect().width >=
      111.5,
  );
  await settle(page);
  const after = await confirm.boundingBox();
  assert(Math.abs(before.y - after.y) < 1);
  assert(Math.abs(before.x + before.width - after.x - after.width) < 1);
  assert.equal(await confirm.evaluate((e) => getComputedStyle(e).fontSize), '14px');
  await page.screenshot({ animations: 'disabled' });
  await resume.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal((await saved()).background, '合成简历摘要');
  checks.push(
    'same button, position and scroll; smooth width, red confirmation and three-second cancellation',
  );
  await resume.click();
  await confirm.press('Escape');
  await resume.click();
  await panel.getByLabel('姓名', { exact: true }).focus();
  await resume.waitFor();
  await resume.click();
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  await info.click();
  await resume.waitFor();
  assert.equal((await saved()).background, '合成简历摘要');
  await panel.getByLabel('姓名', { exact: true }).fill('未保存姓名');
  await resume.click();
  await confirm.click();
  assert.equal((await saved()).background, '');
  assert.equal(await panel.getByLabel('姓名', { exact: true }).inputValue(), '未保存姓名');
  assert.equal((await saved()).name, '合成候选人');
  await panel
    .locator('.personal-save-bar')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  assert.equal(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('copilot-interview-knowledge-base-v1')),
    ),
    'delete-base-1',
  );
  await page.getByText('已保留原件：旧简历.txt', { exact: true }).waitFor();
  checks.push(
    'Escape, blur and drawer close cancel; confirming deletes only the chosen summary and preserves drafts/originals/knowledge selection',
  );
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.restoreDeleteStorage = () => (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (key, value) {
      if (key === 'copilot-personal-info-v1') throw Error('Synthetic quota');
      return original.call(this, key, value);
    };
  });
  await first('职位描述摘要').click();
  await second('职位描述摘要').click();
  await panel.getByText('删除失败，请重试。', { exact: true }).waitFor();
  await settle(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await settle(page);
    await verifyContinuousCorners(page, `delete-error-${theme}`);
    await page.screenshot({ animations: 'disabled' });
  }
  assert.equal((await saved()).jobDescription, '合成 JD 摘要');
  await page.evaluate(() => globalThis.restoreDeleteStorage());
  await first('职位描述摘要').click();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 680));
  await page.waitForFunction(() => innerWidth <= 970);
  await page.screenshot({ animations: 'disabled' });
  await second('职位描述摘要').click();
  assert.equal((await saved()).jobDescription, '');
  await first('自定义指令').click();
  await second('自定义指令').click();
  assert.equal((await saved()).customInstructions, '');
  const skills = panel.locator('details[aria-label="面试技能"]');
  await skills.locator('.profile-entry > summary').click();
  await skills.getByRole('button', { name: '删除技能：合成技能', exact: true }).click();
  await second('技能：合成技能').click();
  assert.deepEqual((await saved()).skills, []);
  checks.push(
    'failed storage keeps content and supports retry; instructions and skills use the same control in narrow dark layout',
  );
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: '附件.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic attachment'),
  });
  await page.getByRole('button', { name: '移除附件 附件.txt', exact: true }).click();
  assert.equal(await page.locator('.chat-attachment').count(), 1);
  await second('附件：附件.txt').click();
  assert.equal(await page.locator('.chat-attachment').count(), 0);
  await page.getByRole('button', { name: '移除简历', exact: true }).click();
  assert.equal(await page.locator('.resume-chip').count(), 1);
  await second('简历原件：旧简历.txt').click();
  await page.locator('.resume-chip').waitFor({ state: 'detached' });
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('未发送待删除对话');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  const row = page.locator('.conversation-row').filter({ hasText: '未发送待删除对话' });
  await row.hover();
  await row.getByRole('button', { name: '删除对话：未发送待删除对话', exact: true }).click();
  await page.waitForFunction(() => {
    const r = document
      .querySelector('[aria-label="确认删除：对话：未发送待删除对话"]')
      ?.getBoundingClientRect();
    return r && r.width >= 99.5 && r.width <= 100.5;
  });
  assert.equal(
    await second('对话：未发送待删除对话').locator('.confirm-delete-confirm svg').count(),
    1,
  );
  await page.locator('.sidebar').screenshot({ animations: 'disabled' });
  await second('对话：未发送待删除对话').press('Escape');
  await row.getByRole('button', { name: '删除对话：未发送待删除对话', exact: true }).click();
  await second('对话：未发送待删除对话').click();
  await row.waitFor({ state: 'detached' });
  checks.push(
    'attachments, preserved resume originals and conversations require a second click on the initiating button',
  );
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-card').filter({ hasText: '待删资料' }).click();
  const base = page.getByRole('dialog', { name: '待删资料', exact: true });
  await base.getByText('待删.md', { exact: true }).waitFor();
  await page.evaluate(() => {
    globalThis.documentDeleteCalls = {};
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'documents')
        globalThis.documentDeleteCalls[key] = (globalThis.documentDeleteCalls[key] || 0) + 1;
      return original.call(this, key);
    };
  });
  await base.getByRole('button', { name: '删除文档 待删.md', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await base.locator('.document-row').count(), 1);
  await second('文档：待删.md').click();
  await base.locator('.document-row').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => globalThis.documentDeleteCalls['delete-doc-1']), 1);
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  const deleteBase = base.getByRole('button', { name: '删除知识库', exact: true });
  const baseButton = await deleteBase.elementHandle();
  await observeDeleteMorph(deleteBase, () => deleteBase.click());
  assert.equal(
    await second('知识库：待删资料').evaluate((e, previous) => e === previous, baseButton),
    true,
  );
  await page.screenshot({ animations: 'disabled' });
  await observeDeleteMorph(second('知识库：待删资料'), () =>
    second('知识库：待删资料').press('Escape'),
  );
  assert.equal(await base.isVisible(), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await deleteBase.click();
  assert.equal(
    await second('知识库：待删资料').evaluate((e) => e.getAnimations({ subtree: true }).length),
    0,
  );
  await second('知识库：待删资料').press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await observeDeleteMorph(deleteBase, () => deleteBase.click());
  checks.push(
    'knowledge confirmation and cancellation crossfade on the same button in light/dark themes; reduced motion remains immediate',
  );
  await page.screenshot({ animations: 'disabled' });
  await second('知识库：待删资料').click();
  await base.waitFor({ state: 'detached' });
  await page
    .locator('.knowledge-card')
    .filter({ hasText: '待删资料' })
    .waitFor({ state: 'detached' });
  assert.equal(await page.locator('.knowledge-card').count(), 1);
  await page.locator('.knowledge-card').filter({ hasText: '保留资料' }).click();
  const retained = page.getByRole('dialog', { name: '保留资料', exact: true });
  await retained.getByText('保留.md', { exact: true }).waitFor();
  await retained.getByRole('button', { name: '关闭对话框', exact: true }).click();
  checks.push(
    'document deletion executes once; knowledge deletion stays in its original header and cannot delete another base',
  );
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.locator('.history-row').filter({ hasText: '合成面试记录' }).click();
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await second('面试记录：合成面试记录').press('Escape');
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  await second('面试记录：合成面试记录').click();
  await page.getByRole('heading', { name: '还没有面试记录', exact: true }).waitFor();
  checks.push('interview history uses the same inline confirmation and cancel behavior');
  assert.deepEqual(errors, []);
  await console.log(
    JSON.stringify(
      {
        checks,
        errors,
        scope:
          'Isolated synthetic account/documents/knowledge port; real UI and local storage. No real user data or inference.',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ directory, checks, errors }));
} catch (error) {
  const page = app.windows().at(-1);
  if (page && !page.isClosed()) await page.screenshot({});
  throw error;
} finally {
  await closeUiApp(app);
}
