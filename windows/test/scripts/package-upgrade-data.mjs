import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, realpath, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import workspace from '../../../shared/scripts/workspace.mjs';
import {
  testRoot,
  electron,
  spawnTestProcess,
} from '../../../shared/test/scripts/test-workspace.mjs';
import { stageModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import {
  installUiAccount,
  connectUiAccount,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';

const require = createRequire(import.meta.url);
const previousVersion = '1.1.0';
const previousSha256 = 'de9aa759c94c69d7dc4723c5c65c414c6c9bf4672be246e833c625e75bdd5907';
const original = 'Synthetic 1.1.0 original: 中文与 English remain byte-for-byte intact.\n';
const baseName = '1.1.0 合成升级资料';
const imageId = '10000000-0000-4000-8000-000000000001';

async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('copilot-local-documents', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(['bases', 'documents'], 'readonly');
        const bases = tx.objectStore('bases').getAll();
        const documents = tx.objectStore('documents').getAll();
        tx.oncomplete = () => resolve({ bases: bases.result, documents: documents.result });
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      return {
        profile: JSON.parse(localStorage.getItem('copilot-personal-info-v1')),
        theme: localStorage.getItem('copilot-theme'),
        language: localStorage.getItem('voxcue-language-v1'),
        history: JSON.parse(localStorage.getItem('copilot-interview-history-v1')),
        bindings: (await window.desktop.shortcutSettings({ op: 'status' })).state.bindings,
        bases: rows.bases.sort((a, b) => a.id.localeCompare(b.id)),
        documents: await Promise.all(
          rows.documents
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(async ({ blob, ...row }) => ({
              ...row,
              bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
            })),
        ),
      };
    } finally {
      db.close();
    }
  });
}

async function archivedIndex(app, model, seed) {
  return app.evaluate(
    async ({ app }, { model, seed }) => {
      const load = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const { KnowledgeHost } = load(
        app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js',
      );
      const host = new KnowledgeHost(
        load('node:path').join(app.getPath('userData'), 'upgrade-index'),
        model,
      );
      const signal = new AbortController().signal;
      try {
        if (seed)
          await host.indexDocument(
            {
              documentId: 'upgrade-existing',
              baseId: 'upgrade-existing',
              name: 'existing-1.1.0.md',
              bytes: Buffer.from('旧版索引 upgradeexistingmarker 保留中文正文，固定参数为 37。'),
            },
            signal,
          );
        const hits = await host.search(
          'upgradeexistingmarker',
          5,
          'keyword',
          signal,
          'upgrade-existing',
        );
        const hit = hits.find((item) => item.documentId === 'upgrade-existing');
        load('node:assert/strict').ok(hit, 'Published 1.1.0 index must remain searchable');
        const item = await host.getItem(hit.itemId);
        load('node:assert/strict').ok(item?.content.includes('固定参数为 37'));
        return { documents: await host.listDocuments(), item };
      } finally {
        await host.close();
      }
    },
    { model, seed },
  );
}

async function storedImage(app, seed) {
  return app.evaluate(
    async ({ app, nativeImage }, { seed, imageId }) => {
      const load = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const { InterviewImageStore } = load(
        app.getAppPath() + '/dist-electron/shared/electron/backend/interview/images.js',
      );
      const store = new InterviewImageStore(
        load('node:path').join(app.getPath('userData'), 'interview-images-v1'),
      );
      if (seed) {
        const image = nativeImage.createFromBitmap(Buffer.alloc(8 * 8 * 4, 180), {
          width: 8,
          height: 8,
        });
        await store.save([
          {
            id: imageId,
            preview: image.toDataURL(),
            file: { name: 'synthetic.png', bytes: image.toPNG() },
          },
        ]);
      }
      return {
        id: imageId,
        preview: await store.preview(imageId),
        original: await store.read(imageId),
      };
    },
    { seed, imageId },
  );
}

async function historyNavigation(page) {
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  const list = page.locator('.history-page .management-scroll');
  await list.waitFor();
  await page.waitForFunction(() => !document.documentElement.dataset.viewDirection);
  const selected = await list.evaluate((scroll) => {
    scroll.scrollTop = 900;
    const viewport = scroll.getBoundingClientRect();
    const row = [...scroll.querySelectorAll('.history-row-open')].find((button) => {
      const bounds = button.getBoundingClientRect();
      return bounds.top >= viewport.top + 100 && bounds.bottom < viewport.bottom - 20;
    });
    if (!row || scroll.scrollTop < 100)
      throw Error('Upgrade history must have a scrolled visible record');
    return { label: row.getAttribute('aria-label'), top: scroll.scrollTop };
  });
  await page.getByRole('button', { name: selected.label, exact: true }).click();
  await page.locator('.history-detail').waitFor();
  await page.waitForFunction(() => !document.documentElement.dataset.viewDirection);
  await page.getByRole('button', { name: '返回面试记录', exact: true }).click();
  await list.waitFor();
  await page.waitForFunction(() => !document.documentElement.dataset.viewDirection);
  assert.ok(Math.abs((await list.evaluate((node) => node.scrollTop)) - selected.top) <= 1 / 64);
}

