import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import {
  connectUiAccount,
  installUiAccount,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { stageModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { verifyLocalApp } from '../../scripts/development-signing.mjs';
import { requireGuestIsolation } from './guest-isolation.mjs';
import { launchGuestAsar, launchLegacyGuestProduct } from './guest-asar-host.mjs';
import { runGuestProduct } from './guest-product.mjs';
import { holdDesktopAwake } from './desktop-session.mjs';
import { verifiedUpgradeArchive } from './package-upgrade-baselines.mjs';
import { mkdir, lstat, realpath, rm, readFile, cp, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 });
  if (result.error || result.status !== 0)
    throw result.error ?? Error(`${command}: ${result.stderr}`);
  return result.stdout;
};

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

async function archivedIndex(app, model, seed, fromVersion) {
  return app.evaluate(
    async ({ app }, { model, seed, fromVersion }) => {
      const load = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const { KnowledgeHost } = load(
        app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js',
      );
      const assert = load('node:assert/strict');
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
              name: `existing-${fromVersion}.md`,
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
        assert.ok(hit, `Previously indexed ${fromVersion} document must remain searchable`);
        const item = await host.getItem(hit.itemId);
        assert.ok(item?.content.includes('固定参数为 37'));
        return { documents: await host.listDocuments(), item };
      } finally {
        await host.close();
      }
    },
    { model, seed, fromVersion },
  );
}

