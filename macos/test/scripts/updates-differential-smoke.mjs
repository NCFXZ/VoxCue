import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { holdDesktopAwake } from './desktop-session.mjs';
import { macDeltaPlan } from '../../scripts/create-mac-delta.mjs';

const root = workspace.platformRoot;
const require = workspace.platformRequire;
const { macUpdatePayload, macDeltaPayload } = require(root + '/dist-electron/macos/electron/updates/manifest.js');
const { verifyDownload } = require(root + '/dist-electron/macos/electron/updates/download.js');
const { regionLookup, downloadUrl, cnbReleaseIndex } = require(root + '/dist-electron/shared/electron/backend/downloads.js');
const argv = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
let base = argv('base');
let target = argv('target');
assert.equal(Boolean(base), Boolean(target), 'Supply both --base and --target ZIP paths');
const realArchives = Boolean(base);
const archiveVersion = file => {
  const version = /^VoxCue-(\d+\.\d+\.\d+)-arm64\.zip$/.exec(path.basename(file))?.[1];
  assert.ok(version, 'Use an official versioned Mac ZIP name');
  return version;
};
const baseVersion = realArchives ? archiveVersion(base) : '1.3.2';
const version = realArchives ? archiveVersion(target) : '1.3.3';
if (!realArchives) {
  const stable = randomBytes(2 * 1024 ** 2);
  const AdmZip = require('adm-zip');
  for (const [file, text] of [['base.zip', 'before'], ['target.zip', 'after']]) {
    const archive = new AdmZip();
    archive.addFile('VoxCue.app/changed.txt', Buffer.from(text));
    archive.addFile('VoxCue.app/signed-binary', Buffer.concat([stable, Buffer.from(text)]));
    await writeFile(path.join(testRoot, file), archive.toBuffer());
  }
  base = path.join(testRoot, 'base.zip');
  target = path.join(testRoot, 'target.zip');
}
const digest = bytes => createHash('sha512').update(bytes).digest('base64');
const baseInfo = await readFile(base).then(bytes => ({ version: baseVersion, size: bytes.length, sha512: digest(bytes) }));
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicText = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const file = await readFile(target).then(bytes => ({
  version, url: 'VoxCue-' + version + '-arm64.zip', size: bytes.length, sha512: digest(bytes),
  minimumSystemVersion: '14.2', edSignature: sign(null, bytes, privateKey).toString('base64'),
}));
const plan = await macDeltaPlan(base, target);
const delta = {
  url: file.url + '.delta.json', size: plan.length, sha512: digest(plan), base: baseInfo,
};
const signedDelta = { ...delta, signature: sign(null, macDeltaPayload(file, delta), privateKey).toString('base64') };
const fullSignature = sign(null, macUpdatePayload(file), privateKey).toString('base64');
const tag = 'v' + version;
const remaining = file.size - JSON.parse(plan).reduce((bytes, range) => bytes + range[2], 0);
assert.ok(remaining > 1 && remaining + plan.length < file.size);
let mode = 'delta';
let traffic;
let metadata;
const server = createServer((request, response) => {
  const [, source, item] = request.url.split('/');
  const range = request.headers.range;
  assert.ok(!request.headers.authorization && !request.headers.cookie);
  if (item === 'region') return response.end('loc=' + (source === 'cnb' ? 'CN' : 'GB') + '\n');
  if (item === 'releases') {
    const releases = [{
      tag_name: tag, draft: false, prerelease: false, published_at: '2026-11-24T00:00:00Z',
      assets: [
        { name: 'latest-mac.yml', size: metadata.length, state: 'uploaded' },
        { name: file.url, size: file.size, state: 'uploaded' },
        ...(mode === 'missing-plan' ? [] : [{ name: delta.url, size: plan.length, state: 'uploaded' }]),
      ],
    }];
    return response.end(JSON.stringify(source === 'cnb' ? {schemaVersion: 1, releases} : releases));
  }
  if (item === 'manifest') return response.end(metadata);
  if (item === 'plan') {
    traffic.plans++;
    traffic.planBytes += plan.length;
    return response.end(mode === 'bad-plan' ? Buffer.alloc(plan.length, 0x21) : plan);
  }
  if (item !== 'archive') return response.writeHead(404).end();
  if (!range) {
    traffic.full++;
    traffic.archiveBytes += file.size;
    response.writeHead(200, { 'Content-Length': file.size });
    return createReadStream(target).pipe(response);
  }
  traffic.ranges++;
  if (mode === 'range-http-error') return response.writeHead(503).end();
  if (mode === 'range-ignored') return response.writeHead(200, { 'Content-Length': file.size }).end();
  const match = /^bytes=(\d+)-(\d+)$/.exec(range);
  assert.ok(match);
  const [, first, last] = match;
  const start = Number(first), end = Number(last);
  assert.ok(start <= end && end < file.size);
  if (mode === 'bad-range') return response.writeHead(206, {
    'Content-Length': end - start + 1, 'Content-Range': 'bytes */' + file.size,
  }).end();
  response.writeHead(206, {
    'Content-Length': end - start + 1, 'Content-Range': 'bytes ' + start + '-' + end + '/' + file.size,
  });
  if (mode === 'cancel') return response.write(' ');
  traffic.archiveBytes += end - start + 1;
  if (mode === 'bad-assembled') return Readable.from([Buffer.alloc(end - start + 1)]).pipe(response);
  return createReadStream(target, { start, end }).pipe(response);
});

