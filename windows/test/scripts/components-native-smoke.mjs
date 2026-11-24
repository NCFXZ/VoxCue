import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { waitForAsync } from '../../../shared/test/scripts/wait-for-async.mjs';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { checkComponents } from './components-check.mjs';
import { checkComponentRemoval } from './component-removal-check.mjs';
import { stageModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { verifyCachedComponent } from '../../../shared/test/scripts/verify-model-cache.mjs';

assert.equal(process.platform, 'win32');
const profile = path.join(testRoot, 'profile');
await mkdir(profile);
const cacheSource = process.env.VOXCUE_TEST_COMPONENT_CACHE;
const { packagesFor } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/catalog.js'),
);
const { componentLocation } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/service.js'),
);
const cachedPackages = packagesFor(process.platform, process.arch).filter((pkg) => !pkg.optional);
const restoreCached = cacheSource
  ? () =>
      stageModelFixtures(
        path.resolve(cacheSource),
        path.join(profile, 'component-cache'),
        cachedPackages,
        componentLocation,
      )
  : undefined;
if (restoreCached) await restoreCached();
const fixture = path.join(testRoot, 'managed-components.cjs');
await writeFile(
  fixture,
  [
    "const path = require('node:path');",
    'const root = ' + JSON.stringify(workspace.platformRoot) + ';',
    'const temporary = ' + JSON.stringify(testRoot) + ';',
    "require('electron').app.setAppPath(root);",
    "const platform = require(path.join(root, 'dist-electron/shared/electron/platform/index.js'));",
    'const resources = platform.desktopResources;',
    'platform.desktopResources = (...args) => ({',
    '  ...resources(...args),',
    "  speechModels: path.join(temporary, 'missing-speech'),",
    "  ragModel: path.join(temporary, 'missing-rag'),",
    '});',
    "require(path.join(root, 'dist-electron/shared/electron/main.js'));",
  ].join('\n'),
);
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: profile,
  VITE_DEV_SERVER_URL: '',
};
// Force the production managed component-cache path in this temporary profile.
// Other native suites may pass unmanaged fixtures; this one tests real removal.
delete env.VOXCUE_TEST_SPEECH_MODELS;
delete env.VOXCUE_TEST_RAG_MODEL;
delete env.ELECTRON_RUN_AS_NODE;
const launch = async () =>
  electron.launch({
    args: [await offlineElectronEntry(fixture, { componentDownloads: !cacheSource })],
    env,
  });
let app;
try {
  app = await launch();
  await app.evaluate(async ({ app, session }) => {
    await app.whenReady();
    const controller = new AbortController();
    let refused = false;
    try {
      await session.fromPartition('offline-abort-regression').fetch('https://example.invalid/', {
        signal: controller.signal,
      });
    } catch (error) {
      if (!/Offline desktop regression forbids network access/.test(error.message)) throw error;
      refused = true;
    }
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 30));
    if (!refused) throw Error('Offline session fetch was not refused');
  });
  if (cacheSource) {
    const login = await app.firstWindow();
    await waitForAsync(
      login,
      async () => (await window.desktop.components({ op: 'status' })).phase === 'ready',
      undefined,
      { timeout: 30000 },
    );
  } else {
    const { errors } = await checkComponents(app);
    assert.deepEqual(errors, []);
  }
  await closeUiApp(app);
  app = await launch();
  const login = await app.firstWindow();
  await login.waitForLoadState('domcontentloaded');
  await login
    .getByRole(login.url().endsWith('#login') ? 'heading' : 'button', {
      name: login.url().endsWith('#login') ? '登录 VoxCue' : '用户菜单',
      exact: true,
    })
    .waitFor();
  await app.evaluate(({ session }) => {
    globalThis.componentReuseRequests = [];
    session.fromPartition('voxcue-components').webRequest.onBeforeRequest((details, callback) => {
      globalThis.componentReuseRequests.push(details.url);
      callback({ cancel: true });
    });
  });
  await waitForAsync(
    login,
    async () => (await window.desktop.components({ op: 'status' })).phase === 'ready',
    undefined,
    { timeout: 30000 },
  );
  assert.deepEqual(await app.evaluate(() => globalThis.componentReuseRequests), []);
  await checkComponentRemoval(app, login, restoreCached);
  if (cacheSource)
    for (const pkg of cachedPackages)
      await verifyCachedComponent(componentLocation(path.resolve(cacheSource), pkg), pkg);
  console.log(
    'PASS: Windows development build, real managed components, cache reuse, native exclusive handles and removal; no package or installer created.',
  );
} catch (error) {
  console.error('Native components failed before teardown:', error);
  throw error;
} finally {
  if (app) await closeUiApp(app);
}
