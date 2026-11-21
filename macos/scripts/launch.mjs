import workspace from '../../shared/scripts/workspace.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { prepareRuntime } from './prepare-runtime.mjs';

if (path.resolve(process.cwd()) !== workspace.platformRoot)
  throw Error('Run from the macos installation.');

const development = process.argv.includes('--dev');
let command = '/usr/bin/open';
let args = ['-W', path.join(workspace.platformRoot, 'VoxCue.app')];
let env = process.env;
if (development) {
  const runtime = await prepareRuntime();
  await import('./build-symbols.mjs');
  command = process.execPath;
  args = [path.resolve('../shared/scripts/dev.mjs')];
  env = { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: runtime.directory };
}
const child = spawn(command, args, { stdio: 'inherit', env });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
