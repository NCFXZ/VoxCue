import { stageModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { verifyCachedComponent } from '../../../shared/test/scripts/verify-model-cache.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import {
  connectUiAccount,
  installUiAccount,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { readFile, mkdir, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, verify } from 'node:crypto';
import assert from 'node:assert/strict';
import { signMacApp } from '../../scripts/sign-app.mjs';
import { localSigningCertificate, verifyLocalApp } from '../../scripts/development-signing.mjs';
import { dmgTools } from '../../scripts/dmg-tools.mjs';
import { dmgLayout, withMountedDmg } from '../../scripts/dmg.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';
const require = createRequire(import.meta.url);
const version = JSON.parse(
  await readFile(path.join(workspace.platformRoot, 'package.json'), 'utf8'),
).version;
const release =
  process.env.VOXCUE_TEST_RELEASE_DIR || path.join(workspace.platformRoot, 'release', version);
const zip = path.join(release, `VoxCue-${version}-arm64.zip`);
const root = path.join(testRoot, 'installed');
await mkdir(root);
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status) throw result.error ?? Error(`${command}: ${result.stderr}`);
  return result.stdout;
};
run('/usr/bin/ditto', ['-x', '-k', zip, root]);
const bundle = path.join(root, 'VoxCue.app');
const signing = await localSigningCertificate();
verifyLocalApp(bundle, signing, 'com.voxcue.app');
assert.equal(
  run('/usr/bin/lipo', ['-archs', path.join(bundle, 'Contents/MacOS/VoxCue')]).trim(),
  'arm64',
);
const resources = path.join(bundle, 'Contents/Resources');
const credentialHelper = path.join(resources, 'native/VoxCue.Credentials');
verifyLocalApp(credentialHelper, signing, 'com.voxcue.credentials');
assert.deepEqual(
  await readFile(credentialHelper),
  await readFile(path.join(workspace.platformRoot, 'native/bin/VoxCue.Credentials')),
  'Packaging must preserve the fixed credential helper bytes and Keychain identity',
);
const config = JSON.parse(await readFile(path.join(resources, 'voxcue-update.json'), 'utf8'));
const pinned = JSON.parse(
  await readFile(path.join(workspace.platformRoot, 'update-public-key.json'), 'utf8'),
);
assert.equal(config.publicKey, pinned.publicKey);
const { signedMacUpdate, publicUpdateKey } = require(
  path.join(workspace.platformRoot, 'dist-electron/macos/electron/updates/manifest.js'),
);
const metadata = JSON.parse(await readFile(path.join(release, 'latest-mac.yml'), 'utf8'));
const update = signedMacUpdate(
  metadata,
  {
    version,
    manifest: 'latest-mac.yml',
    tag: 'v' + version,
    publishedAt: Date.now(),
    binary: { name: path.basename(zip), size: metadata.files[0].size },
  },
  config.publicKey,
);
assert.equal(update.minimumSystemVersion, '14.2');
assert.equal(
  verify(
    null,
    await readFile(zip),
    publicUpdateKey(pinned.publicKey),
    Buffer.from(update.edSignature, 'base64'),
  ),
  true,
  'The final update archive must authenticate with the existing pinned public key',
);
const hash = createHash('sha512');
for await (const chunk of createReadStream(zip)) hash.update(chunk);
assert.equal(hash.digest('base64'), update.sha512);
console.log(
  'PASS: final ZIP Ed25519 signature, signed update metadata and SHA512 match the pinned public key.',
);
assert.equal(
  run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :SUPublicEDKey',
    path.join(bundle, 'Contents/Info.plist'),
  ]).trim(),
  config.publicKey,
);
const asar = await import(workspace.platformRequire.resolve('@electron/asar'));
const entries = asar.listPackage(path.join(resources, 'app.asar'));
assert.equal(
  JSON.parse(
    asar.extractFile(path.join(resources, 'app.asar'), 'node_modules/zod/package.json').toString(),
  ).version,
  '4.6.6',
);
assert.ok(
  !entries.some((file) => /\/node_modules\/zod\/.* \d+\./.test(file)),
  'File Provider numbered replicas must not enter the runtime archive',
);
assert.equal(
  JSON.parse(asar.extractFile(path.join(resources, 'app.asar'), 'package.json').toString()).version,
  version,
);
for (const key of ['CFBundleVersion', 'CFBundleShortVersionString'])
  assert.equal(
    run('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :' + key,
      path.join(bundle, 'Contents/Info.plist'),
    ]).trim(),
    version,
  );
