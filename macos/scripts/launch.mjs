import workspace from '../../shared/scripts/workspace.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { prepareRuntime } from './prepare-runtime.mjs';
if (path.resolve(process.cwd()) !== workspace.platformRoot)
  throw Error('Run from the macos installation.');
const runtime = await prepareRuntime();
const development = process.argv.includes('--dev');
const child = spawn(
  development ? process.execPath : runtime.executable,
  development ? [path.resolve('../shared/scripts/dev.mjs')] : ['.'],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: runtime.directory },
  },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
