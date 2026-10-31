import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createReadStream, realpathSync, lstatSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { open, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';

assert.equal(process.platform, 'win32');
process.env.ELECTRON_BUILDER_CACHE = path.resolve('.cache/electron-builder');
const require = createRequire(import.meta.url);
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
const yaml = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
const sevenZip = await getPath7za();
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const name = `VoxCue-Setup-${version}-x64.exe`;
const testRelease = process.argv
  .find((arg) => arg.startsWith('--test-release='))
  ?.slice('--test-release='.length);
if (testRelease) {
  const directory = path.resolve(testRelease);
  assert.equal(path.dirname(directory), realpathSync(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('voxcue-test-run-'));
  assert.equal(lstatSync(directory).isSymbolicLink(), false);
  assert.equal(realpathSync(directory), directory);
  const owner = JSON.parse(readFileSync(path.join(directory, '.voxcue-test-owner.json'), 'utf8'));
  assert.equal(owner.kind, 'voxcue-test-run-');
  assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
  process.kill(owner.pid, 0);
}
const output = testRelease
  ? path.join(testRelease, 'installer')
  : path.resolve('release/installer');
const installer = path.join(output, name);
const stage = testRelease
  ? path.join(testRelease, 'platform-layout-portable/VoxCue-win32-x64')
  : path.resolve('release/installer-stage/VoxCue-win32-x64');
const manifest = yaml.load(await readFile(path.join(output, 'latest.yml'), 'utf8'));
assert.equal(manifest.version, version);
assert.equal(manifest.path, name);
const binary = manifest.files.find((file) => file.url === name);
assert.ok(binary);
assert.equal(binary.size, (await stat(installer)).size);
async function hashFile(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
const sha512 = await hashFile(installer, 'sha512', 'base64');
assert.equal(binary.sha512, sha512);
assert.equal(manifest.sha512, sha512);
const blockmapBytes = await readFile(installer + '.blockmap');
const blockmap = JSON.parse(
  (blockmapBytes[0] === 0x1f && blockmapBytes[1] === 0x8b
    ? gunzipSync(blockmapBytes)
    : inflateRawSync(blockmapBytes)
  ).toString('utf8'),
);
assert.ok(blockmap.files.length > 0);
assert.ok(
  blockmap.files.every(
    (file) => file.sizes.length > 0 && file.sizes.length === file.checksums.length,
  ),
);
async function run(args, consume) {
  const child = spawnTestProcess(sevenZip, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '',
    error = '';
  child.stdout.on('data', consume ?? ((data) => (output += data)));
  child.stderr.on('data', (data) => (error += data));
  const timer = setTimeout(() => child.kill(), 180000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, error || output);
  return output;
}
await run(['t', '-bd', installer]);
const listing = await run(['l', '-slt', installer]);
// Builder's bundled 7za detects the embedded 7z stream directly inside NSIS.
assert.match(listing, /^Type = 7z\r?$/m);
assert.ok(Number(listing.match(/^Offset = (\d+)\r?$/m)?.[1]) > 0);
const header = Buffer.alloc(4096);
const handle = await open(installer, 'r');
try {
  await handle.read(header, 0, header.length, 0);
} finally {
  await handle.close();
}
assert.equal(header.toString('ascii', 0, 2), 'MZ');
assert.equal(
  header.toString('ascii', header.readUInt32LE(0x3c), header.readUInt32LE(0x3c) + 4),
  'PE\0\0',
);
for (const file of [
  'VoxCue.exe',
  'resources/app.asar',
  'resources/app-update.yml',
  'resources/voxcue-components.json',
  'resources/native/VoxCue.Audio.exe',
  'resources/native/VoxCue.Screenshot.exe',
]) {
  const hash = createHash('sha256');
  let bytes = 0;
  assert.ok(listing.includes('Path = ' + file.replaceAll('/', '\\') + '\r\n'));
  await run(['e', '-so', '-bd', installer, file.replaceAll('/', '\\')], (data) => {
    hash.update(data);
    bytes += data.length;
  });
  assert.equal(bytes, (await stat(path.join(stage, file))).size, file + ' payload size');
  assert.equal(
    hash.digest('hex'),
    await hashFile(path.join(stage, file)),
    file + ' differs from validated staging',
  );
}
console.log(
  JSON.stringify({
    status: 'passed',
    version,
    installerSha256: await hashFile(installer),
    manifestSha512: true,
    blockmap: true,
    nsisPayloadIntegrity: true,
    executableAndResourcesMatchStage: true,
    installed: false,
  }),
);
