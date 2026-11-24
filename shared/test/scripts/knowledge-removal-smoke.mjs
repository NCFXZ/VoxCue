import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp, connectUiAccount, installUiAccount } from './install-ui-account.mjs';
import { waitForAsync } from './wait-for-async.mjs';

const profile = path.join(testRoot, 'knowledge-removals');
let app;

async function open(mode) {
  app = await electron.launch({
    args: [await offlineElectronEntry()],
    env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
  });
  await installUiAccount(app, { components: true });
  await app.evaluate(({ app }, mode) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { KnowledgeHost } = require(app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js');
    const { KnowledgeCoordinator } = require(app.getAppPath() + '/dist-electron/shared/electron/application/knowledge.js');
    const { KNOWLEDGE_INDEX_VERSION } = require(app.getAppPath() + '/dist-electron/shared/electron/contracts/knowledge.js');
    const index = new Map();
    let staged = [];
    const publish = (host, documents) => {
      for (const doc of documents) index.set(doc.documentId, doc);
      for (const doc of documents) host.progress({
        documentId: doc.documentId, indexVersion: doc.indexVersion, phase: 'ready', completed: 1, total: 1,
      });
    };
    KnowledgeHost.prototype.initialize = async () => {};
    KnowledgeHost.prototype.listDocuments = async () => [...index.values()];
    KnowledgeHost.prototype.beginIndexBatch = async () => { staged = []; };
    KnowledgeHost.prototype.finishIndexBatch = async function (_id, commit) {
      if (commit) publish(this, staged);
      staged = [];
    };
    KnowledgeHost.prototype.indexDocument = async function ({ documentId, baseId, name, batchId }, signal) {
      if (name === '取消中的索引.txt') {
        this.progress({ documentId, phase: 'embedding', completed: 1, total: 2 });
        await new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            globalThis.syntheticIndexCancelled = true;
            reject(signal.reason);
          }, { once: true });
        });
      }
      const document = { documentId, baseId, name, available: true, indexVersion: KNOWLEDGE_INDEX_VERSION };
      if (batchId) staged.push(document);
      else publish(this, [document]);
      return document;
    };
    globalThis.syntheticRemovalCalls = [];
    KnowledgeHost.prototype.removeDocument = async (id) => {
      globalThis.syntheticRemovalCalls.push(['file', id]);
      index.delete(id);
      // Simulate a quit after the index write, before its acknowledgement.
      if (mode === 'interrupt') await new Promise(() => {});
      return null;
    };
    KnowledgeHost.prototype.removeBase = async (id) => {
      const retry = globalThis.syntheticRemovalCalls.some(([kind]) => kind === 'base');
      globalThis.syntheticRemovalCalls.push(['base', id]);
      if (mode === 'resume' && !retry) throw Error('合成索引暂时无法删除。');
      for (const doc of index.values()) if (doc.baseId === id) index.delete(doc.documentId);
      return null;
    };
    const call = KnowledgeCoordinator.prototype.call;
    KnowledgeCoordinator.prototype.call = async function (input) {
      const result = await call.call(this, input);
      return input.op === 'status' ? { ...result, modelReady: true } : result;
    };
  }, mode);
  const page = await connectUiAccount(app, await app.firstWindow());
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  return page;
}