// Real published payload and final payload use the same disposable install path
// and profile. This checks data compatibility, separately from NSIS commit tests.
export async function verifyPreviousVersionData({ currentPackage, cache }) {
  assert.equal(process.platform, 'win32');
  const installer = path.resolve(
    `release/${previousVersion}/VoxCue-Setup-${previousVersion}-x64.exe`,
  );
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(installer)) hash.update(chunk);
  assert.equal(
    hash.digest('hex'),
    previousSha256,
    'Use the unchanged published Windows 1.1.0 installer',
  );
  const directory = path.join(testRoot, 'upgrade-from-1.1.0');
  const installed = path.join(directory, 'installed');
  const retired = path.join(directory, 'retired-1.1.0');
  const profile = path.join(directory, 'profile');
  await mkdir(installed, { recursive: true });
  const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
  process.env.ELECTRON_BUILDER_CACHE = path.resolve('.cache/electron-builder');
  const child = spawnTestProcess(
    await getPath7za(),
    ['x', '-bd', '-y', '-o' + installed, installer],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (value) => (output += value));
  child.stderr.on('data', (value) => (output += value));
  const timer = setTimeout(() => child.kill(), 180000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, output);
  const asar = require('@electron/asar');
  assert.equal(
    JSON.parse(asar.extractFile(path.join(installed, 'resources/app.asar'), 'package.json'))
      .version,
    previousVersion,
  );
  const currentVersion = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).version;
  assert.equal(
    JSON.parse(asar.extractFile(path.join(currentPackage, 'resources/app.asar'), 'package.json'))
      .version,
    currentVersion,
  );
  const { packagesFor } = workspace.platformRequire(
    path.resolve('dist-electron/shared/electron/backend/components/catalog.js'),
  );
  const { componentLocation, componentPaths } = workspace.platformRequire(
    path.resolve('dist-electron/shared/electron/backend/components/service.js'),
  );
  const catalog = packagesFor(process.platform, process.arch);
  const packages = catalog.filter((pkg) => pkg.id === 'rag');
  assert.equal(packages.length, 1);
  const components = path.join(profile, 'component-cache');
  await stageModelFixtures(path.resolve(cache), components, packages, componentLocation);
  const model = componentPaths(components, catalog).ragModel;
  const env = {
    ...process.env,
    COPILOT_TEST_USER_DATA: profile,
    VITE_DEV_SERVER_URL: '',
    VOXCUE_ACCOUNT_API: '',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const errors = [];
  const launch = async (version) => {
    app = await electron.launch({
      executablePath: path.join(installed, 'VoxCue.exe'),
      args: [],
      env,
    });
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    assert.deepEqual(
      await app.evaluate(({ app }) => [app.getPath('userData'), app.getPath('sessionData')]),
      [profile, profile],
      'Both releases must use the same owned profile and session storage',
    );
    await installUiAccount(app);
    const login = await app.firstWindow();
    await login.reload();
    const page = await connectUiAccount(app, login);
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => errors.push(error.message));
    return page;
  };
  try {
    const old = await launch(previousVersion);
    await old.getByRole('button', { name: '个人信息', exact: true }).click();
    const panel = old.getByRole('complementary', { name: '个人信息', exact: true });
    await panel.getByLabel('姓名', { exact: true }).fill('Synthetic upgrade owner');
    await panel.getByRole('button', { name: '保存', exact: true }).click();
    const section = panel.locator('details[aria-label="简历摘要"]');
    if (!(await section.evaluate((node) => node.open))) await section.locator('summary').click();
    await section.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = old.getByRole('dialog', { name: '编辑简历摘要', exact: true });
    await editor
      .getByLabel('内容', { exact: true })
      .fill('1.1.0 合成简历：TypeScript 与接口校验。');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await old.getByRole('button', { name: '个人信息', exact: true }).click();
    await old.getByRole('button', { name: '知识库', exact: true }).click();
    await old
      .getByRole('button', { name: /创建知识库/ })
      .first()
      .click();
    await old.getByLabel('知识库名称', { exact: true }).fill(baseName);
    await old.getByRole('button', { name: '保存', exact: true }).click();
    const base = old.getByRole('dialog', { name: baseName, exact: true });
    await base
      .getByLabel('导入知识库文档')
      .setInputFiles({
        name: 'preserved-1.1.0.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(original),
      });
    await base
      .locator('.document-row')
      .filter({ hasText: 'preserved-1.1.0.md' })
      .getByText(/索引完成$/)
      .waitFor({ timeout: 120000 });
    await base.getByRole('button', { name: '关闭对话框', exact: true }).click();
    const imageBefore = await storedImage(app, true);
    await old.evaluate(async (image) => {
      const startedAt = 1700000000000;
      localStorage.setItem(
        'copilot-interview-history-v1',
        JSON.stringify(
          Array.from({ length: 40 }, (_, index) => ({
            id: 'upgrade-record-' + index,
            title: 'Synthetic upgrade record ' + index,
            titleStatus: 'ready',
            titleSource: 'manual',
            startedAt: startedAt - index * 60000,
            endedAt: startedAt + 30000 - index * 60000,
            status: 'ended',
            mock: false,
            transcripts: [
              {
                id: 'upgrade-transcript',
                text: '合成面试记录原文。',
                time: '10:00',
                final: true,
                source: 'system',
              },
            ],
            answers: [
              {
                id: 'upgrade-answer',
                question: '合成问题',
                content: 'Synthetic preserved answer.',
                provider: 'chatgpt',
                sourceTranscriptIds: ['upgrade-transcript'],
                images: [{ id: image.id, preview: image.preview }],
              },
            ],
          })),
        ),
      );
      const result = await window.desktop.shortcutSettings({
        op: 'set',
        action: 'toggle-window',
        accelerator: 'Control+Alt+K',
      });
      if (result.state.bindings['toggle-window'] !== 'Control+Alt+K')
        throw Error('Synthetic binding was rejected');
    }, imageBefore);
    await historyNavigation(old);
    await old.getByRole('button', { name: '用户菜单', exact: true }).click();
    await old.getByRole('menuitem', { name: '设置', exact: true }).click();
    const settings = old.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('button', { name: '通用', exact: true }).click();
    await settings.getByRole('button', { name: '外观主题', exact: true }).click();
    await settings.getByRole('menuitemradio', { name: '深色', exact: true }).click();
    await settings.getByRole('button', { name: '语言', exact: true }).click();
    await settings.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    const before = await snapshot(old);
    assert.equal(before.profile.name, 'Synthetic upgrade owner');
    assert.equal(before.profile.background, '1.1.0 合成简历：TypeScript 与接口校验。');
    assert.equal(before.theme, 'dark');
    assert.equal(before.language, 'zh-CN');
    assert.equal(before.documents.length, 1);
    assert.equal(Buffer.from(before.documents[0].bytes).toString(), original);
    assert.equal(before.history.length, 40);
    const indexBefore = await archivedIndex(app, model, true);
    const oldProcess = app.process();
    await closeUiApp(app);
    assert.ok(oldProcess.exitCode !== null || oldProcess.signalCode !== null);
    app = undefined;
    assert.equal(await realpath(installed), installed);
    for (const target of [installed, retired]) assert.ok(target.startsWith(testRoot + path.sep));
    await rename(installed, retired);
    await cp(currentPackage, installed, { recursive: true });
    for (let launchNumber = 0; launchNumber < 2; launchNumber++) {
      const current = await launch(currentVersion);
      assert.deepEqual(
        await snapshot(current),
        before,
        'Upgrade must preserve original data, metadata, history, theme, language and shortcut bindings',
      );
      assert.deepEqual(
        await storedImage(app, false),
        imageBefore,
        'Sent screenshot bytes and preview must remain intact',
      );
      assert.deepEqual(
        await archivedIndex(app, model, false),
        indexBefore,
        'New payload must reopen the unchanged 1.1.0 searchable index',
      );
      assert.equal(
        await current.evaluate(() => document.documentElement.classList.contains('dark')),
        true,
      );
      await historyNavigation(current);
      await closeUiApp(app);
      app = undefined;
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS: published Windows 1.1.0 -> final payload, same owned profile/install path, originals/metadata, personal info, shortcuts, theme/language, records/screenshots, scroll return, existing searchable index and repeated launch; no real installation/profile touched.',
    );
  } finally {
    if (app) await closeUiApp(app);
  }
}
