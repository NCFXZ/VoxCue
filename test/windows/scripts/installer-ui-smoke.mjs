import { spawn } from 'node:child_process';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
const root = process.cwd();
if (process.platform !== 'win32') throw Error('Windows installer validation requires Windows');
const suite = process.argv[2];
const suites = {
  'chat-progress': 'test/shared/scripts/chat-progress-smoke.mjs',
  adversarial: 'test/shared/scripts/adversarial-smoke.mjs',
  updates: 'test/shared/scripts/updates-smoke.mjs',
  copilot: 'test/windows/scripts/copilot-smoke.mjs',
};
if (!Object.hasOwn(suites, suite)) throw Error('Unknown installer UI suite');
const executable = await realpath(
  path.resolve('release/installer-stage/VoxCue-win32-x64/VoxCue.exe'),
);
const allowed = path.resolve('release/installer-stage') + path.sep;
if (!executable.startsWith(allowed)) throw Error('Installer executable escapes staging');
const args =
  suite === 'copilot'
    ? ['--installer-stage']
    : [...(suite === 'updates' ? ['--packaged-bootstrap'] : []), '--app-executable=' + executable];
const child = spawn(process.execPath, [suites[suite], ...args], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
