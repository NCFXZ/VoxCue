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
  const indexVersion = await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const root = app.getAppPath() + '/dist-electron/shared/electron/';
    const { KnowledgeHost } = require(root + 'backend/knowledge/host.js');
    const { KnowledgeCoordinator } = require(root + 'application/knowledge.js');
    const { KNOWLEDGE_INDEX_VERSION } = require(root + 'contracts/knowledge.js');
    const indexed = new Map(), imports = [];
    let batch;
    const publish = (host, documents) => {
      // All staged entries become readable before the first completion event.
      for (const doc of documents) indexed.set(doc.documentId, doc);
      for (const doc of documents) host.progress({
        documentId: doc.documentId, indexVersion: doc.indexVersion, phase: 'ready', completed: 1, total: 1,
      });
    };
    globalThis.cloudRestoreUi = { imports, forget: (id) => indexed.delete(id) };
    KnowledgeHost.prototype.initialize = async () => {};
    KnowledgeHost.prototype.listDocuments = async () => [...indexed.values()];
    KnowledgeHost.prototype.beginIndexBatch = async (id) => {
      if (batch) throw Error('Synthetic index batch already active');
      batch = { id, documents: [] };
    };
    KnowledgeHost.prototype.finishIndexBatch = async function (id, commit) {
      if (id !== batch?.id) {
        if (commit) throw Error('Unknown synthetic index batch');
        return;
      }
      const { documents } = batch;
      batch = undefined;
      if (commit) publish(this, documents);
    };
    KnowledgeHost.prototype.indexDocument = async function ({ documentId, baseId, name, batchId }) {
      if (batchId !== batch?.id) throw Error('Unexpected synthetic index batch');
      imports.push(documentId);
      const document = { documentId, baseId, name, available: true, indexVersion: KNOWLEDGE_INDEX_VERSION };
      if (batch) batch.documents.push(document);
      else publish(this, [document]);
      return document;
    };
    KnowledgeHost.prototype.invalidateDocument = async (id) => {
      const doc = indexed.get(id);
      if (doc) indexed.set(id, { ...doc, available: false });
      return null;
    };
    KnowledgeHost.prototype.removeDocument = async (id) => { indexed.delete(id); };
    KnowledgeHost.prototype.removeBase = async (baseId) => {
      for (const doc of indexed.values()) if (doc.baseId === baseId) indexed.delete(doc.documentId);
    };
    const call = KnowledgeCoordinator.prototype.call;
    KnowledgeCoordinator.prototype.call = async function (input) {
      const result = await call.call(this, input);
      return input.op === 'status' ? { ...result, modelReady: true } : result;
    };
    return KNOWLEDGE_INDEX_VERSION;
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
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: '保存', exact: true }).press('Enter');
  let base = page.getByRole('dialog', { name: '原件管理回归', exact: true });
  await base.waitFor();
  await base.getByText('单文件最大 20 MB，每次最多 20 个；同名文件将替换旧文件').waitFor();
  await page.mouse.move(0, 0);
  const cloud = base.locator('.sync-indicator-button').first();
  assert.equal(await cloud.getAttribute('aria-expanded'), 'false');
  assert.equal(await base.locator('.sync-popover').count(), 0);
  await cloud.focus(); // Dialog autofocus/programmatic focus must not disclose the popover.
  await page.waitForTimeout(200);
  assert.equal(await cloud.getAttribute('aria-expanded'), 'false');
  assert.equal(await base.locator('.sync-popover').count(), 0);
  await cloud.press('Enter');
  await base.locator('.sync-popover').waitFor();
  await cloud.press('Enter');
  await base.locator('.sync-popover').waitFor({ state: 'detached' });
  await cloud.press('Space');
  await base.locator('.sync-popover').waitFor();
  await cloud.press('Space');
  await base.locator('.sync-popover').waitFor({ state: 'detached' });
  await cloud.click();
  await base.locator('.sync-popover').waitFor();
  await cloud.press('Escape');
  assert.equal(await cloud.getAttribute('aria-expanded'), 'false');
  assert.equal(await cloud.evaluate((button) => button === document.activeElement), true);
  // Escape releases the live popup immediately; wait for its inert visual exit
  // before verifying that a subsequent hover cannot open a new popup.
  await base.locator('.sync-popover').waitFor({ state: 'detached' });
  await cloud.hover();
  await page.waitForTimeout(200);
  assert.equal(await cloud.getAttribute('aria-expanded'), 'false');
  assert.equal(await base.locator('.sync-popover').count(), 0);
  await cloud.click();
  const popover = base.locator('.sync-popover');
  await popover.waitFor();
  await popover.locator('strong').click();
  assert.equal(await cloud.getAttribute('aria-expanded'), 'true');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  assert.equal(await cloud.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'detached' });
  assert.equal(await cloud.evaluate((button) => button === document.activeElement), true);
  await cloud.press('Enter');
  await popover.waitFor();
  await cloud.press('Tab');
  await popover.waitFor({ state: 'detached' });
  await cloud.click();
  await popover.waitFor();
  await cloud.click();
  await popover.waitFor({ state: 'detached' });
  await cloud.click();
  await popover.waitFor();
  await base.locator('.upload-dropzone').click();
  await base.locator('.sync-popover').waitFor({ state: 'detached' });
  await captureRequested(base, 'knowledge-new-base-no-cloud-popover');
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
          const r = indexedDB.open('copilot-local-documents');
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
  await base
    .getByLabel('导入知识库文档')
    .setInputFiles([
      {
        name: 'archive.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from('synthetic unsupported'),
      },
    ]);
  const importError = base.locator('.knowledge-inline-error');
  await importError.waitFor();
  const importMessage = await importError.innerText();
  assert.ok(importMessage.includes('archive.zip'));
  await base.getByRole('button', { name: '重命名', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '重命名知识库', exact: true });
  await editor.waitFor();
  assert.equal(await importError.isVisible(), true);
  assert.equal(await importError.innerText(), importMessage);
  assert.equal(await editor.getByRole('alert').count(), 0);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await importError.innerText(), importMessage);
  await base.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('知识库名称', { exact: true }).fill('保留的知识库');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  base = page.getByRole('dialog', { name: '保留的知识库', exact: true });
  await page.getByRole('dialog', { name: '保留的知识库', exact: true }).waitFor();
  assert.equal(await base.locator('.knowledge-inline-error').innerText(), importMessage);
  await page.reload();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-card').filter({ hasText: '保留的知识库' }).click();
  base = page.getByRole('dialog', { name: '保留的知识库', exact: true });
  await base.locator('.document-row').filter({ hasText: 'document.pdf' }).waitFor();
  const bytes = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('copilot-local-documents');
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
  const readingFiles = Array.from({ length: 18 }, (_, i) => 'a-0-read-' + String(i).padStart(2, '0'));
  await app.evaluate(({ app }, readingFiles) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const path = require('node:path'),
      crypto = require('node:crypto');
    const root = path.join(app.getAppPath(), 'dist-electron/shared/electron');
    const { CloudSyncClient } = require(path.join(root, 'backend/cloud/sync.js'));
    let release, releaseOther;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const otherHeld = new Promise((resolve) => {
      releaseOther = resolve;
    });
    globalThis.cloudRestoreUi.imports.length = 0;
    Object.assign(globalThis.cloudRestoreUi, { release, releaseOther });
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
    for (const id of ['b-2', 'a-1', ...readingFiles, 'b-1', 'a-2']) {
      const bytes = Buffer.alloc(readingFiles.includes(id) ? 32 : 1048580, 65);
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
        const counts = { profile: 0, history: 0, knowledgebase: resources.reduce((sum, item) => sum + item.bytes, 0) };
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
        if (resource.name === 'file:b-2' && input.index === 1) await otherHeld;
        return {
          ok: true,
          value: new Uint8Array(bytes.subarray(input.index * 1048576, (input.index + 1) * 1048576)),
        };
      }
      throw Error('Unexpected cloud mutation: ' + input.action);
    };
  }, readingFiles);
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
  await waitForAsync(page, async (version) => {
    const result = await window.desktop.knowledge({ op: 'status' });
    return result.ok && result.value.documents.some((doc) =>
      doc.documentId === 'a-1' && doc.available && doc.indexVersion === version);
  }, indexVersion);
  const beforeRelease = ['a-1', ...readingFiles];
  const imported = [...beforeRelease, 'a-2', 'b-2', 'b-1'];
  await page.locator('.knowledge-card').filter({ hasText: '云端资料A' }).click();
  const reading = page.getByRole('dialog', { name: '云端资料A', exact: true });
  await reading.getByText(readingFiles.at(-1) + '.txt', { exact: true }).waitFor();
  await waitForAsync(page, async (total) => {
    const result = await window.desktop.knowledge({ op: 'status' });
    return result.ok && result.value.documents.length === total;
  }, beforeRelease.length);
  assert.deepEqual(await app.evaluate(() => globalThis.cloudRestoreUi.imports), beforeRelease);
  const scroll = reading.locator('.dialog-scroll');
  await scroll.evaluate((node) => { node.scrollTop = (node.scrollHeight - node.clientHeight) / 2; });
  const readingPosition = (node) => {
    const bounds = node.getBoundingClientRect();
    const row = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      ?.closest('.document-row');
    return {
      top: node.scrollTop,
      file: row?.querySelector('strong')?.textContent,
      offset: row && row.getBoundingClientRect().top - bounds.top,
    };
  };
  const before = await scroll.evaluate(readingPosition);
  assert.ok(before.top > 100 && before.file, 'Read a document well below the header');
  const row = await reading.locator('.document-row').filter({ hasText: before.file }).elementHandle();
  await app.evaluate(() => globalThis.cloudRestoreUi.release());
  await reading.getByText('a-2.txt', { exact: true }).waitFor();
  const sameLibrary = await scroll.evaluate(readingPosition);
  console.log('Reading position before and after downloading into the open library', { before, sameLibrary });
  assert.deepEqual(sameLibrary, before, 'Downloading into the open library moved the visible document');
  await app.evaluate(() => globalThis.cloudRestoreUi.releaseOther());
  await waitForAsync(page, async (total) => {
    const result = await window.desktop.knowledge({ op: 'status' });
    return result.ok && result.value.documents.length === total;
  }, imported.length);
  const after = await scroll.evaluate(readingPosition);
  console.log('Reading position after downloading another library', after);
  assert.deepEqual(after, before, 'Downloading another library moved the visible document');
  assert.equal(await row.evaluate((node) => node.isConnected), true, 'Background refresh removed the document being read');
  await reading.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '云端资料A：已同步', exact: true }).waitFor();
  await page.getByRole('button', { name: '云端资料B：已同步', exact: true }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.cloudRestoreUi.imports), imported);
  await app.evaluate(() => globalThis.cloudRestoreUi.forget('a-1'));
  await page.locator('.knowledge-card').filter({ hasText: '云端资料A' }).click();
  await page
    .getByRole('dialog', { name: '云端资料A', exact: true })
    .locator('.document-row')
    .filter({ hasText: 'a-1.txt' })
    .getByText('索引完成', { exact: false })
    .waitFor();
  await waitForAsync(page, async (version) => {
    const result = await window.desktop.knowledge({ op: 'status' });
    return result.ok && result.value.documents.some((doc) =>
      doc.documentId === 'a-1' && doc.available && doc.indexVersion === version);
  }, indexVersion);
  assert.deepEqual(await app.evaluate(() => globalThis.cloudRestoreUi.imports), [...imported, 'a-1']);
  await app.evaluate(() => globalThis.cloudRestoreUi.forget('a-1'));
  await page.reload();
  await waitForAsync(page, async (total) => {
    const result = await window.desktop.knowledge({ op: 'status' });
    return result.ok && result.value.documents.length === total;
  }, imported.length);
  assert.deepEqual(await app.evaluate(() => globalThis.cloudRestoreUi.imports), [...imported, 'a-1', 'a-1']);
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: '云端资料B：已同步', exact: true }).waitFor();
  await page.locator('.knowledge-card').filter({ hasText: '云端资料A' }).click();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('知识库名称', { exact: true }).fill('已编辑的资料A');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const renamed = page.getByRole('dialog', { name: '已编辑的资料A', exact: true });
  await renamed.getByRole('button', { name: '已编辑的资料A：未同步', exact: true }).waitFor();
  assert.equal(await page.locator('.knowledge-card-wrap .sync-indicator-button[aria-label="云端资料B：已同步"]').count(), 1);
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
        'rename retains import error',
        'click-only sync menu and keyboard dismissal',
        'document removal',
        'base deletion confirmation',
        'removed IPC',
        'cloud library order and syncing badge',
        'editing one library preserves the other library sync badge',
        'reading position during same-library and other-library downloads',
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