const bundleIcon = run('/usr/libexec/PlistBuddy', [
  '-c',
  'Print :CFBundleIconFile',
  path.join(bundle, 'Contents/Info.plist'),
]).trim();
assert.equal(path.basename(bundleIcon), bundleIcon);
assert.deepEqual(
  await readFile(
    path.join(resources, bundleIcon.endsWith('.icns') ? bundleIcon : bundleIcon + '.icns'),
  ),
  await readFile(path.join(workspace.platformRoot, 'public/voxcue.icns')),
  'The final application must carry the current branded ICNS artwork',
);
assert.ok(!entries.some((file) => /^\/(?:\.tools|\.git|test|server|admin|windows)\//.test(file)));
assert.ok(!entries.some((file) => file.includes('ed25519.key')));
assert.ok(
  !entries.some((file) =>
    /development-signing|keychain-password|local-signing-public|\.keychain-db/.test(file),
  ),
);
assert.ok(entries.includes('/dist-electron/macos/electron/speech/echoCancellation.js'));
assert.ok(entries.some((file) => file.endsWith('/webrtcaec3.js/dist/webrtcaec3-0.3.0.wasm')));
assert.equal(
  await lstat(path.join(resources, 'native/VoxCue.WindowMaterial.node')).catch(() => null),
  null,
);
assert.ok(entries.includes('/dist-electron/macos/electron/updates/driver.js'));
assert.ok(entries.includes('/dist-electron/macos/electron/credentials.js'));
assert.ok(!entries.some((file) => /node_modules\/onnxruntime-web(?:\/|$)/.test(file)));
assert.ok(entries.includes('/dist-electron/shared/electron/backend/copilot/runtime.js'));
assert.ok(entries.includes('/dist-electron/shared/electron/backend/chat/codexUsage.js'));
assert.ok(entries.includes('/node_modules/@openai/codex/package.json'));
assert.ok(
  entries.includes(
    '/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
  ),
);
assert.ok(entries.includes('/node_modules/@github/copilot-sdk/dist/cjs/index.js'));
assert.ok(
  entries.includes(
    '/node_modules/@github/copilot-sdk-darwin-arm64/prebuilds/darwin-arm64/copilot-runtime',
  ),
);
assert.ok(entries.some((file) => file.includes('/onnxruntime-node/')));
assert.equal(await lstat(path.join(resources, 'models')).catch(() => null), null);
const tools = await dmgTools();
const layout = JSON.parse(await readFile(tools.layout, 'utf8'));
const mount = path.join(testRoot, 'dmg-mount');
await mkdir(mount);
await withMountedDmg(
  path.join(release, `VoxCue-${version}-arm64.dmg`),
  mount,
  async () => {
    const stored = JSON.parse(dmgLayout(tools, 'read', mount));
    assert.deepEqual(stored.positions, {
      'VoxCue.app': [layout.application.x, layout.application.y],
      Applications: [layout.destination.x, layout.destination.y],
    });
    assert.equal(stored.destination, '/Applications');
    assert.equal(stored.iconView.iconSize, layout.iconSize);
    assert.equal(stored.iconView.backgroundType, 2);
    assert.equal(stored.window.ShowToolbar, false);
    assert.equal(stored.window.ShowSidebar, false);
    const dmgApp = path.join(mount, 'VoxCue.app');
    verifyLocalApp(dmgApp, signing, 'com.voxcue.app');
    for (const file of ['Contents/MacOS/VoxCue', 'Contents/Resources/app.asar'])
      assert.deepEqual(
        await readFile(path.join(dmgApp, file)),
        await readFile(path.join(bundle, file)),
      );
    const info = run('/usr/bin/tiffutil', [
      '-info',
      path.join(mount, '.background/background.tiff'),
    ]);
    assert.equal((info.match(/^Directory at /gm) ?? []).length, 2);
    assert.match(info, /Resolution: 144, 144/);
  },
  true,
);
console.log(
  'PASS: final DMG preserves the signed ZIP app, installation layout and Retina background.',
);
assert.equal(
  run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :LSMinimumSystemVersion',
    path.join(bundle, 'Contents/Info.plist'),
  ]).trim(),
  '14.2',
);
const runtime = spawnSync(
  path.join(bundle, 'Contents/MacOS/VoxCue'),
  [
    '-e',
    'console.log(JSON.stringify({electron:process.versions.electron,arch:process.arch,abi:process.versions.modules}))',
  ],
  { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
);
assert.equal(runtime.status, 0, runtime.stderr);
assert.deepEqual(JSON.parse(runtime.stdout), { electron: '44.10.0', arch: 'arm64', abi: '149' });
console.log(
  'PASS: actual final executable is Electron44.10.0/arm64/ABI149; bundle minimum is macOS14.2.',
);
if (process.argv.includes('--static-only')) {
  console.log(
    'PENDING: packaged window/Worker/component/update staging acceptance requires unlocked desktop; static artifact checks passed.',
  );
  process.exit(2);
}
const releaseDesktop = holdDesktopAwake();
const loginHitProbe = path.join(testRoot, 'login-hit-probe.node');
run('/usr/bin/xcrun', [
  'clang++',
  '-std=c++17',
  '-fobjc-arc',
  '-DNAPI_VERSION=8',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-arch',
  'arm64',
  '-mmacosx-version-min=14.2',
  '-I',
  path.join(workspace.platformRoot, '.cache/node-api-headers'),
  path.join(workspace.platformRoot, 'test/fixtures/login-hit-probe.mm'),
  '-framework',
  'AppKit',
  '-o',
  loginHitProbe,
]);
run('/usr/bin/codesign', ['--force', '--sign', '-', loginHitProbe]);
const installArchive = process.argv.includes('--install-archive');
if (installArchive) {
  run('/usr/libexec/PlistBuddy', [
    '-c',
    'Set :CFBundleVersion 0.2.0',
    path.join(bundle, 'Contents/Info.plist'),
  ]);
  run('/usr/libexec/PlistBuddy', [
    '-c',
    'Set :CFBundleShortVersionString 0.2.0',
    path.join(bundle, 'Contents/Info.plist'),
  ]);
  await signMacApp(bundle);
}
const profile = path.join(testRoot, 'profile');
await mkdir(path.join(testRoot, 'tmp'));
const cacheSource = process.env.VOXCUE_TEST_COMPONENT_CACHE;
const { packagesFor } = require(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/catalog.js'),
);
const { componentLocation } = require(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/service.js'),
);
const cachedPackages = packagesFor(process.platform, process.arch).filter((pkg) => !pkg.optional);
if (cacheSource)
  await stageModelFixtures(
    path.resolve(cacheSource),
    path.join(profile, 'artifact-components'),
    cachedPackages,
    componentLocation,
  );
const app = await electron.launch({
  executablePath: path.join(bundle, 'Contents/MacOS/VoxCue'),
  args: [],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: profile,
    TMPDIR: path.join(testRoot, 'tmp'),
    CFFIXED_USER_HOME: path.join(testRoot, 'foundation-home'),
    XDG_CACHE_HOME: path.join(testRoot, 'cache'),
    XDG_DATA_HOME: path.join(testRoot, 'data'),
    XDG_STATE_HOME: path.join(testRoot, 'state'),
    VITE_DEV_SERVER_URL: '',
    // This is a real packaged host, so telemetry is enabled. Keep all synthetic
    // package activity local; model/update fixtures use their own transports.
    VOXCUE_ACCOUNT_API: '',
  },
});
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  const loginWindowId = await (await app.browserWindow(page)).evaluate((window) => window.id);
  const assertNativeLoginHit = async (point, expected, label) => {
    const deadline = Date.now() + 5000;
    let actual;
    do {
      requireUnlockedDesktop();
      actual = await app.evaluate(
        ({ app, BrowserWindow }, { probe, point, id, owner }) => {
          if (!app.getPath('userData').startsWith(owner + '/'))
            throw Error('Synthetic package profile required');
          const load = process
            .getBuiltinModule('module')
            .createRequire(app.getAppPath() + '/package.json');
          return JSON.parse(
            load(probe).probe(BrowserWindow.fromId(id).getNativeWindowHandle(), point.x, point.y),
          );
        },
        { probe: loginHitProbe, point, id: loginWindowId, owner: testRoot },
      );
      if (actual.nativeHit && actual.contentReceivesMouse === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.fail(label + ': ' + JSON.stringify(actual));
  };
  const assertNativeButton = async (name) => {
    const point = await page.getByRole('button', { name, exact: true }).evaluate((node) => {
      const box = node.getBoundingClientRect();
      return {
        x: (box.left + box.width / 2) / innerWidth,
        y: (box.top + box.height / 2) / innerHeight,
      };
    });
    await assertNativeLoginHit(point, true, name + ' must receive native mouse input');
  };
  await assertNativeLoginHit(
    { x: 0.5, y: 36 / (await page.evaluate(() => innerHeight)) },
    false,
    'Packaged top drag strip',
  );
  await assertNativeButton('找回密码');
  await page.getByRole('button', { name: '找回密码', exact: true }).click();
  await assertNativeButton('获取验证码');
  // Do not request a real code; this checks native routing of the final ASAR.
  await page.getByRole('button', { name: '返回登录', exact: true }).click();
  console.log(
    'PASS: final packaged Mac login top-only native drag and reset/code content hit routing; no real code requested.',
  );
  assert.equal(
    await app.evaluate(() => process.versions.electron),
    workspace.platformRequire('electron/package.json').version,
  );
  assert.equal(
    await page.evaluate(() =>
      window.desktop.enterDemo().then(
        () => false,
        () => true,
      ),
    ),
    true,
    'Packaged demo entry must be rejected before fixture injection',
  );
  const fixtures = require(path.join(workspace.sharedRoot, 'test/scripts/rag-fixtures.cjs'));
  const checks = await app.evaluate(
    async ({ app, utilityProcess, net }, fixture) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const path = require('node:path'),
        fs = require('node:fs');
      const assert = require('node:assert/strict');
      const { Worker } = require('node:worker_threads');
      const unpacked = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked');
      const { ComponentService, componentPaths, componentLocation } = require(
        app.getAppPath() + '/dist-electron/shared/electron/backend/components/service.js',
      );
      const { packagesFor } = require(
        app.getAppPath() + '/dist-electron/shared/electron/backend/components/catalog.js',
      );
      const cache = path.join(app.getPath('userData'), 'artifact-components');
      const packages = packagesFor(process.platform, process.arch);
      const options = { root: cache, packages, managed: true, emit() {} };
      const components = new ComponentService({ ...options, fetch: net.fetch.bind(net) });
      try {
        assert.equal((await components.status()).phase, fixture.reuse ? 'ready' : 'needed');
        assert.equal((await components.download()).phase, 'ready');
        const extra = path.join(
          componentLocation(
            cache,
            packages.find((item) => item.id === 'speech'),
          ),
          'protected-original.txt',
        );
        fs.writeFileSync(extra, 'Synthetic protected original');
        assert.equal((await components.remove('speech')).phase, 'error');
        assert.equal(fs.readFileSync(extra, 'utf8'), 'Synthetic protected original');
        fs.unlinkSync(extra);
      } finally {
        components.dispose();
      }
      const cached = new ComponentService({
        ...options,
        fetch() {
          throw Error('Verified cache must not require network');
        },
      });
      try {
        assert.equal((await cached.status()).phase, 'ready');
        assert.equal((await cached.download()).phase, 'ready');
      } finally {
        cached.dispose();
      }
      const models = componentPaths(cache, packages);
      const model = models.speechModels;
      const worker = new Worker(
        path.join(unpacked, 'dist-electron/shared/electron/backend/speech/worker.js'),
      );
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(Error('Packaged ASR initialization timeout')),
            45000,
          );
          worker.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          worker.on('message', (message) => {
            if (!message.ready && !message.error) return;
            clearTimeout(timeout);
            message.error ? reject(Error(message.error)) : resolve();
          });
          worker.postMessage({
            op: 'init',
            directory: model,
            preprocessorFile: path.join(
              unpacked,
              'dist-electron/macos/electron/speech/echoCancellation.js',
            ),
          });
        });
      } finally {
        await worker.terminate();
      }
      const child = utilityProcess.fork(
        path.join(unpacked, 'dist-electron/macos/electron/speech/process.js'),
        [],
        { serviceName: 'VoxCue temporary package verification', stdio: 'pipe' },
      );
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('Packaged speech utility timeout')), 15000);
          child.on('message', (message) => {
            if (message.error) {
              clearTimeout(timeout);
              reject(Error(message.error));
            } else if (message.id === 'init')
              child.postMessage({ id: 'status', call: { op: 'status' } });
            else if (message.id === 'status') {
              clearTimeout(timeout);
              assert.equal(message.value.state, 'idle');
              resolve();
            }
          });
          child.once('exit', (code) => {
            clearTimeout(timeout);
            reject(Error('Utility exited ' + code));
          });
          child.postMessage({
            id: 'init',
            init: true,
            model,
            helper: path.join(process.resourcesPath, 'native/VoxCue.Audio'),
          });
        });
      } finally {
        child.kill();
      }
      const { KnowledgeHost } = require(
        app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js',
      );
      const knowledge = new KnowledgeHost(
        path.join(app.getPath('userData'), 'rag'),
        models.ragModel,
      );
      try {
        await knowledge.initialize();
        const signal = new AbortController().signal;
        await knowledge.indexDocument(
          {
            documentId: 'fixture',
            baseId: 'fixture',
            name: 'fixture.md',
            bytes: Buffer.from(
              '## Q001. PID lift-off control?\n\nPID feedback controls sensor lift-off and output is limited to 2.',
            ),
          },
          signal,
        );
        await knowledge.indexDocument(
          {
            documentId: 'pdf',
            baseId: 'fixture',
            name: 'fixture.pdf',
            bytes: new Uint8Array(fixture.pdf),
          },
          signal,
        );
        await knowledge.indexDocument(
          {
            documentId: 'docx',
            baseId: 'fixture',
            name: 'fixture.docx',
            bytes: new Uint8Array(fixture.docx),
          },
          signal,
        );
        for (const mode of ['keyword', 'vector', 'hybrid'])
          assert.ok((await knowledge.search('PID sensor control', 3, mode, signal)).length);
      } finally {
        await knowledge.close();
      }
      const binding = require(
        path.join(process.resourcesPath, 'native/VoxCue.ScreenPermission.node'),
      );
      assert.equal(typeof binding.preflight, 'function');
      const { createMacUpdateDriver } = require(
        app.getAppPath() + '/dist-electron/macos/electron/updates/driver.js',
      );
      const driver = createMacUpdateDriver();
      driver.dispose();
      assert.equal(app.isPackaged, true);
      assert.ok(fs.existsSync(path.join(app.getAppPath(), 'public/voxcue.png')));
      return [
        'packaged login',
        fixture.reuse
          ? 'authenticated local copies and offline model cache reuse'
          : 'thin package downloads and offline model cache reuse',
        'unknown component-root originals protected during deletion',
        'arm64 native bindings',
        'PDF/DOCX parsing',
        'Paraformer Worker with packaged local AEC WASM',
        'speech utilityProcess',
        'offline E5/LanceDB keyword/vector/hybrid',
        'pinned Sparkle updater configuration',
      ];
    },
    {
      pdf: Array.from(fixtures.pdf()),
      docx: Array.from(await fixtures.docx()),
      reuse: !!cacheSource,
    },
  );
  console.log('PASS: ' + checks.join(', '));
  assert.equal(
    await app.evaluate(() => {
      const require = process.getBuiltinModule('module').createRequire(process.resourcesPath + '/');
      return require('node:fs').existsSync(
        process.resourcesPath + '/native/VoxCue.SidebarGlass.node',
      );
    }),
    false,
    'Removed presentation binding must not ship',
  );
  await installUiAccount(app, { components: true, speech: true });
  // The real host starts with no account origin to keep telemetry offline.
  // Refresh the renderer after installing the synthetic account service.
  await page.reload();
  const mainPage = await connectUiAccount(app, page);
  {
    await mainPage.waitForFunction(() =>
      document.documentElement.classList.contains('web-materials'),
    );
    assert.equal(await mainPage.evaluate(() => 'setContentControls' in window.desktop), false);
    const start = await mainPage
      .getByRole('button', { name: '开始面试', exact: true })
      .boundingBox();
    const toolbar = await mainPage.locator('.page-toolbar').boundingBox();
    assert.equal(start.height, 36);
    assert.ok(Math.abs(start.y + start.height / 2 - toolbar.y - toolbar.height / 2) < 1);
    const composer = mainPage;
    const input = composer.getByRole('textbox', { name: '聊天消息', exact: true });
    await input.fill('Packaged shared UI regression');
    assert.equal(await input.evaluate((node) => getComputedStyle(node).fontSize), '14px');
    assert.equal(
      await composer
        .locator('.chat-composer .composer')
        .evaluate((node) => getComputedStyle(node).borderRadius),
      '40px',
    );
    await composer.getByRole('button', { name: '发送消息', exact: true }).click();
    await mainPage.locator('.chat-message.assistant').waitFor();
    assert.equal(
      await mainPage
        .locator('.conversation-row.active')
        .evaluate((node) => getComputedStyle(node, '::before').borderRadius),
      '999px',
    );
    console.log(
      'PASS: final package uses shared controls, aligned toolbar, 40px composer, synthetic chat and capsule marker.',
    );
  }
  if (installArchive) {
    const { installFeed } = require(
      path.join(workspace.platformRoot, 'dist-electron/macos/electron/updates/install-feed.js'),
    );
    const feed = await installFeed(zip, update);
    try {
      await app.evaluate(async (_electron, url) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(_electron.app.getAppPath() + '/package.json');
        const path = require('node:path');
        const native = require(path.join(process.resourcesPath, 'native/VoxCue.Updater.node'));
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
      }, feed.url);
      assert.equal(
        run('/usr/libexec/PlistBuddy', [
          '-c',
          'Print :CFBundleVersion',
          path.join(bundle, 'Contents/Info.plist'),
        ]).trim(),
        '0.2.0',
      );
      console.log(
        'PASS: real Sparkle authenticated and staged the final production archive; cancellation retained the temporary old app.',
      );
    } finally {
      feed.close();
    }
  }
  if (process.argv.includes('--online')) {
    const result = await app.evaluate(async ({ app }) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const originalVersion = app.getVersion.bind(app);
      const installedVersion = originalVersion();
      app.getVersion = () => '0.2.0';
      const driver = require(
        app.getAppPath() + '/dist-electron/macos/electron/updates/driver.js',
      ).createMacUpdateDriver();
      const events = [];
      let downloaded = false;
      driver.on('update-available', (event) => events.push(event));
      driver.on('update-downloaded', () => {
        downloaded = true;
      });
      try {
        await driver.checkForUpdates();
        await driver.downloadUpdate();
        return { events, downloaded, installedVersion };
      } finally {
        driver.dispose();
        app.getVersion = originalVersion;
      }
    });
    assert.equal(result.events[0]?.version, version);
    assert.equal(result.installedVersion, version);
    assert.equal(result.downloaded, true);
    console.log(
      'PASS: installed Mac updater selected and authenticated the published GitHub release, downloaded its full archive, and verified SHA512.',
    );
  }
} finally {
  releaseDesktop();
  await closeUiApp(app);
}

if (cacheSource)
  for (const pkg of cachedPackages)
    await verifyCachedComponent(componentLocation(path.resolve(cacheSource), pkg), pkg);
