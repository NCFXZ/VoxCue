import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from './workspace.mjs';

const [task, ...args] = process.argv.slice(2);
if (task === '--reject-root-install') {
  console.error('Install inside windows/ or macos/: corepack pnpm install --frozen-lockfile');
  process.exit(1);
}
if (!['win32', 'darwin'].includes(process.platform)) throw Error('Unsupported desktop platform.');
const platform = process.platform === 'win32' ? 'windows' : 'macos';
const directory = path.join(workspace.repositoryRoot, platform);
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
if (!Object.hasOwn(manifest.scripts, task)) throw Error(`${task} is unavailable on ${platform}.`);
const executable = process.env.npm_execpath ? path.resolve(process.env.npm_execpath) : undefined;
if (!executable || !/pnpm/i.test(executable))
  throw Error('Run from the repository root with corepack pnpm <command>.');
if (task.startsWith('build') || task.startsWith('package:') || ['dev', 'format'].includes(task)) {
  const checked = spawnSync(
    process.execPath,
    [path.join(workspace.sharedRoot, 'scripts/sync-platform-manifests.mjs'), '--check'],
    {
      cwd: directory,
      stdio: 'inherit',
    },
  );
  if (checked.error) throw checked.error;
  if (checked.status !== 0)
    throw Error(
      'Run corepack pnpm sync:workspace on this host before building or formatting. No platform files were written.',
    );
}
let runtimeDirectory;
if (platform === 'macos' && task.startsWith('test:')) {
  const { prepareRuntime } = await import(
    pathToFileURL(path.join(directory, 'scripts/prepare-runtime.mjs')).href
  );
  runtimeDirectory = (await prepareRuntime()).directory;
}
const child = spawn(process.execPath, [executable, 'run', task, ...args], {
  cwd: directory,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(runtimeDirectory ? { ELECTRON_OVERRIDE_DIST_PATH: runtimeDirectory } : {}),
    COREPACK_HOME: path.join(directory, '.tools/corepack'),
    ELECTRON_CACHE: path.join(directory, '.cache/electron'),
    npm_config_cache: path.join(directory, '.cache/npm'),
  },
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => (process.exitCode = code ?? 1));
