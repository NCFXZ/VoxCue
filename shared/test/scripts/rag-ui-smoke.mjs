import { closeUiApp, enterPrimaryUiAccount, waitForRestoredMainWindow } from './install-ui-account.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { testRoot, electron } from './test-workspace.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import fixtures from './rag-fixtures.cjs';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/rag-ui-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ args: ['.'], env });
let app = await launch();
try {
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  let page = await enterPrimaryUiAccount(app, login);
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page
    .getByRole('button', { name: /创建知识库/ })
    .first()
    .click();
  await page.getByLabel('知识库名称', { exact: true }).fill('RAG 本地集成');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const base = page.getByRole('dialog', { name: 'RAG 本地集成', exact: true });
  assert.equal(
    await base.getByLabel('知识库检索问题').count(),
    0,
    'Retired manual search stays out of the document management layout',
  );
  assert.equal(await base.locator('select').count(), 0);
  const marker = randomUUID();
  const files = [
    {
      name: 'handover.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        `## Q001. Where is the archive handover receipt stored?\n\nThe archive handover receipt is in locker ${marker}.\n\n### 追问 1：怎样核对交接？\n\n核对两份回执上的交接编号 ${marker}。`,
      ),
    },
    { name: 'labels.pdf', mimeType: 'application/pdf', buffer: fixtures.pdf([`Ceramic label batch ${marker}.`]) },
    { name: 'receipt.doc', mimeType: 'application/msword',
      buffer: fixtures.doc(`合成发货收据的内部编号是 ${marker}。`) },
    { name: 'delivery.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: await fixtures.docx([`The delivery tray carries the unique label ${marker}.`]) },
    {
      name: 'schedule.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        `排练使用蓝色手钟开始，排练编号为 ${marker}。`,
      ),
    },
  ];
  await base.getByLabel('导入知识库文档').setInputFiles(files);
  const indexStatus = () => window.desktop.knowledge({ op: 'status' });
  try {
    await waitForAsync(page, indexStatus, undefined, {
      timeout: 120000,
      matches: (r) => r.ok && r.value.documents?.length === files.length && r.value.tasks.every((t) => t.phase === 'ready'),
    });
  } catch (error) {
    const status = await page.evaluate(indexStatus);
    const rows = await base.locator('.document-row').allTextContents();
    const alerts = await page.getByRole('alert').allTextContents();
    const components = await page.evaluate(() => window.desktop.components({ op: 'status' }));
    console.error('Isolated import did not finish:', JSON.stringify({ status, rows, alerts, components: components.items.map(({ id, phase }) => ({ id, phase })) }));
    throw error;
  }
  assert.equal(await base.locator('.document-row').count(), files.length);
  assert.equal(await base.getByText(/索引完成/).count(), files.length);
  // The manual search/preview UI was retired. Keep real indexed retrieval
  // coverage at its public IPC port; import/status/persistence remain UI checks.
  async function checkEvidence(mode) {
    const result = await page.evaluate(async (mode) => {
      const status = await window.desktop.knowledge({ op: 'status' });
      if (!status.ok) throw Error(status.error);
      const doc = status.value.documents.find((doc) => doc.name === 'handover.md');
      const hits = await window.desktop.knowledge({
        op: 'search',
        requestId: crypto.randomUUID(),
        query: 'Where is the archive handover receipt stored?',
        baseId: doc.baseId,
        mode,
        topK: 5,
      });
      if (!hits.ok) throw Error(hits.error);
      const hit = hits.value.find((hit) => hit.documentId === doc.documentId);
      if (!hit) throw Error('Indexed handover document missing for ' + mode);
      const item = await window.desktop.knowledge({
        op: 'item',
        requestId: crypto.randomUUID(),
        itemId: hit.itemId,
        expected: { documentId: doc.documentId, baseId: doc.baseId, revision: hit.revision },
      });
      if (!item.ok) throw Error(item.error);
      return item.value;
    }, mode);
    assert.ok(result.rootContent.includes(`locker ${marker}`));
    assert.ok(result.followUps.some(item => item.parentId === result.itemId && item.content.includes(`交接编号 ${marker}`)));
    assert.match(result.source.revision, /^[a-f0-9]{64}$/);
    return result.source.revision;
  }
  const revision = await checkEvidence('hybrid');
  for (const mode of ['keyword', 'vector']) assert.equal(await checkEvidence(mode), revision);
  await page.screenshot({ animations: 'disabled' });
  await closeUiApp(app);
  app = await launch();
  page = await waitForRestoredMainWindow(app);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-card').filter({ hasText: 'RAG 本地集成' }).click();
  await page
    .getByRole('dialog', { name: 'RAG 本地集成', exact: true })
    .getByText(/索引完成/)
    .first()
    .waitFor();
  assert.equal(await checkEvidence('hybrid'), revision);
  const originals = await page.evaluate(async () => {
    const read = request => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await read(indexedDB.open('copilot-local-documents'));
    try {
      const docs = await read(db.transaction('documents').objectStore('documents').getAll());
      return Object.fromEntries(await Promise.all(docs.map(async doc => [
        doc.name, new Uint8Array(await crypto.subtle.digest('SHA-256', await doc.blob.arrayBuffer())).toHex(),
      ])));
    } finally { db.close(); }
  });
  assert.deepEqual(originals, Object.fromEntries(files.map(file => [
    file.name, createHash('sha256').update(file.buffer).digest('hex'),
  ])));
  await page
    .getByRole('dialog', { name: 'RAG 本地集成', exact: true })
    .getByRole('button', { name: '关闭对话框', exact: true })
    .click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('heading', { name: '通用', exact: true }).waitFor();
  assert.equal(
    await settings
      .getByRole('navigation')
      .getByRole('button', { name: '知识库', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await settings.getByRole('button', { name: '资料使用方式', exact: true }).count(),
    0,
  );
  await waitForAsync(page, async () => {
    const result = await window.desktop.knowledge({ op: 'settings', mode: 'function' });
    return !result.ok;
  });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.deepEqual(errors, []);
  const result = {
    status: 'passed',
    profile,
    checks: [
      'real utilityProcess',
      'local PDF/DOC/DOCX/MD/TXT import',
      'three search modes',
      'whole QA plus follow-up',
      'restart persistence',
      'original preservation',
    ],
    liveAccount: false,
  };
  await console.log(JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  await closeUiApp(app);
}
