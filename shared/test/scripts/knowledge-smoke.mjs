import { captureRequested } from './capture-requested.mjs';
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
  if (process.argv.some(argument => argument.startsWith('--screenshots='))) {
    const win = await app.browserWindow(page);
    const original = await win.evaluate(window => window.getBounds());
    const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    try {
      for (const dark of [false, true]) for (const width of [1280, 880]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
        await win.evaluate((window, width) => window.setSize(width, 800), width);
        await captureRequested(page, `knowledge-files-${dark ? 'dark' : 'light'}-${width}`);
      }
    } finally {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), wasDark);
      await win.evaluate((window, bounds) => window.setBounds(bounds), original);
    }
  }
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
  // Exercise the real renderer stores/IPC with offline cloud bytes and synthetic
  // indexing. A held second chunk makes the intermediate library state observable.
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const path = require('node:path'),
      crypto = require('node:crypto');
    const root = path.join(app.getAppPath(), 'dist-electron/shared/electron');
    const { CloudSyncClient } = require(path.join(root, 'backend/cloud/sync.js'));
    const { KnowledgeHost } = require(path.join(root, 'backend/knowledge/host.js'));
    const { KnowledgeCoordinator } = require(path.join(root, 'application/knowledge.js'));
    const indexed = new Map(),
      imports = [];
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    globalThis.cloudRestoreUi = { imports, release, forget: (id) => indexed.delete(id) };
    KnowledgeHost.prototype.listDocuments = async () => [...indexed.values()];
    KnowledgeHost.prototype.indexDocument = async function (input) {
      imports.push(input.documentId);
      const document = {
        documentId: input.documentId,
        baseId: input.baseId,
        name: input.name,
        available: true,
      };
      indexed.set(input.documentId, document);
      this.progress({ documentId: input.documentId, phase: 'ready', completed: 1, total: 1 });
      return document;
    };
    const call = KnowledgeCoordinator.prototype.call;
    KnowledgeCoordinator.prototype.call = async function (input) {
      const result = await call.call(this, input);
      return input.op === 'status' ? { ...result, modelReady: true } : result;
    };
    const pack = (key, bytes, metadata) => {
      const header = Buffer.from(JSON.stringify({ v: 1, key, ...(metadata ? { metadata } : {}) }));
      const prefix = Buffer.alloc(8);
      prefix.write('VCS1');
      prefix.writeUInt32BE(header.length, 4);
      return Buffer.concat([prefix, header, bytes]);
    };
    const blobs = new Map();
    for (const id of ['a', 'b'])
      blobs.set(
        'base:' + id,
        pack(
          'base:' + id,
          Buffer.from(JSON.stringify({ id, name: '云端资料' + id.toUpperCase(), createdAt: 1 })),
        ),
      );
    for (const id of ['b-2', 'a-1', 'b-1', 'a-2']) {
      const bytes = Buffer.alloc(1048580, 65);
      blobs.set(
        'file:' + id,
        pack('file:' + id, bytes, {
          id,
          baseId: id[0],
          name: id + '.txt',
          size: bytes.length,
          type: 'text/plain',
          createdAt: 1,
        }),
      );
    }
    const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
    const resources = [...blobs].map(([name, bytes]) => ({
      id: crypto.randomUUID(),
      kind: 'knowledgebase',
      name,
      revision: 1,
      headVersion: crypto.randomUUID(),
      bytes: bytes.length,
      sha256: sha(bytes),
      createdAt: 1,
    }));
    CloudSyncClient.prototype.call = async (input) => {
      if (input.action === 'list') {
        const counts = { profile: 0, history: 0, knowledgebase: 4195000 };
        return {
          ok: true,
          value: {
            items: resources,
            nextCursor: null,
            storage: {
              currentBytes: counts,
              reservedBytes: { profile: 0, history: 0, knowledgebase: 0 },
              storedBytes: counts,
              capacityBytes: 100000000,
              knowledgeCapacityBytes: 100000000,
            },
          },
        };
      }
      const resource = resources.find((item) => item.id === input.id),
        bytes = blobs.get(resource?.name);
      if (input.action === 'manifest') {
        const parts = [];
        for (let start = 0; start < bytes.length; start += 1048576) {
          const part = bytes.subarray(start, start + 1048576);
          parts.push({ index: parts.length, bytes: part.length, sha256: sha(part) });
        }
        return {
          ok: true,
          value: { bytes: bytes.length, sha256: sha(bytes), chunkBytes: 1048576, parts },
        };
      }
      if (input.action === 'read') {
        if (resource.name === 'file:a-2' && input.index === 1) await held;
        return {
          ok: true,
          value: new Uint8Array(bytes.subarray(input.index * 1048576, (input.index + 1) * 1048576)),
        };
      }
      throw Error('Unexpected cloud mutation: ' + input.action);
    };
  });
  await page.evaluate(async () => {
    const userId = 'a0000000-0000-4000-8000-000000000001';
    localStorage.setItem('voxcue-sync-owner', userId);
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('voxcue-cloud-sync', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('accounts');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      tx.objectStore('accounts').put(
        {
          preferences: {
            enabled: { profile: false, history: false, knowledgebase: true },
            knowledgeLimitBytes: 100000000,
          },
          baselines: {},
        },
        userId,
      );
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: '云端资料A：正在同步', exact: true }).waitFor();
  assert.equal(await page.locator('.knowledge-card').filter({ hasText: '云端资料B' }).count(), 0);
  await waitForAsync(page, async () => {
    const result = await window.desktop.knowledge({ op: 'status' });
    return result.ok && result.value.documents.some((doc) => doc.documentId === 'a-1');
  });
  assert.deepEqual(await app.evaluate(() => globalThis.cloudRestoreUi.imports), ['a-1']);
  await app.evaluate(() => globalThis.cloudRestoreUi.release());
  await page.getByRole('button', { name: '云端资料A：已同步', exact: true }).waitFor();
  await page.getByRole('button', { name: '云端资料B：已同步', exact: true }).waitFor();
  await waitForAsync(page, async () => {
    const result = await window.desktop.knowledge({ op: 'status' });
    return result.ok && result.value.documents.length === 4;
  });
  assert.deepEqual(await app.evaluate(() => globalThis.cloudRestoreUi.imports), [
    'a-1',
    'a-2',
    'b-2',
    'b-1',
  ]);
  await app.evaluate(() => globalThis.cloudRestoreUi.forget('a-1'));
  await page.locator('.knowledge-card').filter({ hasText: '云端资料A' }).click();
  await page
    .getByRole('dialog', { name: '云端资料A', exact: true })
    .locator('.document-row')
    .filter({ hasText: 'a-1.txt' })
    .getByText('索引完成', { exact: false })
    .waitFor();
  await waitForAsync(page, async () => {
    const result = await window.desktop.knowledge({ op: 'status' });
    return result.ok && result.value.documents.some((doc) => doc.documentId === 'a-1');
  });
  assert.deepEqual(await app.evaluate(() => globalThis.cloudRestoreUi.imports), [
    'a-1',
    'a-2',
    'b-2',
    'b-1',
    'a-1',
  ]);
  await app.evaluate(() => globalThis.cloudRestoreUi.forget('a-1'));
  await page.reload();
  await waitForAsync(page, async () => {
    const result = await window.desktop.knowledge({ op: 'status' });
    return result.ok && result.value.documents.length === 4;
  });
  assert.deepEqual(await app.evaluate(() => globalThis.cloudRestoreUi.imports), [
    'a-1',
    'a-2',
    'b-2',
    'b-1',
    'a-1',
    'a-1',
  ]);
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
        'cloud library order and syncing badge',
        'cloud automatic indexing',
        'open-library index repair',
        'startup index repair',
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
