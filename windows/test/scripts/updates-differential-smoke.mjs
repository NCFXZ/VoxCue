import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { electron, testRoot } from '../../../shared/test/scripts/test-workspace.mjs';

assert.equal(process.platform, 'win32');
const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'));
const yaml = updaterRequire('js-yaml');
const { computeOperations, OperationKind } = updaterRequire('./out/differentialDownloader/downloadPlanBuilder.js');
const { signedWindowsUpdate } = require(root + '/dist-electron/shared/electron/backend/updates/windowsManifest.js');
const publicKey = JSON.parse(await readFile(path.join(root, 'update-public-key.json'), 'utf8')).publicKey;
const mirrorArgument = process.argv.find(arg => arg.startsWith('--mirror-base='))?.slice(14);
const mirror = mirrorArgument ? new URL(mirrorArgument) : undefined;
if (mirror) assert.ok(mirror.protocol === 'https:' && !mirror.username && !mirror.password &&
  !mirror.search && !mirror.hash && mirror.pathname.endsWith('/'), 'Mirror base must be a public HTTPS directory');
async function hash(file) {
  const value = createHash('sha512');
  for await (const chunk of createReadStream(file)) value.update(chunk);
  return value.digest('base64');
}
async function release(option) {
  const value = process.argv.find(arg => arg.startsWith(option + '='))?.slice(option.length + 1);
  assert.ok(value, `Required: ${option}=<existing release directory>`);
  const directory = path.resolve(value);
  const manifest = await readFile(path.join(directory, 'latest.yml'));
  const metadata = yaml.load(manifest.toString());
  const name = `VoxCue-Setup-${metadata.version}-x64.exe`;
  assert.equal(metadata.path, name);
  const binary = path.join(directory, name);
  const size = (await stat(binary)).size;
  const candidate = { version: metadata.version, tag: 'v' + metadata.version,
    manifest: 'latest.yml', binary: { name, size }, publishedAt: Date.parse(metadata.releaseDate) };
  const authenticated = signedWindowsUpdate(metadata, candidate, publicKey);
  assert.equal(await hash(binary), authenticated.sha512, 'Released installer SHA512 must match its signed manifest');
  const map = await readFile(binary + '.blockmap');
  return { directory, name, binary, size, manifest, metadata, candidate, map,
    blocks: JSON.parse(gunzipSync(map).toString()) };
}
const from = await release('--from-release');
const to = await release('--to-release');
const operations = computeOperations(from.blocks, to.blocks, { info() {}, warn() {} });
const changed = operations.filter(operation => operation.kind === OperationKind.DOWNLOAD);
const changedBytes = changed.reduce((sum, operation) => sum + operation.end - operation.start, 0);
assert.ok(changedBytes > 0 && changedBytes < to.size, 'This release pair must have both changed and reusable blocks');
console.log(JSON.stringify({ authenticatedReleases: [from.metadata.version, to.metadata.version],
  fullBytes: to.size, expectedChangedBytes: changedBytes, expectedRangeRequests: changed.length }));

