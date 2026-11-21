import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, sign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';

/** Production Mac adapter and service, real Electron transport, owner loopback only. */
export async function checkMacUpdateCache(publicKey, privateKey, macUpdatePayload) {
  const directory = path.join(testRoot, 'mac-cache-matrix');
  await mkdir(directory);
  const bytes = Buffer.alloc(128 * 1024, 0x5a);
  const update = {
    version: '99.0.1',
    url: 'VoxCue-99.0.1-arm64.zip',
    size: bytes.length,
    sha512: createHash('sha512').update(bytes).digest('base64'),
    edSignature: sign(null, bytes, privateKey).toString('base64'),
    minimumSystemVersion: '14.2',
  };
  const metadata = {
    version: update.version,
    minimumSystemVersion: '14.2',
    files: [
      {
        ...update,
        voxcueSignature: sign(null, macUpdatePayload(update), privateKey).toString('base64'),
      },
    ],
  };
  const counts = { releases: 0, manifests: 0, archives: 0 };
  let offline = false,
    slow = false,
    held;
  const server = createServer((request, response) => {
    if (request.url === '/releases') {
      counts.releases++;
      if (offline) {
        response.writeHead(503).end();
        return;
      }
      response.end(
        JSON.stringify([
          {
            draft: false,
            prerelease: false,
            published_at: '2026-11-01T00:00:00Z',
            tag_name: 'windows-v100.0.0',
            assets: [
              { name: 'latest.yml', size: 100, state: 'uploaded' },
              { name: 'VoxCue-Setup-100.0.0-x64.exe', size: 100, state: 'uploaded' },
              { name: 'VoxCue-Setup-100.0.0-x64.exe.blockmap', size: 100, state: 'uploaded' },
            ],
          },
          {
            draft: false,
            prerelease: false,
            published_at: '2026-11-01T00:00:00Z',
            tag_name: 'mac-v99.0.1',
            assets: [
              { name: 'latest-mac.yml', size: JSON.stringify(metadata).length, state: 'uploaded' },
              { name: update.url, size: bytes.length, state: 'uploaded' },
            ],
          },
        ]),
      );
    } else if (request.url === '/manifest') {
      counts.manifests++;
      response.end(JSON.stringify(metadata));
    } else if (request.url === '/archive') {
      counts.archives++;
      response.writeHead(200, { 'Content-Length': bytes.length });
      if (slow) {
        held = response;
        response.write(bytes.subarray(0, 1024));
      } else response.end(bytes);
    } else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const fixture = path.join(directory, 'entry.cjs');
  await writeFile(
    fixture,
    `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});app.whenReady();`,
  );
  let host;
  try {
    host = await electron.launch({
      args: [await offlineElectronEntry(fixture, { loopbackPort: port })],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    await host.evaluate(
      ({ app, net }, { root, directory, port, publicKey }) => {
        const require = process.getBuiltinModule('module').createRequire(root + '/package.json');
        const { MacUpdateDriver } = require(
          root + '/dist-electron/macos/electron/updates/driver.js',
        );
        const { UpdateService } = require(
          root + '/dist-electron/shared/electron/backend/updates/service.js',
        );
        const originalFetch = net.fetch.bind(net);
        app.getVersion = () => '0.0.0';
        net.fetch = (input, init) => {
          const url = new URL(String(input));
          if (
            url.origin === 'https://api.github.com' &&
            url.pathname === '/repos/NCFXZ/VoxCue/releases'
          )
            return originalFetch('http://127.0.0.1:' + port + '/releases', init);
          if (
            url.origin === 'https://github.com' &&
            url.pathname === '/NCFXZ/VoxCue/releases/download/mac-v99.0.1/latest-mac.yml'
          )
            return originalFetch('http://127.0.0.1:' + port + '/manifest', init);
          if (
            url.origin === 'https://github.com' &&
            url.pathname ===
              '/NCFXZ/VoxCue/releases/download/mac-v99.0.1/VoxCue-99.0.1-arm64.zip'
          )
            return originalFetch('http://127.0.0.1:' + port + '/archive', init);
          throw Error('Unexpected native updater URL');
        };
        globalThis.cacheNativeCalls = [];
        globalThis.createCacheUpdates = (autoDownload = false, name = 'complete') => {
          if (!/^[a-z-]+$/.test(name)) throw Error('Invalid fixture cache');
          globalThis.cachePath = directory + '/' + name;
          globalThis.cacheDriver = new MacUpdateDriver(
            publicKey,
            {
              begin() {
                globalThis.cacheNativeCalls.push('begin');
                throw Error('Cache recovery must not begin installation');
              },
              commit() {
                globalThis.cacheNativeCalls.push('commit');
                throw Error('Cache recovery must not commit installation');
              },
              cancel() {},
            },
            globalThis.cachePath,
          );
          globalThis.cacheUpdates = new UpdateService({
            currentVersion: '0.0.0',
            autoDownload,
            driver: globalThis.cacheDriver,
            isInterviewActive: () => false,
            prepareInstall: async () => {
              throw Error('Transport fixture never installs');
            },
            emit() {},
          });
        };
      },
      { root: workspace.platformRoot, directory, port, publicKey },
    );
    const start = (name = 'complete', auto = false, timeOffset = 0) =>
      host.evaluate(
        async (_electron, { name, auto, timeOffset }) => {
          const original = Date.now;
          try {
            if (timeOffset) Date.now = () => original() + timeOffset;
            globalThis.createCacheUpdates(auto, name);
            await globalThis.cacheUpdates.start();
            return globalThis.cacheUpdates.state();
          } finally {
            Date.now = original;
          }
        },
        { name, auto, timeOffset },
      );
    const dispose = () => host.evaluate(() => globalThis.cacheUpdates.dispose());
    const first = await start();
    assert.equal(first.phase, 'available');
    assert.equal(first.availableVersion, update.version);
    assert.deepEqual(counts, { releases: 1, manifests: 1, archives: 0 });
    await dispose();
    const restarted = await start();
    assert.equal(restarted.lastCheckedAt, first.lastCheckedAt);
    assert.equal(restarted.phase, 'available');
    assert.deepEqual(counts, { releases: 1, manifests: 1, archives: 0 });
    await host.evaluate(() => globalThis.cacheUpdates.check(true));
    assert.deepEqual(counts, { releases: 2, manifests: 2, archives: 0 });
    assert.equal(
      (await host.evaluate(() => globalThis.cacheUpdates.download())).phase,
      'downloaded',
    );
    await dispose();
    const beforeRestore = { ...counts };
    offline = true;
    const restored = await start('complete', false, 3600001);
    assert.equal(restored.phase, 'downloaded');
    assert.equal(restored.autoDownload, false);
    assert.deepEqual(counts, beforeRestore);
    assert.deepEqual(await host.evaluate(() => globalThis.cacheNativeCalls), []);
    await dispose();
    const failed = await start('failed');
    assert.equal(failed.phase, 'error');
    await dispose();
    const beforeFailureReplay = { ...counts };
    assert.equal((await start('failed', false, -1000)).phase, 'error');
    assert.deepEqual(counts, beforeFailureReplay);
    offline = false;
    assert.equal(
      (await host.evaluate(() => globalThis.cacheUpdates.check(true))).phase,
      'available',
    );
    await dispose();
    await start('partial');
    slow = true;
    await host.evaluate(() => {
      globalThis.pendingCacheDownload = globalThis.cacheUpdates.download();
    });
    await host.evaluate(async () => {
      const fs = process.getBuiltinModule('fs');
      const file = globalThis.cachePath + '/archives/VoxCue-99.0.1-arm64.zip.partial';
      const deadline = Date.now() + 15000;
      while (!fs.existsSync(file) || fs.statSync(file).size === 0) {
        if (Date.now() > deadline) throw Error('No streamed partial archive');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      fs.writeFileSync(globalThis.cachePath + '/archives/keep.txt', 'unrelated');
      const one = globalThis.cacheDriver.dispose(),
        two = globalThis.cacheDriver.dispose();
      if (one !== two) throw Error('Repeated exit did not share its barrier');
      await globalThis.cacheUpdates.dispose();
      await globalThis.pendingCacheDownload;
      if (fs.existsSync(file)) throw Error('Partial archive survived awaited disposal');
      if (fs.readFileSync(globalThis.cachePath + '/archives/keep.txt', 'utf8') !== 'unrelated')
        throw Error('Unknown file was removed');
      const state = JSON.parse(
        fs.readFileSync(globalThis.cachePath + '/release-cache.json', 'utf8'),
      );
      if (state.download || state.notBefore <= Date.now())
        throw Error('Journal/cooldown was not durably finalized');
    });
    held?.destroy();
    held = undefined;
    slow = false;
    const beforeCooldown = { ...counts };
    const cooled = await start('partial', true);
    assert.equal(cooled.phase, 'available');
    assert.equal(cooled.autoDownload, true);
    assert.deepEqual(counts, beforeCooldown);
    assert.equal(
      (await host.evaluate(() => globalThis.cacheUpdates.download())).phase,
      'downloaded',
    );
    await host.evaluate(() => globalThis.cacheDriver.checkForUpdates(true));
    assert.equal(
      await host.evaluate(() => globalThis.cacheDriver.isAutomaticDownloadAllowed()),
      true,
    );
    await dispose();
    for (const mode of ['signature', 'archive', 'linked-archive']) {
      await start(mode);
      await host.evaluate(() => globalThis.cacheUpdates.download());
      await dispose();
      await host.evaluate((_electron, mode) => {
        const fs = process.getBuiltinModule('fs');
        const file = globalThis.cachePath + '/release-cache.json';
        if (mode === 'signature') {
          const state = JSON.parse(fs.readFileSync(file, 'utf8'));
          state.completed.files[0].voxcueSignature = Buffer.alloc(64).toString('base64');
          fs.writeFileSync(file, JSON.stringify(state));
        } else {
          const archive = globalThis.cachePath + '/archives/VoxCue-99.0.1-arm64.zip';
          if (mode === 'archive') fs.writeFileSync(archive, Buffer.alloc(128 * 1024));
          else {
            fs.renameSync(archive, archive + '.original');
            fs.symlinkSync(archive + '.original', archive);
          }
        }
      }, mode);
      const before = { ...counts };
      assert.equal((await start(mode)).phase, mode === 'archive' ? 'available' : 'error');
      assert.deepEqual(counts, before);
      if (mode === 'archive') {
        assert.equal((await host.evaluate(() => globalThis.cacheUpdates.download())).phase, 'downloaded');
        assert.deepEqual(counts, { ...before, archives: before.archives + 1 });
      }
      await dispose();
    }
    console.log(
      'PASS: real Mac adapter loopback hourly/forced/failed/rollback checks, signed offline restoration, partial exit barrier/cooldown, manual retry and signature/hash/link rejection.',
    );
  } finally {
    const closed = new Promise((resolve) => server.close(resolve));
    held?.destroy();
    server.closeAllConnections();
    await host?.evaluate(() => globalThis.cacheUpdates?.dispose()).catch(() => {});
    await host?.close().catch(() => {});
    await closed;
  }
}
