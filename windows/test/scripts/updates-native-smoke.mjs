import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/updates-native-')));
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
const output = path.join(profile, 'download-fixture');
await mkdir(output);
const fixtureBytes = Buffer.concat([
  Buffer.from('Synthetic update transport fixture; this file is never executed.'),
  Buffer.alloc(128 * 1024, 0x5a),
]);
const digest = createHash('sha512').update(fixtureBytes).digest('base64');
const info = {
  version: '99.0.1',
  path: 'VoxCue-Setup-99.0.1-x64.exe',
  sha512: digest,
  files: [{ url: 'VoxCue-Setup-99.0.1-x64.exe', size: fixtureBytes.length, sha512: digest }],
};
const metadata = yaml.dump(info);
await writeFile(path.join(output, info.path), fixtureBytes);
const installer = path.join(output, info.path);
assert.equal(path.dirname(installer), output);
const installerSize = (await stat(installer)).size;
const bad = Buffer.from('synthetic corrupted update');
let corrupt = true;
let holdInstaller = false;
let heldInstaller;
let installerHeld;
const transportCounts = { releases: 0, manifests: 0, installers: 0 };
const platformRequests = [];
const server = createServer((request, response) => {
  const name = new URL(request.url, 'http://127.0.0.1').pathname;
  if (name === '/platform-releases') {
    transportCounts.releases++;
    const asset = (name, size) => ({ name, size, state: 'uploaded' });
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify([
        {
          draft: false,
          prerelease: false,
          published_at: '2026-10-15T02:00:00Z',
          tag_name: 'mac-only-v99.0.0',
          name: 'Latest is Mac only',
          assets: [asset('latest-mac.yml', 350), asset('VoxCue-99.0.0-arm64.zip', 100)],
        },
        {
          draft: false,
          prerelease: false,
          published_at: '2026-10-14T02:00:00Z',
          tag_name: 'windows-native-v' + info.version,
          assets: [
            asset('latest.yml', Buffer.byteLength(metadata)),
            asset(info.path, installerSize),
            asset(info.path + '.blockmap', 10),
          ],
        },
      ]),
    );
  } else if (name === '/platform-manifest') {
    transportCounts.manifests++;
    response.writeHead(200, { 'Content-Type': 'text/yaml' }).end(metadata);
  } else if (name === '/platform-installer') {
    transportCounts.installers++;
    if (corrupt) response.writeHead(200, { 'Content-Length': bad.length }).end(bad);
    else if (holdInstaller) {
      heldInstaller = response;
      response.writeHead(200, { 'Content-Length': installerSize });
      response.write(fixtureBytes.subarray(0, 32 * 1024));
      response.once('close', () => { if (heldInstaller === response) heldInstaller = undefined; });
      installerHeld?.();
    }
    else {
      response.writeHead(200, { 'Content-Length': installerSize });
      createReadStream(installer).pipe(response);
    }
  } else if (name === '/latest.yml') {
    const body = corrupt
      ? yaml.dump({
          version: info.version,
          files: [
            {
              url: 'corrupt.exe',
              size: bad.length,
              sha512: createHash('sha512').update('different bytes').digest('base64'),
            },
          ],
          path: 'corrupt.exe',
          sha512: createHash('sha512').update('different bytes').digest('base64'),
        })
      : metadata;
    response.writeHead(200, { 'Content-Type': 'text/yaml' }).end(body);
  } else if (name === '/corrupt.exe')
    response.writeHead(200, { 'Content-Length': bad.length }).end(bad);
  else if (name === '/' + info.path) {
    response.writeHead(200, { 'Content-Length': installerSize });
    createReadStream(installer).pipe(response);
  } else response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const fixture = path.join(profile, 'main.cjs');
await writeFile(
  fixture,
  `const {app}=require('electron'); app.setPath('userData',${JSON.stringify(profile)}); app.whenReady();`,
);
const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: undefined,
  VOXCUE_TEST_LOOPBACK_PORT: String(server.address().port),
};
let app;
try {
  app = await electron.launch({ args: [fixture], env });
  await app.evaluate(({ net }, port) => {
    const assert = process
      .getBuiltinModule('module')
      .createRequire(process.cwd() + '/package.json')('node:assert/strict');
    for (const attempt of [
      () => fetch('https://example.invalid'),
      () => net.request('http://127.0.0.1:' + (port === 65535 ? 65534 : port + 1)),
      () => net.request('https://example.invalid'),
    ])
      assert.throws(attempt, /Offline desktop regression forbids network access/);
  }, server.address().port);
  await app.evaluate(
    async ({ app }, { root, profile, port }) => {
      await app.whenReady();
      const require = process.getBuiltinModule('module').createRequire(root + '/package.json');
      const fs = require('node:fs');
      const path = require('node:path');
      const { NsisUpdater } = require('electron-updater');
      const { UpdateService } = require(
        root + '/dist-electron/shared/electron/backend/updates/service.js',
      );
      app.getVersion = () => '0.0.0';
      const updater = new NsisUpdater({ provider: 'generic', url: 'http://127.0.0.1:' + port });
      Object.defineProperty(updater.app, 'baseCachePath', { value: profile });
      const config = path.join(profile, 'app-update.yml');
      fs.writeFileSync(
        config,
        JSON.stringify({
          provider: 'generic',
          url: 'http://127.0.0.1:' + port,
          updaterCacheDirName: 'cache',
        }),
      );
      updater.updateConfigPath = config;
      updater.logger = null;
      updater.forceDevUpdateConfig = true;
      updater.disableDifferentialDownload = true;
      // The raw generic updater takes CancellationToken. UpdateService's port
      // now takes AbortSignal; production configurePlatformUpdates bridges it.
      // Keep this independent generic transport probe on that same public port.
      const { CancellationToken } = process
        .getBuiltinModule('module')
        .createRequire(require.resolve('electron-updater/package.json'))('builder-util-runtime');
      const download = updater.downloadUpdate.bind(updater);
      updater.downloadUpdate = async (signal) => {
        const cancellation = new CancellationToken();
        const abort = () => cancellation.cancel();
        signal?.throwIfAborted();
        signal?.addEventListener('abort', abort, { once: true });
        try {
          return await download(cancellation);
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      };
      globalThis.nativeUpdater = updater;
      globalThis.nativeUpdates = new UpdateService({
        currentVersion: '0.0.0',
        driver: updater,
        isInterviewActive: () => false,
        prepareInstall: async () => {
          throw Error('Installation is never allowed in this transport test');
        },
        emit: () => {},
      });
    },
    { root: process.cwd(), profile, port: server.address().port },
  );
  const failed = await app.evaluate(() =>
    globalThis.nativeUpdates.start().then(() => globalThis.nativeUpdates.state()),
  );
  assert.equal(failed.phase, 'error');
  assert.match(failed.error, /校验失败/);
  corrupt = false;
  const ready = await app.evaluate(async () => {
    await globalThis.nativeUpdates.check();
    return globalThis.nativeUpdates.download();
  });
  assert.equal(ready.phase, 'downloaded');
  const hash = await app.evaluate(async () => {
    const fs = process.getBuiltinModule('fs');
    const crypto = process.getBuiltinModule('crypto');
    const hash = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(globalThis.nativeUpdater.installerPath))
      hash.update(chunk);
    return hash.digest('base64');
  });
  assert.equal(hash, info.sha512);
  assert.equal(await app.evaluate(() => globalThis.nativeUpdater.autoInstallOnAppQuit), false);
  await app.evaluate(() => globalThis.nativeUpdates.dispose());
  corrupt = true;
  await app.evaluate(
    async ({ app }, { root, profile, port }) => {
      const require = process.getBuiltinModule('module').createRequire(root + '/package.json');
      const fs = require('node:fs');
      const path = require('node:path');
      const { NsisUpdater } = require('electron-updater');
      const { configurePlatformUpdates } = require(
        root + '/dist-electron/shared/electron/backend/updates/driver.js',
      );
      const { UpdateService } = require(
        root + '/dist-electron/shared/electron/backend/updates/service.js',
      );
      const fetchers = new WeakMap();
      const downloaders = new WeakMap();
      globalThis.platformRequests = [];
      globalThis.platformSignatureChecks = [];
      globalThis.createPlatformUpdates = (autoDownload = true, cacheName = 'platform') => {
      const updater = new NsisUpdater();
      Object.defineProperty(updater.app, 'baseCachePath', { value: profile });
      const config = path.join(profile, cacheName + '-app-update.yml');
      fs.writeFileSync(config, JSON.stringify({ updaterCacheDirName: cacheName + '-cache' }));
      updater.updateConfigPath = config;
      updater.forceDevUpdateConfig = true;
      updater.disableDifferentialDownload = true;
      const updateSession = updater.netSession;
      if (!fetchers.has(updateSession)) fetchers.set(updateSession, updateSession.fetch.bind(updateSession));
      const originalFetch = fetchers.get(updateSession);
      updateSession.fetch = (input, init) => {
        const url = new URL(String(input));
        globalThis.platformRequests.push(url.href);
        if (
          url.origin === 'https://api.github.com' &&
          url.pathname === '/repos/NCFXZ/VoxCue/releases'
        )
          return originalFetch('http://127.0.0.1:' + port + '/platform-releases', init);
        if (
          url.origin === 'https://github.com' &&
          url.pathname.startsWith('/NCFXZ/VoxCue/releases/download/windows-native-v') &&
          url.pathname.endsWith('/latest.yml')
        )
          return originalFetch('http://127.0.0.1:' + port + '/platform-manifest', init);
        throw Error('Unexpected provider request');
      };
      if (!downloaders.has(updater.httpExecutor))
        downloaders.set(updater.httpExecutor, updater.httpExecutor.download.bind(updater.httpExecutor));
      const originalDownload = downloaders.get(updater.httpExecutor);
      updater.httpExecutor.download = (url, destination, options) => {
        if (
          url.origin !== 'https://github.com' ||
          !url.pathname.startsWith('/NCFXZ/VoxCue/releases/download/windows-native-v')
        )
          throw Error('Unexpected native download URL');
        globalThis.platformRequests.push(url.href);
        return originalDownload(
          new URL('http://127.0.0.1:' + port + '/platform-installer'),
          destination,
          options,
        );
      };
      // This unsigned, inert fake EXE is never installed. Override only this
      // instance's signature port so recovery must demonstrably invoke it.
      updater.verifySignature = async (file) => {
        assertSafeFile(file);
        globalThis.platformSignatureChecks.push({ cacheName, file });
        return null;
      };
      function assertSafeFile(file) {
        if (!path.resolve(file).startsWith(path.resolve(profile) + path.sep))
          throw Error('Synthetic signature fixture received an unowned path');
      }
      const cacheDirectory = path.join(profile, cacheName + '-release-state');
      const driver = configurePlatformUpdates(updater, 'windows-x64', undefined, { cacheDirectory });
      globalThis.platformUpdater = updater;
      globalThis.platformDriver = driver;
      globalThis.platformCacheDirectory = cacheDirectory;
      globalThis.platformUpdates = new UpdateService({
        currentVersion: '0.0.0',
        autoDownload,
        driver,
        isInterviewActive: () => false,
        prepareInstall: async () => {
          throw Error('Installation is never allowed in this test');
        },
        emit: () => {},
      });
      };
      globalThis.createPlatformUpdates();
    },
    { root: process.cwd(), profile, port: server.address().port },
  );
  const platformFailed = await app.evaluate(() =>
    globalThis.platformUpdates.start().then(() => globalThis.platformUpdates.state()),
  );
  assert.equal(platformFailed.availableVersion, info.version);
  assert.equal(platformFailed.phase, 'error');
  assert.match(platformFailed.error, /校验失败/);
  assert.deepEqual(transportCounts, { releases: 1, manifests: 1, installers: 1 });
  const afterFailure = { ...transportCounts };
  const cachedAvailable = await app.evaluate(async () => {
    await globalThis.platformUpdates.dispose();
    globalThis.createPlatformUpdates(false);
    await globalThis.platformUpdates.start();
    return globalThis.platformUpdates.state();
  });
  assert.equal(cachedAvailable.phase, 'available');
  assert.equal(cachedAvailable.availableVersion, platformFailed.availableVersion);
  assert.equal(cachedAvailable.lastCheckedAt, platformFailed.lastCheckedAt);
  assert.equal(cachedAvailable.autoDownload, false);
  assert.equal(typeof cachedAvailable.lastCheckedAt, 'number');
  assert.deepEqual(transportCounts, afterFailure, 'A fresh updater reuses the hourly release cache without API, manifest or package requests');
  const checkedAgain = await app.evaluate(() => globalThis.platformUpdates.check());
  const { revision: _cachedRevision, ...cachedResult } = cachedAvailable;
  const { revision: _checkedRevision, ...checkedResult } = checkedAgain;
  assert.deepEqual(checkedResult, cachedResult, 'A normal repeated check returns the same cached result');
  assert.deepEqual(transportCounts, afterFailure);
  corrupt = false;
  const platformReady = await app.evaluate(async () => {
    await globalThis.platformUpdates.check();
    return globalThis.platformUpdates.download();
  });
  assert.equal(platformReady.phase, 'downloaded');
  const platformHash = await app.evaluate(async () => {
    const fs = process.getBuiltinModule('fs');
    const crypto = process.getBuiltinModule('crypto');
    const hash = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(globalThis.platformUpdater.installerPath))
      hash.update(chunk);
    return hash.digest('base64');
  });
  assert.equal(platformHash, info.sha512);
  const completeFile = await app.evaluate(() => globalThis.platformUpdater.installerPath);
  const beforeRestore = { ...transportCounts };
  const restore = await app.evaluate(async () => {
    const fs = process.getBuiltinModule('fs');
    const completeFile = globalThis.platformUpdater.installerPath;
    await globalThis.platformUpdates.dispose();
    if (!fs.existsSync(completeFile)) throw Error('Dispose removed the complete installer');
    const previous = globalThis.platformUpdater;
    const signatureCount = globalThis.platformSignatureChecks.length;
    const originalNow = Date.now;
    try {
      // A complete installer remains usable after the hourly metadata TTL.
      Date.now = () => originalNow() + 60 * 60 * 1000 + 1;
      globalThis.createPlatformUpdates(false);
      await globalThis.platformUpdates.start();
    } finally {
      Date.now = originalNow;
    }
    return {
      state: globalThis.platformUpdates.state(),
      newInstance: previous !== globalThis.platformUpdater,
      file: globalThis.platformUpdater.installerPath,
      signatures: globalThis.platformSignatureChecks.slice(signatureCount),
      autoInstall: globalThis.platformUpdater.autoInstallOnAppQuit,
    };
  });
  assert.equal(restore.newInstance, true);
  assert.equal(restore.state.phase, 'downloaded');
  assert.equal(restore.state.autoDownload, false);
  assert.equal(restore.state.progress, 100);
  assert.equal(restore.state.availableVersion, info.version);
  assert.equal(restore.state.lastCheckedAt, cachedAvailable.lastCheckedAt);
  assert.equal(restore.file, completeFile);
  assert.ok(restore.signatures.some(({ file }) => file === completeFile), 'Complete-file restoration invokes this instance\'s synthetic signature verifier');
  assert.equal(restore.autoInstall, false);
  assert.deepEqual(transportCounts, beforeRestore, 'A complete package restores downloaded with auto-download disabled and no network requests');
  const beforeForced = { ...transportCounts };
  const forced = await app.evaluate(async () => {
    await globalThis.platformUpdates.dispose();
    globalThis.createPlatformUpdates(false);
    return globalThis.platformUpdates.check(true);
  });
  assert.equal(forced.phase, 'downloaded');
  assert.equal(forced.availableVersion, info.version);
  assert.deepEqual(transportCounts, {
    releases: beforeForced.releases + 1,
    manifests: beforeForced.manifests + 1,
    installers: beforeForced.installers,
  }, 'One forced check makes exactly one fresh release/manifest lookup and reuses the complete installer');
  await app.evaluate(() => globalThis.platformUpdates.dispose());
  holdInstaller = true;
  let heldTimer;
  const heldRequest = new Promise((resolve, reject) => {
    installerHeld = () => { clearTimeout(heldTimer); resolve(); };
    heldTimer = setTimeout(() => reject(Error('The owned slow installer request did not start')), 10000);
  });
  try {
    await app.evaluate(() => {
      globalThis.createPlatformUpdates(true, 'interrupted');
      globalThis.interruptedUpdateStart = globalThis.platformUpdates.start();
    });
    await heldRequest;
  } finally {
    clearTimeout(heldTimer);
    installerHeld = undefined;
  }
  const partial = await app.evaluate(async () => {
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    const helper = await globalThis.platformUpdater.getOrCreateDownloadHelper();
    const pending = helper.cacheDirForPendingUpdate;
    const deadline = Date.now() + 3000;
    for (;;) {
      const names = fs.existsSync(pending) ? fs.readdirSync(pending) : [];
      for (const name of names) {
        const file = path.join(pending, name);
        const stat = fs.statSync(file);
        if (name.includes('temp-') && stat.size > 0) return { pending, name, bytes: stat.size };
      }
      if (Date.now() >= deadline) throw Error('No partial installer bytes reached the stock downloader');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  assert.ok(partial.bytes > 0 && partial.bytes < installerSize);
  const cancelStarted = Date.now();
  const interrupted = await app.evaluate(async (_, pending) => {
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    await globalThis.platformUpdates.dispose();
    await globalThis.interruptedUpdateStart;
    const cache = JSON.parse(fs.readFileSync(path.join(globalThis.platformCacheDirectory, 'release-cache.json'), 'utf8'));
    return { cache, remaining: fs.existsSync(pending) ? fs.readdirSync(pending) : [] };
  }, partial.pending);
  assert.ok(!interrupted.remaining.includes(partial.name), 'Dispose removes the actual interrupted installer');
  for (const name of [info.path, `temp-${info.path}`, `0-temp-${info.path}`, `1-temp-${info.path}`, `2-temp-${info.path}`])
    assert.ok(!interrupted.remaining.includes(name), 'No known partial installer survives disposal');
  assert.equal(interrupted.cache.download, undefined);
  assert.ok(interrupted.cache.notBefore >= cancelStarted + 60 * 60 * 1000, 'Interrupted automatic downloads persist an hourly cooldown');
  const beforeInterruptedRestart = { ...transportCounts };
  const interruptedRestart = await app.evaluate(async () => {
    globalThis.createPlatformUpdates(true, 'interrupted');
    await globalThis.platformUpdates.start();
    return { state: globalThis.platformUpdates.state(), allowed: globalThis.platformDriver.isAutomaticDownloadAllowed() };
  });
  assert.equal(interruptedRestart.state.phase, 'available');
  assert.equal(interruptedRestart.state.autoDownload, true);
  assert.equal(interruptedRestart.allowed, false);
  assert.deepEqual(transportCounts, beforeInterruptedRestart, 'Restart reuses cached metadata and does not restart an interrupted automatic download');
  holdInstaller = false;
  const manualAfterInterruption = await app.evaluate(() => globalThis.platformUpdates.download());
  assert.equal(manualAfterInterruption.phase, 'downloaded');
  assert.deepEqual(transportCounts, {
    ...beforeInterruptedRestart,
    installers: beforeInterruptedRestart.installers + 1,
  }, 'Manual download bypasses the automatic cooldown without another release lookup');
  platformRequests.push(...(await app.evaluate(() => globalThis.platformRequests)));
  assert.equal(
    platformRequests.some((url) => url.endsWith('/latest') || url.includes('.atom')),
    false,
  );
  assert.equal(
    platformRequests.some((url) => url.includes('mac-only-v99.0.0')),
    false,
  );
  await app.evaluate(() => globalThis.platformUpdates.dispose());
  await console.log(
    JSON.stringify(
      {
        passed: true,
        realNsisUpdater: true,
        rejectsCorruption: true,
        syntheticTransportHashVerified: true,
        installerSize,
        installed: false,
        platformIndependentSelection: true,
        macOnlyLatestIgnored: true,
        platformRejectsCorruption: true,
        platformInstallerHashVerified: true,
        releaseCacheAcrossRestart: true,
        completeInstallerRestoredAfterHourlyTtl: true,
        syntheticSignatureRestoreVerified: true,
        forcedCheckMadeFreshLookup: true,
        interruptedPartialRemoved: true,
        interruptedAutoDownloadDeferred: true,
        manualDownloadAfterInterruption: true,
        transportCounts,
        platformRequests,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, profile }));
} finally {
  heldInstaller?.destroy();
  if (app) await app.close();
  await new Promise((resolve) => server.close(resolve));
}