const keep = '合成保留库';
const erase = '合成待删库';
const removing = '正在删除…';
const card = (page, name) => page.locator('.knowledge-card').filter({ hasText: name });
const detail = (page, name) => page.getByRole('dialog', { name, exact: true });
const close = (dialog) => dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
async function deleteLibrary(page, name) {
  await card(page, name).click();
  const dialog = detail(page, name);
  await dialog.getByRole('button', { name: '删除知识库', exact: true }).click();
  await dialog.getByRole('button', { name: `确认删除：知识库：${name}`, exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}
const importFiles = async (dialog, names) => {
  await dialog.getByLabel('导入知识库文档', { exact: true }).setInputFiles(names.map(name => ({
    name, mimeType: 'text/plain', buffer: Buffer.from('Synthetic deletion recovery fixture ' + name),
  })));
  for (const name of names) await dialog.getByText(name, { exact: true }).waitFor();
};
async function create(page, name, names) {
  await page.locator('.page-toolbar').getByRole('button', { name: '创建知识库', exact: true }).click();
  await page.getByLabel('知识库名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  if (names.length) await importFiles(detail(page, name), names);
  await close(detail(page, name));
}

try {
  const page = await open('interrupt');
  const beforeExit = app.process().pid;
  const indexing = '合成正在索引库';
  await create(page, indexing, ['取消中的索引.txt', '同批文件.txt']);
  await card(page, indexing).getByText(/索引总进度/).waitFor();
  await deleteLibrary(page, indexing);
  await card(page, indexing).waitFor({ state: 'detached' });
  assert.equal(await app.evaluate(() => globalThis.syntheticIndexCancelled), true);
  await app.evaluate(() => { globalThis.syntheticRemovalCalls = []; });
  console.log('Deleting a library with an active index batch cancels that batch and completes.');
  await create(page, erase, ['整库删除样本.txt']);
  await create(page, keep, ['删除样本.txt', '保留样本.txt']);
  await card(page, keep).click();
  const library = detail(page, keep);
  await library.getByRole('button', { name: '删除文档 删除样本.txt', exact: true }).click();
  await library.getByRole('button', { name: '确认删除：文档：删除样本.txt', exact: true }).click();
  await library.getByRole('status').filter({ hasText: removing }).waitFor();
  assert.equal(await library.getByRole('button', { name: '选择文件', exact: true }).isEnabled(), true);
  await importFiles(library, ['操作仍可继续.txt']);
  await library.locator('.document-row').filter({ hasText: '操作仍可继续.txt' }).getByText(/索引完成/).waitFor();
  await close(library);
  await deleteLibrary(page, erase);
  await card(page, erase).getByText(removing, { exact: true }).waitFor();
  assert.equal(await card(page, keep).isEnabled(), true);
  const empty = '合成新建空库';
  await create(page, empty, []);
  await card(page, empty).click();
  const blank = detail(page, empty);
  await blank.getByRole('button', { name: '删除知识库', exact: true }).click();
  const started = performance.now();
  await blank.getByRole('button', { name: `确认删除：知识库：${empty}`, exact: true }).click();
  await card(page, empty).waitFor({ state: 'detached', timeout: 3000 });
  console.log(`Empty library disappeared after ${Math.round(performance.now() - started)} ms with old cleanup still held.`);
  assert.deepEqual(await app.evaluate(() => globalThis.syntheticRemovalCalls.map(([kind]) => kind)), ['file']);
  console.log('A held index deletion leaves the close button, imports and other libraries available.');

  await closeUiApp(app);
  app = undefined;
  const restarted = await open('resume');
  assert.notEqual(app.process().pid, beforeExit);
  await restarted.getByRole('alert').filter({ hasText: '合成索引暂时无法删除。' }).waitFor();
  await waitForAsync(restarted, async () => {
    const request = indexedDB.open('voxcue-knowledge-removals');
    return new Promise(resolve => {
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        const keys = db.transaction('removals').objectStore('removals').getAllKeys();
        keys.onsuccess = () => { db.close(); resolve(keys.result.length === 1 && keys.result[0].startsWith('base:')); };
        keys.onerror = () => { db.close(); resolve(false); };
      };
    });
  });
  assert.deepEqual(await app.evaluate(() => globalThis.syntheticRemovalCalls.map(([kind]) => kind)), ['base', 'file']);
  await restarted.getByRole('button', { name: '重试删除', exact: true }).click();
  await card(restarted, erase).waitFor({ state: 'detached' });
  await card(restarted, keep).click();
  const retained = detail(restarted, keep);
  await retained.getByText('保留样本.txt', { exact: true }).waitFor();
  await retained.getByText('操作仍可继续.txt', { exact: true }).waitFor();
  assert.equal(await retained.getByText('删除样本.txt', { exact: true }).count(), 0);
  assert.deepEqual(await app.evaluate(() => globalThis.syntheticRemovalCalls.map(([kind]) => kind)), ['base', 'file', 'base']);
  console.log('A fresh process resumes both deletions. A failed library stays queued and succeeds on retry.');
} finally {
  if (app) await closeUiApp(app);
}
