import { evaluateHistory } from './stored-history-fixture.mjs';
import { enterDemoUiAccount, installUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { createServer } = workspace.platformRequire('vite');
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = path.resolve(path.join(testRoot, 'test/results'), `smoke-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const dev = process.argv.includes('--dev');
const server = dev
  ? await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } })
  : undefined;
await server?.listen();
const app = await electron.launch({
  args: [dev ? '.' : await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: profile,
    VITE_DEV_SERVER_URL: dev ? 'http://127.0.0.1:5174' : '',
  },
});
try {
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  const page = await enterDemoUiAccount(app, login);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.locator('.welcome h1').waitFor();
  assert.deepEqual(await page.evaluate(async () => ({
    provider: (await window.desktop.authSession())?.mode,
    account: (await window.desktop.cloudAccount({ action: 'status' })).state.user,
  })), { provider: 'demo', account: null });
  assert.equal(await page.evaluate(() => typeof window.desktop?.windowAction), 'function');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.locator('.interview-start-trigger').isDisabled(), true);
  await page.screenshot({});
  await page.getByRole('button', { name: '用户菜单' }).click();
  assert.equal(await page.getByRole('menuitem').count(), 2);
  await page.getByRole('menuitem', { name: '设置' }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  assert.equal(
    await page.locator('html').evaluate((element) => element.classList.contains('dark')),
    true,
  );
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.screenshot({});
  await page
    .getByRole('textbox', { name: '聊天消息' })
    .fill('姓名：测试用户\n岗位：前端工程师\nJD：负责 React 桌面应用');
  await page.getByRole('button', { name: '发送消息' }).click();
  await page.getByRole('button', { name: '保存所选', exact: true }).click();
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '测试用户');
  assert.equal(await page.getByLabel('目标岗位', { exact: true }).count(), 0);
  await page.getByLabel('姓名', { exact: true }).fill('测试用户修改');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  // Existing original remains independent of generated summaries; isolated fixture only.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('copilot-local-documents');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put({
        id: 'legacy-resume',
        baseId: 'personal-resume',
        name: 'resume.txt',
        type: 'text/plain',
        size: 32,
        createdAt: 1,
        blob: new Blob(['Synthetic preserved original']),
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await installUiAccount(app, { components: true });
  await page.reload();
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  const resumeSection = page.locator('details[aria-label="简历摘要"]');
  assert.equal(await resumeSection.getAttribute('open'), null);
  await resumeSection.locator('summary').click();
  await page.getByText('已保留原件：resume.txt', { exact: true }).waitFor();
  await page.screenshot({});
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.getByRole('heading', { name: '还没有面试记录' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '查看示例记录', exact: true }).count(), 0);
  // Seed isolated real-shaped records; mock records remain hidden and stored.
  await evaluateHistory(page, async () => {
    const records = [1, 2].map((i) => ({
      id: 'record-' + i,
      title: '回归测试问题 ' + i,
      startedAt: 1000 * i,
      endedAt: 5000 + i,
      status: 'ended',
      mock: false,
      transcripts: [],
      answers: [
        {
          id: 'answer-' + i,
          question: '回归测试问题 ' + i,
          content: 'Synthetic saved answer',
          provider: 'chatgpt',
        },
      ],
    }));
    records.push({
      id: 'legacy-mock',
      title: 'Hidden mock record',
      startedAt: 5000,
      endedAt: 6000,
      status: 'ended',
      mock: true,
      transcripts: [],
      answers: [],
    });
    await fixtureHistory.replace(records);
  });
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.locator('.history-row').nth(1).waitFor();
  assert.equal(await page.locator('.history-row').count(), 2);
  await page.screenshot({});
  await page
    .locator('.history-row')
    .first()
    .locator('.history-row-open')
    .click({ position: { x: 16, y: 16 } });
  await page.getByText('回归测试问题 2', { exact: false }).first().waitFor();
  await page.screenshot({});
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: '创建知识库', exact: false }).first().click();
  await page
    .getByRole('dialog', { name: '创建知识库', exact: true })
    .getByLabel('知识库名称')
    .fill('前端项目资料');
  await page
    .getByRole('dialog', { name: '创建知识库', exact: true })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  const baseDialog = page.getByRole('dialog', { name: '前端项目资料', exact: true });
  await baseDialog.getByLabel('导入知识库文档').setInputFiles([
    {
      name: 'project.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 项目介绍\n使用 React 构建桌面应用'),
    },
    { name: 'job.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mock document') },
  ]);
  await baseDialog.getByText('project.md', { exact: true }).waitFor();
  await baseDialog.getByText('job.pdf', { exact: true }).waitFor();
  if (await baseDialog.getByRole('button', { name: '预览', exact: true }).count())
    throw Error('文档列表仅保留删除操作');
  await baseDialog.getByLabel('导入知识库文档').setInputFiles({
    name: 'blocked.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('invalid'),
  });
  await baseDialog
    .getByRole('alert')
    .getByText('不支持的文件格式：blocked.exe', { exact: true })
    .waitFor();
  assert.equal(await baseDialog.locator('.document-row').count(), 2);
  await baseDialog.getByRole('button', { name: '重命名', exact: true }).click();
  await page
    .getByRole('dialog', { name: '重命名知识库' })
    .getByLabel('知识库名称')
    .fill('React 面试资料');
  await page
    .getByRole('dialog', { name: '重命名知识库' })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'React 面试资料', exact: true })
    .getByRole('button', { name: '关闭对话框' })
    .click();
  await page.reload();
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '测试用户修改');
  assert.equal(await resumeSection.getAttribute('open'), null);
  await resumeSection.locator('summary').click();
  await page.getByText('已保留原件：resume.txt', { exact: true }).waitFor();
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-card').filter({ hasText: 'React 面试资料' }).click();
  const savedDialog = page.getByRole('dialog', { name: 'React 面试资料', exact: true });
  await savedDialog.getByText('project.md', { exact: true }).waitFor();
  assert.equal(await savedDialog.locator('.document-row').count(), 2);
  await page.screenshot({});
  await savedDialog.getByRole('button', { name: '删除文档 job.pdf', exact: true }).click();
  const deleteDocument = savedDialog.getByRole('button', {
    name: '确认删除：文档：job.pdf',
    exact: true,
  });
  assert.equal(
    await deleteDocument.evaluate((element) => element === document.activeElement),
    true,
  );
  await deleteDocument.press('Escape');
  assert.equal(await savedDialog.locator('.document-row').count(), 2);
  await savedDialog.getByRole('button', { name: '删除文档 job.pdf', exact: true }).click();
  await deleteDocument.click();
  await page.waitForFunction(() => document.querySelectorAll('.document-row').length === 1);
  await savedDialog.getByRole('button', { name: '关闭对话框' }).click();
  await page.screenshot({});
  await page.locator('.knowledge-card').filter({ hasText: 'React 面试资料' }).click();
  await savedDialog.getByRole('button', { name: '删除知识库', exact: true }).click();
  await savedDialog
    .getByRole('button', { name: '确认删除：知识库：React 面试资料', exact: true })
    .click();
  await page.getByRole('heading', { name: '创建你的第一个知识库' }).waitFor();
  await evaluateHistory(page, async () =>
    await fixtureHistory.replace([
      {
        id: 'test-record',
        title: '测试记录',
        startedAt: 100,
        endedAt: 1000,
        status: 'ended',
        mock: false,
        transcripts: [],
        answers: [],
      },
    ]),
);
await page.reload();
await page.getByRole('button', { name: '面试记录', exact: true }).click();
await page
  .locator('.history-row')
  .filter({ hasText: '测试记录' })
  .locator('.history-row-open')
  .click({ position: { x: 16, y: 16 } });
await page.getByRole('button', { name: '删除记录' }).click();
await page.getByRole('button', { name: '确认删除：面试记录：测试记录', exact: true }).click();
await page.getByRole('heading', { name: '还没有面试记录' }).waitFor();
await page.getByRole('button', { name: '新对话', exact: true }).click();
await page.getByRole('button', { name: '用户菜单' }).click();
const [returnedLogin] = await Promise.all([
  app.waitForEvent('window'),
  (async () => {
    await page.getByRole('menuitem', { name: '退出登录' }).click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
  })(),
]);
  await returnedLogin.getByRole('heading', { name: '登录 VoxCue' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Electron startup, unified shell, internal synthetic preparation reply, profile/resume persistence, independent history, knowledge CRUD/import/preview/persistence and user menu.',
  );
} catch (error) {
  const page = app.windows()[0];
  if (page) {
    await page.screenshot({});
    console.error(await page.locator('main:visible').innerText());
  }
  throw error;
} finally {
  await closeUiApp(app);
  await server?.close();
}
