import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  testRoot,
  spawnTestProcess,
  electron,
} from '../../../shared/test/scripts/test-workspace.mjs';
import fuses from '@electron/fuses';
import { prepareVcRuntime } from '../../scripts/vc-runtime.mjs';
import { checkPackagedRenderer } from './packaged-renderer-check.mjs';
import { sileroModel, sileroLicense, validSileroAsset } from '../../../shared/scripts/silero-assets.mjs';

const require = createRequire(import.meta.url);
assert.ok(process.argv.slice(2).every((argument) => argument === '--with-screenshot-worker'));
const { getCurrentFuseWire, FuseV1Options } = fuses;
const output = path.join(testRoot, 'platform-layout-security');
const child = spawnTestProcess(
  process.execPath,
  ['scripts/package-portable.mjs', '--test-output=' + output],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);
let failure = '';
child.stdout.on('data', () => {});
child.stderr.on('data', (chunk) => {
  if (failure.length < 16000) failure += chunk;
});
const deadline = setTimeout(() => child.kill('SIGTERM'), 240000);
try {
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, failure);
} finally {
  clearTimeout(deadline);
}

const root = path.join(output, 'VoxCue-win32-x64');
const executable = path.join(root, 'VoxCue.exe');
const wire = await getCurrentFuseWire(executable);
for (const [option, enabled] of [
  [FuseV1Options.RunAsNode, false],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
  [FuseV1Options.EnableNodeCliInspectArguments, false],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true],
  [FuseV1Options.OnlyLoadAppFromAsar, true],
])
  assert.equal(wire[option], (enabled ? '1' : '0').charCodeAt(0));

const asar = await import(pathToFileURL(require.resolve('@electron/asar')).href);
const archive = path.join(root, 'resources/app.asar');
await checkPackagedRenderer(archive);
const { NtExecutable, NtExecutableResource } = await import(
  pathToFileURL(createRequire(require.resolve('@electron/packager')).resolve('resedit')).href
);
const resources = NtExecutableResource.from(NtExecutable.from(await readFile(executable))).entries;
const integrity = resources.filter(
  (entry) => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR',
);
assert.equal(integrity.length, 1);
const headerHash = createHash('sha256')
  .update(asar.getRawHeader(archive).headerString)
  .digest('hex');