let mode, downloadSource, counts, injectedCorruption = false;
const allResults = [];
async function proxyMirror(response, source, name, range) {
  const url = new URL(encodeURIComponent(source.candidate.tag) + '/' + encodeURIComponent(name), mirror);
  try {
    const upstream = await fetch(url, { credentials: 'omit', headers: range ? { Range: range } : {},
      signal: AbortSignal.timeout(300000) });
    if (range && upstream.status !== 206) {
      await upstream.body?.cancel();
      response.writeHead(416).end();
      console.error('Mirror rejected Range: HTTP ' + upstream.status);
      return;
    }
    const headers = {};
    for (const name of ['content-length', 'content-range', 'content-type', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    response.writeHead(upstream.status, headers);
    if (!upstream.body) { response.end(); return; }
    const stream = Readable.fromWeb(upstream.body);
    let bytes = 0, checkpoint = 0;
    stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes - checkpoint >= 32 * 1024 ** 2) {
        checkpoint = bytes;
        console.log(JSON.stringify({ mirrorProgress: mode, file: name, bytes }));
      }
    });
    stream.on('error', error => response.destroy(error));
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    if (!response.headersSent) response.writeHead(502);
    response.end('Mirror transport failed');
    console.error('Mirror transport failed: ' + error.message);
  }
}
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  response.on('error', () => {});
  if (pathname === '/cdn-cgi/trace') {
    counts.region++;
    response.end(downloadSource === 'cnb' ? 'loc=CN\n' : 'loc=GB\n');
    return;
  }
  if (pathname === '/repos/NCFXZ/VoxCue/releases' ||
      pathname === '/voxcue-release/voxcue-release/-/git/raw/main/releases.json') {
    assert.equal(pathname.includes('releases.json'), downloadSource === 'cnb', 'Selected country must select its own version feed');
    counts.releases++;
    const asset = (name, size) => ({ name, size, state: 'uploaded' });
    const releases = [{
      draft: false, prerelease: false, tag_name: to.candidate.tag,
      published_at: new Date(to.candidate.publishedAt).toISOString(), assets: [
        asset('latest.yml', to.manifest.length), asset(to.name, to.size), asset(to.name + '.blockmap', to.map.length),
      ],
    }];
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(
      downloadSource === 'cnb' ? { schemaVersion: 1, releases } : releases));
    return;
  }
  const match = /^\/(?:NCFXZ\/VoxCue\/releases|voxcue-release\/voxcue-release\/-\/releases)\/download\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (match) assert.equal(pathname.startsWith('/voxcue-release/'), downloadSource === 'cnb', 'All blockmaps and installer requests must stay on the selected source');
  const source = [from, to].find(item => item.candidate.tag === match?.[1]);
  if (!source) { response.writeHead(404).end(); return; }
  if (match[2] === 'latest.yml') {
    counts.manifests++;
    if (mirror) void proxyMirror(response, source, match[2]);
    else response.writeHead(200, { 'Content-Length': source.manifest.length }).end(source.manifest);
  } else if (match[2] === source.name + '.blockmap') {
    counts.blockmaps++;
    if (mode === 'missing-blockmap' && source === to) response.writeHead(404).end();
    else {
      counts.blockmapBytes += source.map.length;
      if (mirror) void proxyMirror(response, source, match[2]);
      else response.writeHead(200, { 'Content-Length': source.map.length }).end(source.map);
    }
  } else if (source === to && match[2] === to.name) {
    const range = request.headers.range;
    if (range) {
      counts.rangeRequests++;
      assert.match(range, /^bytes=\d+-\d+$/, 'Production provider uses single-range requests');
      if (mode === 'range-failure') { response.writeHead(416).end(); return; }
      const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range);
      const start = Number(first), end = Number(last);
      assert.ok(start <= end && end < to.size);
      counts.rangeBytes += end - start + 1;
      if (mirror) { void proxyMirror(response, source, match[2], range); return; }
      response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${to.size}`,
        'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
      const stream = createReadStream(to.binary, { start, end });
      if (mode === 'corrupt-range' && !injectedCorruption) {
        injectedCorruption = true;
        let firstChunk = true;
        stream.on('data', chunk => {
          if (firstChunk) { chunk[0] ^= 0xff; firstChunk = false; }
        });
      }
      stream.on('error', error => response.destroy(error));
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } else {
      counts.fullRequests++;
      counts.fullBytes += to.size;
      if (mirror) { void proxyMirror(response, source, match[2]); return; }
      response.writeHead(200, { 'Content-Length': to.size, 'Accept-Ranges': 'bytes' });
      const stream = createReadStream(to.binary);
      stream.on('error', error => response.destroy(error));
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    }
  } else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const profile = path.join(testRoot, 'profile');
await mkdir(profile);
const fixture = path.join(testRoot, 'main.cjs');
await writeFile(fixture, 'const {app}=require("electron");app.whenReady();');
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|userprofile|home|appdata|localappdata|lang|lc_all|sessionname)$/i.test(name)));
let app;
try {
  app = await electron.launch({ args: [fixture], env: { ...env, COPILOT_TEST_USER_DATA: profile,
    VITE_DEV_SERVER_URL: '', VOXCUE_ACCOUNT_API: '', VOXCUE_TEST_LOOPBACK_PORT: String(port) } });
  await app.evaluate(async ({ app, net }, { root, port, version, publicKey, deadline }) => {
    await app.whenReady();
    const require = process.getBuiltinModule('module').createRequire(root + '/package.json');
    const { NsisUpdater } = require('electron-updater');
    const { configurePlatformUpdates } = require(root + '/dist-electron/shared/electron/backend/updates/driver.js');
    const { UpdateService } = require(root + '/dist-electron/shared/electron/backend/updates/service.js');
    const { signedWindowsUpdate, validateSignedWindowsUpdate } = require(root + '/dist-electron/shared/electron/backend/updates/windowsManifest.js');
    app.getVersion = () => version;
    const session = new NsisUpdater().netSession;
    const fetch = session.fetch.bind(session);
    function localUrl(input) {
      const url = new URL(String(input));
      if (!((url.origin === 'https://api.github.com' && url.pathname === '/repos/NCFXZ/VoxCue/releases') ||
        (url.origin === 'https://github.com' && url.pathname.startsWith('/NCFXZ/VoxCue/releases/download/')) ||
        (url.origin === 'https://cnb.cool' && (url.pathname.startsWith('/voxcue-release/voxcue-release/-/releases/download/') ||
          url.pathname === '/voxcue-release/voxcue-release/-/git/raw/main/releases.json')) ||
        url.href === 'https://www.cloudflare-cn.com/cdn-cgi/trace'))
        throw Error('Unexpected update request: ' + url.href);
      return new URL(url.pathname + url.search, 'http://127.0.0.1:' + port);
    }
    session.fetch = (input, init) => fetch(localUrl(input).href, init);
    globalThis.runDifferentialCase = async directory => {
      const fs = require('node:fs');
      const path = require('node:path');
      const updater = new NsisUpdater();
      const config = path.join(directory, 'app-update.yml');
      fs.writeFileSync(config, JSON.stringify({ updaterCacheDirName: 'cache' }));
      Object.defineProperty(updater.app, 'baseCachePath', { value: directory });
      updater.updateConfigPath = config;
      updater.forceDevUpdateConfig = true;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      if (updater.disableDifferentialDownload !== false) throw Error('Differential downloads must remain enabled');
      const createRequest = updater.httpExecutor.createRequest.bind(updater.httpExecutor);
      // Rewrite only the transport destination. Keep the stock block planner,
      // Range handling, assembler, SHA512 verifier and full-download fallback.
      updater.httpExecutor.createRequest = (options, callback) => {
        const url = localUrl(`${options.protocol}//${options.hostname}${options.path}`);
        return createRequest({ ...options, protocol: url.protocol, hostname: url.hostname,
          port: url.port, path: url.pathname + url.search }, callback);
      };
      let installAttempts = 0;
      updater.quitAndInstall = updater.doInstall = () => { installAttempts++; throw Error('This download-only test forbids installation'); };
      const driver = configurePlatformUpdates(updater, 'windows-x64', undefined, {
        cacheDirectory: path.join(directory, 'release-state'),
        mapInfo: (candidate, metadata) => signedWindowsUpdate(metadata, candidate, publicKey),
        validate: (info, target) => validateSignedWindowsUpdate(info, target, publicKey),
      });
      const messages = [];
      updater.logger = { info() {}, warn() {}, debug: null, error: message => messages.push(String(message)) };
      const updates = new UpdateService({ currentVersion: version, autoDownload: false, driver,
        isInterviewActive: () => false, prepareInstall: async () => { throw Error('Installation forbidden'); }, emit() {} });
      globalThis.activeDifferentialUpdates = updates;
      const timer = setTimeout(() => void updates.dispose(), deadline);
      try {
        await updates.start();
        const state = await updates.download();
        return { state, installer: updater.installerPath, messages, installAttempts,
          autoInstall: updater.autoInstallOnAppQuit, differentialDisabled: updater.disableDifferentialDownload };
      } finally {
        clearTimeout(timer);
        await updates.dispose();
        globalThis.activeDifferentialUpdates = undefined;
      }
    };
    for (const attempt of [() => fetch('https://example.invalid'),
      () => net.request('http://127.0.0.1:' + (port === 65535 ? 65534 : port + 1))]) {
      try { await attempt(); throw Error('Transport isolation was bypassed'); }
      catch (error) { if (!/Offline desktop regression forbids network access/.test(error.message)) throw error; }
    }
  }, { root, port, version: from.metadata.version, publicKey, deadline: mirror ? 600000 : 60000 });

  const cases = mirror ? [['cnb', 'incremental'], ['cnb', 'range-failure']] : [
    ['github', 'incremental'], ...['incremental', 'missing-base', 'missing-blockmap', 'range-failure', 'corrupt-range'].map(mode => ['cnb', mode])];
  for ([downloadSource, mode] of cases) {
    counts = { region: 0, releases: 0, manifests: 0, blockmaps: 0, blockmapBytes: 0,
      rangeRequests: 0, rangeBytes: 0, fullRequests: 0, fullBytes: 0 };
    injectedCorruption = false;
    const directory = path.join(testRoot, downloadSource + '-' + mode);
    await mkdir(path.join(directory, 'cache'), { recursive: true });
    if (mode !== 'missing-base') await copyFile(from.binary, path.join(directory, 'cache/installer.exe'));
    const result = await app.evaluate((_electron, directory) => globalThis.runDifferentialCase(directory), directory);
    assert.equal(result.state.phase, 'downloaded', JSON.stringify(result));
    assert.ok(path.resolve(result.installer).startsWith(directory + path.sep));
    assert.equal(await hash(result.installer), to.metadata.sha512, 'Assembled/fallback installer must match the signed release');
    assert.equal(result.autoInstall, false);
    assert.equal(result.installAttempts, 0);
    assert.equal(result.differentialDisabled, false);
    assert.equal(counts.region, 1);
    assert.equal(counts.releases, 1);
    assert.equal(counts.manifests, 1);
    assert.ok(counts.blockmaps > 0, 'Every case must attempt differential download');
    if (mode === 'incremental') {
      assert.equal(counts.rangeRequests, changed.length);
      assert.equal(counts.rangeBytes, changedBytes);
      assert.equal(counts.fullRequests, 0, 'Successful differential download must never request the full installer');
      assert.ok(counts.rangeBytes + counts.blockmapBytes < to.size);
      assert.equal(result.messages.some(message => message.includes('fallback to full download')), false);
    } else {
      assert.equal(counts.fullRequests, 1, 'Differential failure must retain exactly one full-download fallback');
      assert.equal(counts.fullBytes, to.size);
      assert.ok(result.messages.some(message => message.includes('fallback to full download')), JSON.stringify(result.messages));
      if (mode === 'range-failure') assert.ok(counts.rangeRequests > 0);
      if (mode === 'corrupt-range') {
        assert.equal(injectedCorruption, true);
        assert.ok(result.messages.some(message => /sha512 checksum mismatch/i.test(message)), JSON.stringify(result.messages));
      }
    }
    const summary = { source: downloadSource, mode, ...counts, sha512Verified: true, signedManifestVerified: true, installed: false };
    allResults.push(summary);
    console.log(JSON.stringify(summary));
  }
  console.log(JSON.stringify({ passed: true, from: from.metadata.version, to: to.metadata.version,
    mirrorBase: mirror?.href,
    fullBytes: to.size, savedPercent: 100 * (1 - (allResults[0].rangeBytes + allResults[0].blockmapBytes) / to.size),
    productionAdapter: true, realNsisDownloader: true, results: allResults }));
} finally {
  if (app) {
    await app.evaluate(async () => { await globalThis.activeDifferentialUpdates?.dispose(); }).catch(() => {});
    await app.close();
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
