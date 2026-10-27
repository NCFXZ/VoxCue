import { connectUiAccount } from './install-ui-account.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/knowledge-files-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [await offlineElectronEntry()], env });
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
    KnowledgeHost.prototype.indexDocument = async ({ documentId }) => ({ documentId });
    KnowledgeHost.prototype.invalidateDocument = async () => null;
    KnowledgeHost.prototype.removeDocument = async () => null;
  });
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page
    .getByRole('button', { name: /创建知识库/ })
    .first()
    .click();
  await page.getByLabel('知识库名称', { exact: true }).fill('原件管理回归');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  let base = page.getByRole('dialog', { name: '原件管理回归', exact: true });
  const upload = async (text) => {
    await base.getByLabel('导入知识库文档').setInputFiles([
      { name: 'note.md', mimeType: 'text/markdown', buffer: Buffer.from(text) },
      {
        name: 'document.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('retained original bytes'),
      },
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.document-row').length === 2);
    await base.getByRole('button', { name: '选择文件', exact: true }).waitFor({ state: 'visible' });
    await waitForAsync(
      page,
      async (expected) => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open('copilot-local-documents', 1);
          r.onsuccess = () => resolve(r.result);
        });
        const docs = await new Promise((resolve) => {
          const r = db.transaction('documents').objectStore('documents').getAll();
          r.onsuccess = () => resolve(r.result);
        });
        db.close();
        return (await docs.find((d) => d.name === 'note.md')?.blob.text()) === expected;
      },
      text,
    );
  };
  await upload('第一版');
  await upload('第二版');
  const note = () => base.locator('.document-row').filter({ hasText: 'note.md' });
  assert.equal(
    await base.getByRole('button', { name: /^(预览|取消准备|重新准备|准备用于回答)$/ }).count(),
    0,
  );
  assert.equal(await note().locator('.document-actions button').count(), 2);
  assert.equal(await page.evaluate(() => 'retrieval' in window.desktop), false);
  await page.screenshot({ animations: 'disabled' });
  await base.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('知识库名称', { exact: true }).fill('保留的知识库');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '保留的知识库', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-card').filter({ hasText: '保留的知识库' }).click();
  base = page.getByRole('dialog', { name: '保留的知识库', exact: true });
  await base.locator('.document-row').filter({ hasText: 'document.pdf' }).waitFor();
  const bytes = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('copilot-local-documents', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const request = db.transaction('documents').objectStore('documents').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return await rows.find((row) => row.name === 'document.pdf').blob.text();
  });
  assert.equal(bytes, 'retained original bytes');
  await base.getByRole('button', { name: '删除文档 note.md', exact: true }).click();
  await base.getByRole('button', { name: '确认删除：文档：note.md', exact: true }).click();
  await note().waitFor({ state: 'detached' });
  await base.getByRole('button', { name: '删除知识库', exact: true }).click();
  const confirm = base.getByRole('button', { name: '确认删除：知识库：保留的知识库', exact: true });
  assert.equal(await confirm.evaluate((button) => button === document.activeElement), true);
  await confirm.press('Escape');
  await base.getByRole('button', { name: '删除知识库', exact: true }).click();
  await confirm.click();
  await base.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      profile,
      passed: [
        'import',
        'same-name replacement',
        'text preview',
        'Office/PDF original preservation',
        'reload',
        'rename',
        'document removal',
        'base deletion confirmation',
        'removed IPC',
      ],
    }),
  );
} catch (error) {
  const page = app.windows().at(-1);
  if (page && !page.isClosed()) {
    await page.screenshot({});
    console.log((await page.locator('body').innerText()).slice(-2200));
  }
  throw error;
} finally {
  await closeUiApp(app);
}