async function replaceOwnedBundle(bundle, zip) {
  const actual = await realpath(bundle);
  const stat = await lstat(bundle);
  assert.equal(actual, bundle);
  assert.ok(bundle.startsWith(testRoot + path.sep));
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid());
  // Closing the app must also release utility mappings before removing its copy.
  const deadline = Date.now() + 15000;
  for (;;) {
    const occupied = spawnSync('/usr/sbin/lsof', ['-Fpn', '+D', bundle], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (occupied.error || occupied.signal || ![0, 1].includes(occupied.status) || occupied.stderr)
      throw Error('Cannot verify temporary upgrade application occupancy');
    if (occupied.status === 1 && !occupied.stdout) break;
    if (Date.now() >= deadline) throw Error('Temporary upgrade application is still in use');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await rm(bundle, { recursive: true });
  run('/usr/bin/ditto', ['-x', '-k', zip, path.dirname(bundle)]);
}

// Covers data compatibility during an archive replacement. The independent
// native updater suite exercises Sparkle commit/relaunch; package-smoke keeps
// its real production archive authentication/staging/cancellation acceptance.
export async function verifyPreviousVersionData({
  zip,
  cache,
  update,
  nativeFile,
  fromVersion = '1.1.1',
}) {
  await requireGuestIsolation();
  const previousZip = await verifiedUpgradeArchive(fromVersion);
  const original = `Synthetic ${fromVersion} original: 中文与 English remain byte-for-byte intact.\n`;
  const baseName = `${fromVersion} 覆盖升级资料`;
  const background = `${fromVersion} 合成简历：TypeScript 与接口校验。`;
  const documentName = `preserved-${fromVersion}.md`;
  const directory = path.join(testRoot, `upgrade-from-${fromVersion}`);
  const install = path.join(directory, 'installed');
  const profile = path.join(directory, 'VoxCue');
  await mkdir(install, { recursive: true });
  await mkdir(path.join(directory, 'tmp'));
  const { packagesFor } = workspace.platformRequire(
    path.join(
      workspace.platformRoot,
      'dist-electron/shared/electron/backend/components/catalog.js',
    ),
  );
  const { componentLocation, componentPaths } = workspace.platformRequire(
    path.join(
      workspace.platformRoot,
      'dist-electron/shared/electron/backend/components/service.js',
    ),
  );
  const catalog = packagesFor(process.platform, process.arch);
  const packages = catalog.filter((pkg) => pkg.id === 'rag');
  assert.equal(packages.length, 1);
  const components = path.join(profile, 'component-cache');
  await stageModelFixtures(path.resolve(cache), components, packages, componentLocation);
  const model = componentPaths(components, catalog).ragModel;
  run('/usr/bin/ditto', ['-x', '-k', previousZip, install]);
  const bundle = path.join(install, 'VoxCue.app');
  const signing = JSON.parse(
    await readFile(path.join(workspace.platformRoot, 'local-signing-public.json'), 'utf8'),
  );
  const releaseDesktop = holdDesktopAwake();
  const env = {
    ...process.env,
    COPILOT_TEST_USER_DATA: profile,
    TMPDIR: path.join(directory, 'tmp'),
    CFFIXED_USER_HOME: path.join(directory, 'foundation-home'),
    XDG_CACHE_HOME: path.join(directory, 'cache'),
    XDG_DATA_HOME: path.join(directory, 'data'),
    XDG_STATE_HOME: path.join(directory, 'state'),
    VITE_DEV_SERVER_URL: '',
    VOXCUE_ACCOUNT_API: '',
  };
  let app;
  const launch = async (version) => {
    verifyLocalApp(bundle, signing, 'com.voxcue.app');
    app =
      version === '1.1.1'
        ? await launchLegacyGuestProduct(bundle, env, version)
        : await launchGuestAsar(bundle, { env });
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    await installUiAccount(app);
    const login = await app.firstWindow();
    await login.reload();
    return connectUiAccount(app, login);
  };
  async function verifyNormalStart(version, before, indexBefore) {
    // Start an untouched product at its ordinary guest OS profile path, then
    // inspect retained data in the separate development host. Native window
    // startup does not establish a signed-in production account or page access.
    const normalProfile = path.join(os.homedir(), 'Library/Application Support/VoxCue');
    assert.equal(await lstat(normalProfile).catch(() => null), null);
    await cp(profile, normalProfile, { recursive: true, verbatimSymlinks: true });
    const normalEnvironment = { ...process.env };
    for (const key of [
      'COPILOT_TEST_USER_DATA',
      'CFFIXED_USER_HOME',
      'ELECTRON_RUN_AS_NODE',
      'NODE_OPTIONS',
    ])
      delete normalEnvironment[key];
    await runGuestProduct(bundle, { env: normalEnvironment });
    await rename(profile, path.join(directory, `before-normal-start-${version}`));
    await rename(normalProfile, profile);
    const reopened = await launch(version);
    assert.deepEqual(await snapshot(reopened), before);
    assert.deepEqual(await archivedIndex(app, model, false, fromVersion), indexBefore);
    await closeUiApp(app);
    app = undefined;
  }
  try {
    const old = await launch(fromVersion);
    if (fromVersion === '1.1.1') {
      // A genuine unchanged old bundle supplies Sparkle's actual NSBundle
      // identity/version. JS version overrides cannot substitute for this.
      const { installFeed } = workspace.platformRequire(
        path.join(workspace.platformRoot, 'dist-electron/macos/electron/updates/install-feed.js'),
      );
      const feed = await installFeed(zip, update);
      try {
        await app.evaluate(
          async ({ app }, { url, nativeFile }) => {
            const require = process
              .getBuiltinModule('module')
              .createRequire(app.getAppPath() + '/package.json');
            const native = require(nativeFile);
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                native.cancel();
                reject(Error('Production archive validation timed out'));
              }, 120000);
              native.begin(url, (event) => {
                if (event.type === 'error') {
                  clearTimeout(timeout);
                  reject(Error(event.message));
                } else if (event.type === 'ready') {
                  native.cancel();
                  clearTimeout(timeout);
                  resolve();
                } else if (event.type === 'quit') {
                  clearTimeout(timeout);
                  reject(Error('Cancelled update unexpectedly requested quit'));
                }
              });
            });
          },
          { url: feed.url, nativeFile },
        );
        assert.equal(
          run('/usr/libexec/PlistBuddy', [
            '-c',
            'Print :CFBundleVersion',
            path.join(bundle, 'Contents/Info.plist'),
          ]).trim(),
          '1.1.1',
        );
        verifyLocalApp(bundle, signing, 'com.voxcue.app');
        console.log(
          'PASS: unchanged real 1.1.1 host and final native updater authenticated/staged the final production ZIP; cancellation retained the old signed bundle.',
        );
      } finally {
        feed.close();
      }
    }
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
      .fill(background);
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
    await base.getByLabel('导入知识库文档').setInputFiles({
      name: documentName,
      mimeType: 'text/markdown',
      buffer: Buffer.from(original),
    });
    await base
      .locator('.document-row')
      .filter({ hasText: documentName })
      .getByText(/索引完成$/)
      .waitFor();
    await base.getByRole('button', { name: '关闭对话框', exact: true }).click();
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
    assert.equal(before.profile.background, background);
    assert.equal(before.theme, 'dark');
    assert.equal(before.language, 'zh-CN');
    assert.equal(before.bases.length, 1);
    assert.equal(before.documents.length, 1);
    assert.equal(Buffer.from(before.documents[0].bytes).toString(), original);
    const indexBefore = await archivedIndex(app, model, true, fromVersion);
    await closeUiApp(app);
    app = undefined;
    if (fromVersion === '1.2.2') {
      // Its hardened executable rejects inspectors. Keep its bytes and fuses
      // intact; verify ordinary product startup separately from ASAR inspection.
      await verifyNormalStart(fromVersion, before, indexBefore);
      console.log(
        `PASS: untouched published ${fromVersion} product started and quit normally; subsequent ASAR inspection confirmed the synthetic upgrade profile was preserved.`,
      );
    }
    await replaceOwnedBundle(bundle, zip);
    const current = await launch(
      workspace.platformRequire(path.join(workspace.platformRoot, 'package.json')).version,
    );
    assert.deepEqual(
      await snapshot(current),
      before,
      'Archive upgrade must retain settings, profile and original bytes/metadata',
    );
    assert.deepEqual(
      await archivedIndex(app, model, false, fromVersion),
      indexBefore,
      `The new build must read the unchanged ${fromVersion} index`,
    );
    assert.equal(
      await current.evaluate(() => document.documentElement.classList.contains('dark')),
      true,
    );
    await current.getByRole('button', { name: '个人信息', exact: true }).click();
    assert.equal(
      await current
        .getByRole('complementary', { name: '个人信息', exact: true })
        .getByLabel('姓名', { exact: true })
        .inputValue(),
      before.profile.name,
    );
    console.log(
      `PASS: published ${fromVersion} → final data archive replacement preserves synthetic profile, settings, original bytes/metadata and the existing searchable index; this is not Sparkle installation acceptance.`,
    );
    await closeUiApp(app);
    app = undefined;
    await verifyNormalStart(
      workspace.platformRequire(path.join(workspace.platformRoot, 'package.json')).version,
      before,
      indexBefore,
    );
    console.log(
      `PASS: untouched final product started and quit at the normal guest OS profile path; subsequent ASAR inspection retained the ${fromVersion} settings, original bytes and searchable index.`,
    );
  } finally {
    try {
      if (app) await closeUiApp(app);
    } finally {
      releaseDesktop();
    }
  }
}
