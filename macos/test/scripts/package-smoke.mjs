import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { readFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { signMacApp } from '../../scripts/sign-app.mjs';
const require = createRequire(import.meta.url);
const version = JSON.parse(
  await readFile(path.join(workspace.platformRoot, 'package.json'), 'utf8'),
).version;
const release = path.join(workspace.platformRoot, 'release', version);
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
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
assert.equal(
  run('/usr/bin/lipo', ['-archs', path.join(bundle, 'Contents/MacOS/VoxCue')]).trim(),
  'arm64',
);
const resources = path.join(bundle, 'Contents/Resources');
const config = JSON.parse(await readFile(path.join(resources, 'voxcue-update.json'), 'utf8'));
const { signedMacUpdate } = require(
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
const hash = createHash('sha512');
for await (const chunk of createReadStream(zip)) hash.update(chunk);
assert.equal(hash.digest('base64'), update.sha512);
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
assert.ok(!entries.some((file) => /^\/(?:\.tools|\.git|test|windows)\//.test(file)));
assert.ok(!entries.some((file) => file.includes('ed25519.key')));
assert.ok(entries.includes('/dist-electron/macos/electron/updates/driver.js'));
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
  },
});
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  const fixtures = require(path.join(workspace.sharedRoot, 'test/scripts/rag-fixtures.cjs'));
  const checks = await app.evaluate(
    async ({ app, utilityProcess }, fixture) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const path = require('node:path'),
        fs = require('node:fs');
      const assert = require('node:assert/strict');
      const { Worker } = require('node:worker_threads');
      const unpacked = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked');
      const model = path.join(process.resourcesPath, 'models/speech');
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
          worker.postMessage({ op: 'init', directory: model });
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
        path.join(process.resourcesPath, 'models/rag/multilingual-e5-small'),
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
        'arm64 native bindings',
        'PDF/DOCX parsing',
        'Paraformer Worker',
        'speech utilityProcess',
        'offline E5/LanceDB keyword/vector/hybrid',
        'pinned Sparkle updater configuration',
      ];
    },
    { pdf: Array.from(fixtures.pdf()), docx: Array.from(await fixtures.docx()) },
  );
  console.log('PASS: ' + checks.join(', '));
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
  await app.close();
}
