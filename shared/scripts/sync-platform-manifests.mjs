import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import workspace from './workspace.mjs';

const { repositoryRoot, sharedRoot, platformName } = workspace;
const checking = process.argv.includes('--check');
if (process.argv.includes('--all') && !checking)
  throw Error('--all is read-only and requires --check.');
const common = JSON.parse(await readFile(path.join(sharedRoot, 'package.json'), 'utf8'));
const workspaceConfig = await readFile(path.join(sharedRoot, 'pnpm-workspace.yaml'), 'utf8');
const npmConfig = await readFile(path.join(sharedRoot, '.npmrc'), 'utf8');
let stale = false;
for (const platform of ['windows', 'macos']) {
  const root = path.join(repositoryRoot, platform);
  const overrides = JSON.parse(await readFile(path.join(root, 'package.platform.json'), 'utf8'));
  const manifest = { ...common };
  for (const field of ['scripts', 'dependencies', 'devDependencies', 'optionalDependencies']) {
    const value = { ...common[field], ...overrides[field] };
    if (Object.keys(value).length) manifest[field] = value;
  }
  const renderer = {
    extends: '../shared/tsconfig.json',
    compilerOptions: {
      baseUrl: '.',
      paths: { '@/*': ['../shared/src/*'], '*': ['node_modules/@types/*', 'node_modules/*'] },
      typeRoots: ['node_modules/@types', 'node_modules'],
    },
    include: ['../shared/src', ...(platform === 'macos' ? ['src/icons.tsx'] : [])],
  };
  const electron = {
    extends: '../shared/tsconfig.electron.json',
    compilerOptions: {
      baseUrl: '.',
      paths: { '*': ['node_modules/@types/*', 'node_modules/*'] },
      typeRoots: ['node_modules/@types'],
      rootDir: '..',
      outDir: 'dist-electron',
    },
    include: ['../shared/electron', 'electron'],
  };
  const contracts = {
    extends: '../shared/tsconfig.contracts.json',
    compilerOptions: { ...renderer.compilerOptions, types: ['node', 'vite/client'] },
  };
  const files = {
    'package.json': JSON.stringify(manifest, null, 2) + '\n',
    'tsconfig.json': JSON.stringify(renderer, null, 2) + '\n',
    'tsconfig.electron.json': JSON.stringify(electron, null, 2) + '\n',
    'tsconfig.contracts.json': JSON.stringify(contracts, null, 2) + '\n',
    'vite.config.mjs': "export { default } from '../shared/vite.config.mjs';\n",
    '.npmrc': npmConfig,
    'pnpm-workspace.yaml':
      workspaceConfig +
      `\nsupportedArchitectures:\n  os: [${platform === 'windows' ? 'win32' : 'darwin'}]\n  cpu: [${platform === 'windows' ? 'x64' : 'arm64'}]\n`,
  };
  for (const [name, expected] of Object.entries(files)) {
    const file = path.join(root, name);
    const actual = await readFile(file, 'utf8').catch(() => undefined);
    if (actual === expected) continue;
    if (platform !== platformName) {
      console.warn(`Read-only pending on ${platform}: ${name}`);
      if (checking && process.argv.includes('--all')) stale = true;
    } else if (checking) {
      console.error(`Out of date: ${platform}/${name}`);
      stale = true;
    } else await writeFile(file, expected);
  }
}
const windows = JSON.parse(
  await readFile(path.join(repositoryRoot, 'windows/package.platform.json'), 'utf8'),
);
const mac = JSON.parse(
  await readFile(path.join(repositoryRoot, 'macos/package.platform.json'), 'utf8'),
);
const scripts = Object.fromEntries(
  [
    ...new Set([
      ...Object.keys(common.scripts),
      ...Object.keys(windows.scripts),
      ...Object.keys(mac.scripts),
    ]),
  ]
    .sort()
    .map((name) => [name, `node shared/scripts/run.mjs ${name}`]),
);
scripts.preinstall = 'node shared/scripts/run.mjs --reject-root-install';
scripts['sync:workspace'] = 'node shared/scripts/sync-platform-manifests.mjs';
const rootManifest =
  JSON.stringify(
    {
      name: 'voxcue-workspace',
      version: common.version,
      private: true,
      description:
        'Command dispatcher; dependencies are installed separately inside windows/ and macos/.',
      packageManager: common.packageManager,
      scripts,
    },
    null,
    2,
  ) + '\n';
const rootFile = path.join(repositoryRoot, 'package.json');
if ((await readFile(rootFile, 'utf8').catch(() => undefined)) !== rootManifest) {
  if (process.argv.includes('--check')) {
    console.error('Out of date: package.json');
    stale = true;
  } else await writeFile(rootFile, rootManifest);
}
const rootWorkspace = 'packages: []\nverifyDepsBeforeRun: false\n';
const workspaceFile = path.join(repositoryRoot, 'pnpm-workspace.yaml');
if ((await readFile(workspaceFile, 'utf8').catch(() => undefined)) !== rootWorkspace) {
  if (process.argv.includes('--check')) {
    console.error('Out of date: pnpm-workspace.yaml');
    stale = true;
  } else await writeFile(workspaceFile, rootWorkspace);
}
if (process.argv.includes('--check')) {
  const allowed = new Set([
    'windows',
    'macos',
    'shared',
    'AGENTS.md',
    'PROGRESS.md',
    'README.md',
    'package.json',
    'pnpm-workspace.yaml',
  ]);
  for (const name of fs.readdirSync(repositoryRoot)) {
    if (!name.startsWith('.') && !allowed.has(name)) {
      console.error(`Unexpected root entry: ${name}`);
      stale = true;
    }
  }
  for (const directory of [repositoryRoot, sharedRoot]) {
    if (fs.existsSync(path.join(directory, 'node_modules'))) {
      console.error(
        `Dependencies must be platform-local: ${path.relative(repositoryRoot, directory) || '.'}/node_modules`,
      );
      stale = true;
    }
  }
}
if (stale) process.exitCode = 1;
else
  console.log(
    process.argv.includes('--check')
      ? `${platformName} manifests and shared root are synchronized; other platform is read-only.`
      : `Generated ${platformName} manifests and shared root only; other platform is read-only.`,
  );
