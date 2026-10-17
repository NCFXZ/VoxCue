import workspace from '../../scripts/workspace.mjs';
import { spawnTestProcess } from './test-workspace.mjs';
const require = workspace.platformRequire;
const child = spawnTestProcess(require('electron'), process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true,
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
