import { execFileSync } from 'node:child_process';
import { access, lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'win32' || path.relative(root, process.cwd()) !== '')
  throw Error('Build the Store package from the Windows workspace');
const testArgument = process.argv[2];
if (process.argv.length > 3 || (testArgument && !testArgument.startsWith('--test-output=')))
  throw Error('Unexpected Store package option');
const testOutput = testArgument?.slice('--test-output='.length);
const output = path.resolve(testOutput ?? 'release/store');
let testOwner;
if (testArgument) {
  testOwner = path.dirname(output);
  if (!testOutput || path.basename(output) !== 'platform-layout-store-package' ||
      path.dirname(testOwner) !== await realpath(os.tmpdir()) ||
      !path.basename(testOwner).startsWith('voxcue-test-run-') ||
      (await lstat(testOwner)).isSymbolicLink() || await realpath(testOwner) !== testOwner)
    throw Error('Unsafe Store verification output');
  const marker = path.join(testOwner, '.voxcue-test-owner.json');
  if (!(await lstat(marker)).isFile() || await realpath(marker) !== marker)
    throw Error('Invalid Store verification owner marker');
  const owner = JSON.parse(await readFile(marker, 'utf8'));
  if (owner.kind !== 'voxcue-test-run-' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw Error('Unknown Store verification owner');
  process.kill(owner.pid, 0);
}

// Store builds must not consume host signing inputs, even while a packaging
// library initializes or eagerly evaluates its fallback environment variables.
for (const name of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_KEY_PASSWORD'])
  process.env[name] = '';
process.env.ELECTRON_BUILDER_CACHE = path.resolve('.cache/electron-builder');
const { build, Platform, Arch } = await import('electron-builder');

const { version } = JSON.parse(await readFile('../shared/package.json', 'utf8'));
const parts = version.split('.').map(Number);
// Store package identity needs a positive major and a zero fourth component.
// Only builder metadata is overridden; the staged app keeps the shared version.
const [major, minor, patch] = parts;
if (!/^\d+\.\d+\.\d+$/.test(version) || major >= 65535 || minor > 65535 || patch > 65535)
  throw Error(`Unsupported Store package version: ${version}`);
const storeVersion = `${major + 1}.${minor}.${patch}`;

const resources = path.join(output, 'resources');
const assets = path.join(resources, 'appx');
for (const directory of [path.dirname(output), output, resources, assets]) {
  await mkdir(directory, { recursive: true });
  if (path.relative(directory, await realpath(directory)) !== '')
    throw Error('Store output must use its owned directory directly');
}

const childOptions = { cwd: root, stdio: 'inherit', windowsHide: true };
const assetBuilder = path.join(resources, 'StoreAssets.exe');
execFileSync(
  path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  [
    '/nologo',
    '/utf8output',
    '/r:System.Drawing.dll',
    `/out:${assetBuilder}`,
    path.join(root, 'scripts', 'StoreAssets.cs'),
  ],
  childOptions,
);
execFileSync(assetBuilder, [path.resolve('../shared/public/voxcue.png'), assets], childOptions);
const stageRoot = testOwner
  ? path.join(testOwner, 'platform-layout-store-stage')
  : path.resolve('release/store-stage');
execFileSync(process.execPath, ['scripts/package-portable.mjs', '--store',
  ...(testOwner ? ['--test-output=' + stageRoot] : [])], childOptions);

const stage = path.join(stageRoot, 'VoxCue-win32-x64');
if (path.relative(stage, await realpath(stage)) !== '')
  throw Error('Unexpected Store staging path');
const file = `VoxCue-Store-${version}-x64.appx`;
const artifacts = await build({
  targets: Platform.WINDOWS.createTarget('appx', Arch.x64),
  prepackaged: stage,
  publish: 'never',
  config: {
    productName: 'VoxCue',
    publish: null,
    toolsets: { winCodeSign: '1.1.0' },
    directories: { output, buildResources: resources },
    extraMetadata: { version: storeVersion },
    win: { signExecutable: false },
    appx: {
      artifactName: file,
      identityName: 'NCFX.VoxCue',
      publisher: 'CN=CC9C4962-FFC8-44D9-A2C0-B446CBFD375A',
      publisherDisplayName: 'F. Zhu',
      languages: ['en-US', 'zh-CN'],
      backgroundColor: 'transparent',
    },
  },
});
const artifact = path.join(output, file);
if (!artifacts.some((candidate) => path.relative(artifact, candidate) === ''))
  throw Error('Store build did not produce the expected package');
await access(artifact);
console.log(JSON.stringify({ artifact, packageVersion: `${storeVersion}.0` }));
