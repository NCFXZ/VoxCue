import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
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
const fixtureBytes = Buffer.from(
  'Synthetic update transport fixture; this file is never executed.',
);
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
const platformRequests = [];
const server = createServer((request, response) => {
  const name = new URL(request.url, 'http://127.0.0.1').pathname;
  if (name === '/platform-releases') {
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
    response.writeHead(200, { 'Content-Type': 'text/yaml' }).end(metadata);
  } else if (name === '/platform-installer') {
    if (corrupt) response.writeHead(200, { 'Content-Length': bad.length }).end(bad);
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
      const updater = new NsisUpdater();
      Object.defineProperty(updater.app, 'baseCachePath', { value: profile });
      const config = path.join(profile, 'platform-app-update.yml');
      fs.writeFileSync(config, JSON.stringify({ updaterCacheDirName: 'platform-cache' }));
      updater.updateConfigPath = config;
      updater.forceDevUpdateConfig = true;
      updater.disableDifferentialDownload = true;
      globalThis.platformRequests = [];
      const updateSession = updater.netSession;
      const originalFetch = updateSession.fetch.bind(updateSession);
      updateSession.fetch = (input, init) => {
        const url = new URL(String(input));
        globalThis.platformRequests.push(url.href);
        if (
          url.origin === 'https://api.github.com' &&
          url.pathname === '/repos/NCFXZ/VoxCue-releases/releases'
        )
          return originalFetch('http://127.0.0.1:' + port + '/platform-releases', init);
        if (url.origin === 'https://github.com' && url.pathname.endsWith('/latest.yml'))
          return originalFetch('http://127.0.0.1:' + port + '/platform-manifest', init);
        throw Error('Unexpected provider request');
      };
      const originalDownload = updater.httpExecutor.download.bind(updater.httpExecutor);
      updater.httpExecutor.download = (url, destination, options) => {
        if (
          url.origin !== 'https://github.com' ||
          !url.pathname.startsWith('/NCFXZ/VoxCue-releases/releases/download/windows-native-v')
        )
          throw Error('Unexpected native download URL');
        globalThis.platformRequests.push(url.href);
        return originalDownload(
          new URL('http://127.0.0.1:' + port + '/platform-installer'),
          destination,
          options,
        );
      };
      const driver = configurePlatformUpdates(updater, 'windows-x64');
      globalThis.platformUpdater = updater;
      globalThis.platformUpdates = new UpdateService({
        currentVersion: '0.0.0',
        driver,
        isInterviewActive: () => false,
        prepareInstall: async () => {
          throw Error('Installation is never allowed in this test');
        },
        emit: () => {},
      });
    },
    { root: process.cwd(), profile, port: server.address().port },
  );
  const platformFailed = await app.evaluate(() =>
    globalThis.platformUpdates.start().then(() => globalThis.platformUpdates.state()),
  );
  assert.equal(platformFailed.availableVersion, info.version);
  assert.equal(platformFailed.phase, 'error');
  assert.match(platformFailed.error, /校验失败/);
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
        platformRequests,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, profile }));
} finally {
  if (app) await app.close();
  await new Promise((resolve) => server.close(resolve));
}