const release = holdDesktopAwake();
let host;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const entry = path.join(testRoot, 'differential-entry.cjs');
  await writeFile(entry, "require('electron').app.whenReady();");
  host = await electron.launch({ args: [await offlineElectronEntry(entry, { loopbackPort: port })] });
  const modes = realArchives
    ? [['github', 'delta'], ['cnb', 'delta'], ['cnb', 'range-ignored']]
    : [
        ['github', 'delta'], ['cnb', 'delta'], ['cnb', 'range-ignored'], ['github', 'range-http-error'],
        ['github', 'bad-range'], ['github', 'bad-plan'], ['github', 'bad-assembled'], ['github', 'missing-plan'],
        ['github', 'bad-signature'], ['github', 'no-baseline'], ['github', 'bad-baseline'], ['github', 'cancel'],
      ];
  for (const [source, scenario] of modes) {
    mode = scenario;
    traffic = { archiveBytes: 0, planBytes: 0, full: 0, plans: 0, ranges: 0 };
    metadata = JSON.stringify({ version, minimumSystemVersion: '14.2', files: [{
      ...file, voxcueSignature: fullSignature,
      delta: mode === 'bad-signature' ? { ...signedDelta, signature: file.edSignature } : signedDelta,
    }] });
    const cache = path.join(testRoot, source + '-' + mode);
    const archives = path.join(cache, 'archives');
    const baseline = path.join(archives, 'VoxCue-' + baseVersion + '-arm64.zip');
    await mkdir(archives, { recursive: true });
    if (mode === 'bad-baseline') await writeFile(baseline, 'older unrelated archive');
    else if (mode !== 'no-baseline') await copyFile(base, baseline, constants.COPYFILE_FICLONE);
    const result = await host.evaluate(async ({ app, net }, options) => {
      const require = process.getBuiltinModule('module').createRequire(options.root + '/package.json');
      const { MacUpdateDriver } = require(options.root + '/dist-electron/macos/electron/updates/driver.js');
      const fetch = net.fetch;
      const urls = new Map(options.urls);
      const cancel = new AbortController();
      let timer;
      app.getVersion = () => options.baseVersion;
      net.fetch = async (input, init) => {
        const url = String(input);
        const item = urls.get(url) ??
          (url.startsWith('https://api.github.com/repos/NCFXZ/VoxCue/releases?') ? 'releases' : undefined);
        if (!item) throw Error('Unexpected differential request: ' + url);
        if (options.mode === 'cancel' && new Headers(init?.headers).has('range'))
          timer = setTimeout(() => cancel.abort(), 250);
        return fetch('http://127.0.0.1:' + options.port + '/' + options.source + '/' + item, init);
      };
      const driver = new MacUpdateDriver(options.publicText, { cancel() {} }, options.cache);
      try {
        await driver.checkForUpdates();
        await driver.downloadUpdate(cancel.signal);
        return 'downloaded';
      } catch (error) {
        if (options.mode === 'cancel' && error.name === 'AbortError') return 'cancelled';
        throw error;
      } finally {
        clearTimeout(timer);
        await driver.dispose();
        net.fetch = fetch;
      }
    }, {
      root, publicText, baseVersion, cache, mode, source, port,
      urls: [
        [regionLookup, 'region'], [cnbReleaseIndex, 'releases'],
        [downloadUrl(source, tag, 'latest-mac.yml').href, 'manifest'],
        [downloadUrl(source, tag, delta.url).href, 'plan'],
        [downloadUrl(source, tag, file.url).href, 'archive'],
      ],
    });
    const archive = path.join(archives, file.url);
    await assert.rejects(access(archive + '.partial'), { code: 'ENOENT' });
    if (mode === 'cancel') {
      assert.equal(result, 'cancelled');
      assert.equal(traffic.full, 0);
      assert.equal(traffic.ranges, 1);
      await assert.rejects(access(archive), { code: 'ENOENT' });
    } else {
      assert.equal(result, 'downloaded');
      await verifyDownload(archive, file);
      if (mode === 'delta') {
        assert.equal(traffic.full, 0);
        assert.equal(traffic.plans, 1);
        assert.ok(traffic.ranges > 0);
        assert.equal(traffic.archiveBytes, remaining);
      } else {
        assert.equal(traffic.full, 1);
        if (['missing-plan', 'bad-signature', 'no-baseline', 'bad-baseline'].includes(mode)) {
          assert.equal(traffic.plans, 0);
          assert.equal(traffic.ranges, 0);
        }
      }
    }
    console.log('PASS', source, mode, { ...traffic, fullZip: file.size });
  }
} finally {
  if (host) await host.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  release();
}