assert.deepEqual(JSON.parse(Buffer.from(integrity[0].bin).toString()), [
  {
    file: 'resources\\app.asar',
    alg: 'SHA256',
    value: headerHash,
  },
]);
const key = JSON.parse(await readFile('update-public-key.json', 'utf8'));
assert.notEqual(
  asar.statFile(archive, path.normalize('dist-electron/windows/electron/voxcue-update.json'))
    .unpacked,
  true,
  'The update trust root must stay inside the integrity-protected ASAR',
);
assert.deepEqual(
  JSON.parse(
    asar
      .extractFile(archive, path.normalize('dist-electron/windows/electron/voxcue-update.json'))
      .toString(),
  ),
  {
    ...key,
    repository: 'NCFXZ/VoxCue',
  },
);
await assert.rejects(readFile(path.join(root, 'resources/voxcue-update.json')), { code: 'ENOENT' });
const entries = asar
  .listPackage(archive)
  .map((entry) => entry.replaceAll('\\', '/').replace(/^\//, ''));
assert.ok(
  !entries.some(
    (entry) =>
      /(?:^|\/)(?:\.tools|test|scripts)\/|ed25519\.key/.test(entry) &&
      !/(?:^|\/)node_modules\//.test(entry),
  ),
);
assert.ok(
  !entries.some((entry) =>
    /(?:^|\/)(?:auth\.json|credentials\.json|\.env)$|\.(?:pem|keychain-db)$/.test(entry),
  ),
);
assert.ok(entries.some((entry) => entry.endsWith('/windows/electron/updates.js')));
assert.ok(
  !entries.some((entry) =>
    /^(?:test|scripts|src|electron|server|local-models|\.git|\.tools)\//.test(entry),
  ),
);
assert.ok(
  !entries.some((entry) => /node_modules\/(?:onnxruntime-web(?:\/|$)|koffi(?:\/|$))/.test(entry)),
);
assert.ok(!entries.some((entry) => /(?:dist-electron\/macos\/|Sparkle|sf-symbols)/i.test(entry)));
assert.ok(
  !entries.some((entry) => /\.(?:dylib|so(?:\.\d+)*|icns)$|\.framework\//i.test(entry)),
  'Foreign platform native libraries must not enter the Windows package',
);
assert.ok(
  !entries.some((entry) => /\.(?:onnx|safetensors|gguf)$/i.test(entry)),
  'Model weights stay external',
);
assert.ok(
  !entries.some((entry) =>
    /node_modules\/(?:@github\/copilot-sdk-|@openai\/codex-)(?!win32-x64\/)[^/]+\//.test(entry),
  ),
);
for (const dependency of [
  '@ennuicastr/webrtcaec3.js',
  'adm-zip',
  'onnxruntime-node',
  'sherpa-onnx-win-x64',
  '@lancedb/lancedb',
  '@github/copilot-sdk',
  '@github/copilot-sdk-win32-x64',
  '@openai/codex',
  '@openai/codex-win32-x64',
  'word-extractor',
  'chardet',
  'ws',
  'sharp',
])
  assert.ok(
    entries.some((entry) => entry.includes('node_modules/' + dependency + '/')),
    dependency,
  );
for (const [name, version] of [
  ['@github/copilot-sdk', '1.0.21'],
  ['@github/copilot-sdk-win32-x64', '1.0.21'],
  ['@openai/codex', '0.171.0'],
  ['@openai/codex-win32-x64', '0.171.0-win32-x64'],
  ['zod', '4.6.6'],
  ['word-extractor', '1.0.4'],
  ['chardet', '2.1.1'],
  ['ws', '8.22.2'],
])
  assert.equal(
    JSON.parse(asar.extractFile(archive, path.normalize('node_modules/' + name + '/package.json')))
      .version,
    version,
  );
for (const file of [
  'dist-electron/shared/electron/backend/copilot/runtime.js',
  'dist-electron/shared/electron/backend/chat/codexUsage.js',
  'node_modules/@github/copilot-sdk/dist/cjs/index.js',
  ...[
    'copilot-runtime.exe',
    'runtime.node',
    'dpapi.node',
    'msal-node-runtime.node',
    'msalruntime.dll',
  ].map((file) => 'node_modules/@github/copilot-sdk-win32-x64/prebuilds/win32-x64/' + file),
  'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
  ...['dist/webrtcaec3-0.3.0.js', 'dist/webrtcaec3-0.3.0.wasm', 'license.js'].map(
    (file) => 'node_modules/@ennuicastr/webrtcaec3.js/' + file,
  ),
])
  assert.ok(entries.includes(file), file);
const nativeFiles = entries.filter((entry) =>
  /^node_modules\/(?:@github\/copilot-sdk-win32-x64|@openai\/codex-win32-x64)\/.*\.(?:exe|node|dll)$/.test(
    entry,
  ),
);
const bindings = entries.filter((entry) =>
  /(?:^|\/)node_modules\/(?:@lancedb\/lancedb-win32-x64-msvc\/lancedb\.win32-x64-msvc|onnxruntime-node\/bin\/napi-v\d+\/win32\/x64\/onnxruntime_binding)\.node$/.test(
    entry,
  ),
);
assert.ok(bindings.some((file) => file.includes('/lancedb-win32-x64-msvc/')));
assert.ok(bindings.some((file) => file.includes('/onnxruntime-node/')));
const runtime = await prepareVcRuntime();
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  const bundled = await readFile(path.join(root, 'resources/licenses', name));
  assert.ok(bundled.equals(await readFile(path.join('..', name))), name);
}
for (const [directory, asset] of [['native', sileroModel], ['licenses', sileroLicense]])
  assert.ok(validSileroAsset(asset, await readFile(path.join(root, 'resources', directory, asset.name))), asset.name);
const cancellation = path.normalize('dist-electron/shared/electron/backend/cancellable.js');
assert.equal(asar.statFile(archive, cancellation).unpacked, true);
const physicalCancellation = await readFile(path.join(archive + '.unpacked', cancellation));
assert.ok(physicalCancellation.equals(await readFile(cancellation)), cancellation);
assert.equal(
  createHash('sha256')
    .update(await readFile(path.join(root, 'resources/licenses', runtime.license.name)))
    .digest('hex'),
  runtime.license.sha256,
  'Original Microsoft runtime license must accompany the app-local DLLs',
);
const crtFiles = new Map();
for (const binding of bindings)
  for (const file of runtime.files) {
    const target = path.posix.join(path.posix.dirname(binding), file.name);
    assert.ok(entries.includes(target), 'Missing app-local CRT: ' + target);
    crtFiles.set(target, file.sha256);
    nativeFiles.push(target);
  }
for (const file of nativeFiles) {
  assert.equal(asar.statFile(archive, path.normalize(file)).unpacked, true, file);
  const bytes = await readFile(path.join(archive + '.unpacked', file));
  if (crtFiles.has(file))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), crtFiles.get(file), file);
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ', file);
  const header = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.toString('ascii', header, header + 4), 'PE\0\0', file);
  assert.equal(bytes.readUInt16LE(header + 4), 0x8664, 'Expected Windows x64: ' + file);
}
assert.deepEqual(
  JSON.parse(await readFile(path.join(root, 'resources/voxcue-components.json'), 'utf8')),
  { schemaVersion: 1 },
);
await assert.rejects(readFile(path.join(root, 'resources/models')), { code: 'ENOENT' });
assert.ok(
  !entries.some((entry) => /(?:^|\/)sprintf-js\//.test(entry)),
  'Unused vulnerable CLI dependency must not be packaged',
);
for (const file of entries.filter((entry) => /(?:^|\/)sharp\/package\.json$/.test(entry))) {
  const pkg = JSON.parse(asar.extractFile(archive, path.normalize(file)));
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  assert.ok(
    major > 0 || minor > 35 || (minor === 35 && patch >= 5),
    `Vulnerable sharp ${pkg.version} at ${file}`,
  );
}
const html = asar.extractFile(archive, 'dist/index.html').toString();
assert.ok(html.includes("connect-src 'self';"));
assert.ok(!/connect-src[^";]*(?:127\.0\.0\.1|localhost)/.test(html));
// This must fail before spawning, profile reads or credential execution guards.
await assert.rejects(
  electron.launch({ executablePath: executable, args: [], env: process.env }),
  /Production package GUI tests require OS isolation/,
);
console.log(
  'Windows security artifact: fuses, embedded ASAR integrity, public update key, CSP, thin-package exclusions, pinned SDKs, native x64 files, app-local CRT, AEC assets, sharp and owner launch refusal verified. Production UI was not launched; native handshakes require the isolated package test.',
);
if (process.argv.includes('--with-screenshot-worker')) {
  const { checkPackagedScreenshots } = await import('./screenshot-package-check.mjs');
  await checkPackagedScreenshots(root);
}
