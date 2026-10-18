import path from 'node:path';
import assert from 'node:assert/strict';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
const child = spawnTestProcess(
  workspace.platformRequire('electron'),
  [path.resolve('test/fixtures/speech-failure-check.cjs')],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VOXCUE_FAILURE_ROOT: testRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);
child.stdout.on('data', (data) => process.stdout.write(data));
child.stderr.on('data', (data) => process.stderr.write(data));
const timer = setTimeout(() => child.kill(), 90000);
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
}).finally(() => clearTimeout(timer));
assert.equal(code, 0, 'Windows speech faults failed');
