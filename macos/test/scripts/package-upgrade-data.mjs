import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import {
  enterPrimaryUiAccount,
  installUiAccount,
  connectUiAccount,
  returnToUiLogin,
  waitForRestoredMainWindow,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { createHash } from 'node:crypto';
import { evaluateHistory } from '../../../shared/test/scripts/stored-history-fixture.mjs';
import { waitForAsync } from '../../../shared/test/scripts/wait-for-async.mjs';
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

const targetVersion = workspace.platformRequire('./package.json').version;
const usesCurrentProfile = (version) => ['1.3.1', '1.3.2', '1.3.3', targetVersion].includes(version);
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 });
  if (result.error || result.status !== 0)
    throw result.error ?? Error(`${command}: ${result.stderr}`);
  return result.stdout;
};

async function snapshot(page, version = targetVersion) {
  return page.evaluate(async modern => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('copilot-local-documents');
      request.onupgradeneeded = () => request.transaction.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const expectedSchema = modern ? 2 : 1;
      if (db.version !== expectedSchema || modern !== db.objectStoreNames.contains('interviewRecords') ||
          (modern && localStorage.getItem('copilot-interview-history-v1') !== null))
        throw Error(`Unexpected profile storage: schema ${db.version}, expected ${expectedSchema}`);
      const rows = await new Promise((resolve, reject) => {
        const names = modern ? ['bases', 'documents', 'interviewRecords', 'interviewDirectory'] : ['bases', 'documents'];
        const tx = db.transaction(names, 'readonly');
        const bases = tx.objectStore('bases').getAll(), documents = tx.objectStore('documents').getAll();
        const history = modern && tx.objectStore('interviewRecords').getAll();
        const directory = modern && tx.objectStore('interviewDirectory').getAll();
        tx.oncomplete = () => {
          const records = modern ? history.result : JSON.parse(localStorage.getItem('copilot-interview-history-v1') || '[]');
          if (modern && (records.length !== directory.result.length || records.some(record =>
            !directory.result.some(entry => entry.id === record.id && entry.title === record.title &&
              entry.answerCount === record.answers.length && entry.revision)))) {
            reject(Error('History directory does not match its records'));
          } else resolve({ bases: bases.result, documents: documents.result, records });
        };
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      return {
        profile: JSON.parse(localStorage.getItem('copilot-personal-info-v1')),
        theme: localStorage.getItem('copilot-theme'),
        language: localStorage.getItem('voxcue-language-v1'),
        records: rows.records,
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
  }, usesCurrentProfile(version));
}

// Query the knowledge child selected by the live account, including its committed revision.
async function checkIndex(page, document, version) {
  const marker = Buffer.from(document.bytes).toString().split(' ')[0];
  const hash = createHash('sha256').update(Buffer.from(document.bytes)).digest('hex');
  const expectedVersion = usesCurrentProfile(version) ? 'qa-linked-v3' : version === '1.2.3' ? 'qa-linked-v2' : null;
  await waitForAsync(page, async ({ id, expectedVersion }) => {
    // Existing index metadata is immediately readable on restart. A real search
    // also requires the separate asynchronous verification of the owned models.
    const components = await window.desktop.components({ op: 'status' });
    if (components.error) throw Error(components.error);
    if (!components.items.some(item => item.id === 'rag' && item.phase === 'ready')) return false;
    const state = await window.desktop.knowledge({ op: 'status' });
    if (!state.ok || state.value.error) throw Error(state.error || state.value.error);
    const task = state.value.tasks.find(row => row.documentId === id);
    if (task?.phase === 'failed') throw Error(task.error || 'Reindex failed');
    return state.value.documents.some(row => row.documentId === id && row.chunkCount > 0 &&
      (!expectedVersion || row.indexVersion === expectedVersion) && row.available !== false);
  }, { id: document.id, expectedVersion }, { timeout: 120000 });
  const result = await page.evaluate(async ({ marker, doc }) => {
    const call = async value => {
      const result = await window.desktop.knowledge({ ...value, requestId: crypto.randomUUID() });
      if (!result.ok) throw Error(result.error);
      return result.value;
    };
    const hits = await call({ op: 'search', baseId: doc.baseId, query: marker, mode: 'keyword', topK: 5 });
    const hit = hits.find(item => item.documentId === doc.id);
    if (!hit?.revision) throw Error('The active account cannot retrieve its document');
    const item = await call({ op: 'item', itemId: hit.itemId,
      expected: { documentId: doc.id, baseId: doc.baseId, revision: hit.revision } });
    return { item, revision: hit.revision };
  }, { marker, doc: { id: document.id, baseId: document.baseId } });
  assert.match(result.revision, /^[a-f0-9]{64}$/);
  assert.equal(result.item.documentId, document.id);
  assert.equal(result.item.source.contentHash, hash);
  assert.equal(result.item.source.revision, result.revision);
  assert.ok(result.item.content.includes(marker));
  return result.revision;
}

async function accountPartition(app, page, expected) {
  const storagePath = await app.evaluate(({ session }, expected) => {
    const actual = session.fromPartition(expected).getStoragePath();
    if (!actual || actual === session.defaultSession.getStoragePath())
      throw Error('The named profile must have its own persistent storage');
    return actual;
  }, expected);
  const actual = await (await app.browserWindow(page)).evaluate((win) => {
    const prefs = win.webContents.getLastWebPreferences();
    return { storagePath: win.webContents.session.getStoragePath(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration };
  });
  assert.deepEqual(actual, { storagePath, sandbox: true, contextIsolation: true, nodeIntegration: false });
}

async function exerciseUpgradedShortcuts(app, main) {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app, globalShortcut, desktopCapturer, systemPreferences }) => {
    const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const permission = load(app.getAppPath() + '/dist-electron/macos/electron/screenPermission.js');
    permission.ScreenPermission.prototype.call = async action => {
      if (action !== 'check') throw Error('Unexpected screen permission request');
      return { status: 'denied', message: 'Synthetic screen permission' };
    };
    systemPreferences.getMediaAccessStatus = () => 'denied';
    desktopCapturer.getSources = async () => { throw Error('Upgrade fixture cannot capture the desktop'); };
    const register = globalShortcut.register.bind(globalShortcut);
    const unregister = globalShortcut.unregister.bind(globalShortcut);
    const callbacks = globalThis.upgradeShortcuts = new Map();
    globalShortcut.register = (key, callback) => {
      const success = register(key, callback);
      if (success && ['Control+Alt+K', 'Control+Shift+/'].includes(key)) callbacks.set(key, callback);
      return success;
    };
    globalShortcut.unregister = key => { unregister(key); callbacks.delete(key); };
  });
  await connectUiAccount(app, main);
  const [interview] = await Promise.all([
    app.waitForEvent('window', { predicate: async page => {
      await page.waitForLoadState('domcontentloaded');
      return page.url().endsWith('#interview');
    }, timeout: 15000 }),
    main.evaluate(() => window.desktop.openInterview({
      mode: 'local', inputMode: 'remote', options: { sources: ['system'] },
      aiEnabled: true, autoAnswer: false, modelId: 'test-model', effort: 'auto',
    })),
  ]);
  await interview.locator('.floating-toolbar').waitFor();
  await accountPartition(app, interview, 'persist:voxcue-user-' + ownerHash('synthetic@example.test'));
  const visible = async (hash, expected) => {
    await waitForAsync(app, ({ BrowserWindow }, { hash, expected }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith(hash));
      return expected ? !!win?.isVisible() && win.getOpacity() > 0.99 : !win?.isVisible();
    }, { hash, expected }, { timeout: 10000 });
  };
  const invoke = key => app.evaluate(({ globalShortcut }, key) => {
    if (!globalShortcut.isRegistered(key) || !globalThis.upgradeShortcuts.has(key))
      throw Error('Missing upgraded shortcut: ' + key);
    globalThis.upgradeShortcuts.get(key)();
  }, key);
  await visible('#interview', true);
  await visible('#interview-shortcuts', true);
  await invoke('Control+Alt+K');
  await visible('#interview', false);
  await invoke('Control+Alt+K');
  await visible('#interview', true);
  await visible('#interview-shortcuts', true);
  await invoke('Control+Shift+/');
  await visible('#interview-shortcuts', false);
  await invoke('Control+Shift+/');
  await visible('#interview-shortcuts', true);
  const closed = interview.waitForEvent('close');
  await interview.evaluate(() => window.desktop.confirmInterviewEnd());
  await closed;
}
const owner = email => email === 'synthetic@example.test' ? 'a0000000-0000-4000-8000-000000000001' : 'b0000000-0000-4000-8000-000000000002';
const ownerHash = email => createHash('sha256').update('account:' + owner(email)).digest('hex');
async function switchAccount(app, current, email) {
  const login = await returnToUiLogin(app, current, '退出登录');
  await accountPartition(app, login, 'persist:voxcue-login');
  await login.getByLabel('邮箱', { exact: true }).fill(email);
  await login.getByLabel('密码', { exact: true }).fill('Synthetic UI passphrase 2026!');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  const next = await waitForRestoredMainWindow(app);
  await accountPartition(app, next, 'persist:voxcue-user-' + ownerHash(email));
  return next;
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
  const currentProfile = usesCurrentProfile(fromVersion);
  const previousZip = await verifiedUpgradeArchive(fromVersion);
  const original = `upgrademacoriginal ${fromVersion} original: 中文与 English remain byte-for-byte intact.\n`;
  const baseName = `${fromVersion} 覆盖升级资料`;
  const background = `${fromVersion} 合成简历：TypeScript 与接口校验。`;
  const documentName = `preserved-${fromVersion}.md`;
  const directory = path.join(testRoot, `upgrade-from-${fromVersion}`);
  const install = path.join(directory, 'installed');
  const profile = path.join(directory, 'VoxCue');
  const assignmentFile = path.join(profile, 'legacy-profile-assignment-v1.json');
  const expectedAssignment = {
    owner: currentProfile ? null : ownerHash('synthetic@example.test'),
    files: false,
    browser: false,
  };
  await mkdir(install, { recursive: true });
  await mkdir(path.join(directory, 'tmp'));
  const { packagesFor } = workspace.platformRequire(
    path.join(
      workspace.platformRoot,
      'dist-electron/shared/electron/backend/components/catalog.js',
    ),
  );
  const { componentLocation } = workspace.platformRequire(
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
    const restored = version !== '1.1.1' && !!await lstat(path.join(profile, 'synthetic-primary.json')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    app =
      version === '1.1.1'
        ? await launchLegacyGuestProduct(bundle, env, version)
        : await launchGuestAsar(bundle, { env, upgradeAccounts: true });
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    if (restored) return waitForRestoredMainWindow(app);
    const login = await app.firstWindow();
    await login.waitForURL('**/index.html#login');
    // The legacy guest starts in its OS language. enterPrimaryUiAccount reloads
    // the page with the owned profile's language and verifies the Chinese title.
    return enterPrimaryUiAccount(app, login);
  };
  async function verifyNormalStart(version, before, revisions) {
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
    assert.deepEqual(await snapshot(reopened, version), before);
    for (const doc of before.documents) assert.equal(await checkIndex(reopened, doc, version), revisions[doc.id]);
    if (fromVersion === '1.2.3' && version === targetVersion) await exerciseUpgradedShortcuts(app, reopened);
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
    const record = { id: 'upgrade-interview-a', title: 'Synthetic owner A interview', startedAt: 1,
      endedAt: 2, status: 'ended', transcripts: [], answers: [], mock: false };
    if (currentProfile) {
      await evaluateHistory(old, record => fixtureHistory.replace([record]), record);
    } else {
      await old.evaluate(record => localStorage.setItem('copilot-interview-history-v1', JSON.stringify([record])), record);
    }
    const shortcuts = [['toggle-window', 'Control+Alt+K']];
    if (currentProfile) shortcuts.push(['toggle-shortcut-help', 'Control+Alt+J']);
    await old.evaluate(async shortcuts => {
      for (const [action, accelerator] of shortcuts) {
        const result = await window.desktop.shortcutSettings({ op: 'set', action, accelerator });
        if (result.rejected || result.state.error) throw Error('Old version rejected the custom shortcut');
      }
    }, shortcuts);
    const before = await snapshot(old, fromVersion);
    assert.equal(before.profile.name, 'Synthetic upgrade owner');
    assert.equal(before.profile.background, background);
    assert.equal(before.theme, 'dark');
    assert.equal(before.language, 'zh-CN');
    assert.equal(before.bases.length, 1);
    assert.equal(before.documents.length, 1);
    assert.equal(Buffer.from(before.documents[0].bytes).toString(), original);
    assert.deepEqual(before.records, [record]);
    assert.equal(before.bindings['toggle-window'], 'Control+Alt+K');
    assert.equal(before.bindings['toggle-shortcut-help'], currentProfile ? 'Control+Alt+J' : undefined);
    assert.equal(Object.keys(before.bindings).length, currentProfile ? 10 : 9);
    const oldOriginal = before.documents[0];
    const oldRevision = await checkIndex(old, oldOriginal, fromVersion);
    await closeUiApp(app);
    app = undefined;
    if (currentProfile)
      assert.deepEqual(JSON.parse(await readFile(assignmentFile, 'utf8')), expectedAssignment);
    if (fromVersion !== '1.1.1') {
      // Its hardened executable rejects inspectors. Keep its bytes and fuses
      // intact; verify ordinary product startup separately from ASAR inspection.
      await verifyNormalStart(fromVersion, before, { [oldOriginal.id]: oldRevision });
      console.log(
        `PASS: untouched published ${fromVersion} product started and quit normally; subsequent ASAR inspection confirmed the synthetic upgrade profile was preserved.`,
      );
    }
    await replaceOwnedBundle(bundle, zip);
    let current = await launch(targetVersion);
    const migrated = currentProfile
      ? before
      : { ...before, bindings: { ...before.bindings, 'toggle-shortcut-help': 'Control+Shift+/' } };
    const migratedRevision = await checkIndex(current, oldOriginal, targetVersion);
    // The pinned upgrade baselines all predate per-library index storage.
    assert.notEqual(migratedRevision, oldRevision, 'The shared index must be rebuilt from its retained original');
    await current.getByRole('button', { name: '面试记录', exact: true }).click();
    await current.getByText(record.title, { exact: true }).waitFor();
    assert.deepEqual(await snapshot(current), migrated);
    await accountPartition(app, current, 'persist:voxcue-user-' + ownerHash('synthetic@example.test'));
    assert.deepEqual(JSON.parse(await readFile(assignmentFile, 'utf8')), expectedAssignment);
    assert.equal(await current.evaluate(() => document.documentElement.classList.contains('dark')), true);
    await current.getByRole('button', { name: '新对话', exact: true }).click();
    await current.getByRole('button', { name: '个人信息', exact: true }).click();
    assert.equal(await current.getByRole('complementary', { name: '个人信息', exact: true })
      .getByLabel('姓名', { exact: true }).inputValue(), before.profile.name);
    await current.getByRole('button', { name: '个人信息', exact: true }).click();
    await current.getByRole('button', { name: '知识库', exact: true }).click();
    await current.locator('.knowledge-card').filter({ hasText: baseName }).click();
    const library = current.getByRole('dialog', { name: baseName, exact: true });
    const newFile = 'upgraded.md', newText = 'upgrademacnew synthetic new document.';
    await library.getByLabel('导入知识库文档').setInputFiles({ name: newFile, mimeType: 'text/markdown', buffer: Buffer.from(newText) });
    await library.locator('.document-row').filter({ hasText: newFile }).getByText(/索引完成$/).waitFor({ timeout: 120000 });
    const after = await snapshot(current);
    const added = after.documents.find(doc => doc.name === newFile);
    assert.ok(added);
    assert.equal(Buffer.from(added.bytes).toString(), newText);
    assert.deepEqual({ ...after, documents: after.documents.filter(doc => doc.id !== added.id) }, migrated);
    const revisions = { [oldOriginal.id]: migratedRevision, [added.id]: await checkIndex(current, added, targetVersion) };
    await library.getByRole('button', { name: '关闭对话框', exact: true }).click();
    if (fromVersion === '1.2.3') {
      const other = await switchAccount(app, current, 'other@example.test');
      const otherRecords = await evaluateHistory(other, async () => {
        const old = await fixtureHistory.read();
        await fixtureHistory.replace([{ id:'upgrade-interview-b', title:'Synthetic owner B interview',
          startedAt:3, endedAt:4, status:'ended', transcripts:[], answers:[], mock:false }]);
        return old;
      });
      assert.deepEqual(otherRecords, []);
      assert.equal((await snapshot(other)).documents.length, 0);
      const state = await other.evaluate(() => window.desktop.knowledge({op:'status'}));
      assert.deepEqual(state.value.documents, []);
      current = await switchAccount(app, other, 'synthetic@example.test');
      assert.deepEqual(await snapshot(current), after);
      const back = await switchAccount(app, current, 'other@example.test');
      assert.deepEqual((await snapshot(back)).records.map(item => item.id), ['upgrade-interview-b']);
      await switchAccount(app, back, 'synthetic@example.test');
    }
    await closeUiApp(app);
    app = undefined;
    await verifyNormalStart(targetVersion, after, revisions);
    console.log(`PASS: signed ${fromVersion} → ${targetVersion} archive replacement, profile ownership, original bytes, history, custom shortcuts, retained or rebuilt indexes and new imports across restart. The ordinary product startup and archived application inspection run separately in the guest.`);

  } finally {
    try {
      if (app) await closeUiApp(app);
    } finally {
      releaseDesktop();
    }
  }
}
