import path from 'node:path';
import assert from 'node:assert/strict';
import workspace from '../../../shared/scripts/workspace.mjs';
import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';

// UI fixtures install synthetic accounts, components, audio and captures. They
// need no model weights. Uses the production shared UI; GUI stays serial.
const outcomes = [];
assert.ok(
  process.argv.slice(2).every((argument) => /^--scale=(1|1\.25|1\.5|1\.75|2)$/.test(argument)),
  'Only --scale is supported by the Mac UI matrix',
);
const requestedScale = process.argv.find((arg) => arg.startsWith('--scale='))?.slice(8);
const scales = requestedScale ? [requestedScale] : ['1', '1.25', '1.5', '1.75', '2'];
assert.ok(scales.every((scale) => ['1', '1.25', '1.5', '1.75', '2'].includes(scale)));
for (const scale of scales) {
  for (const name of ['ui-alignment', 'ui-refinement', 'interview-screenshot']) {
    const child = spawnTestProcess(
      process.execPath,
      [path.join(workspace.sharedRoot, 'test/scripts', name + '-smoke.mjs')],
      {
        cwd: workspace.platformRoot,
        env: {
          ...process.env,
          VOXCUE_TEST_SCALE_FACTOR: scale,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
    const code = await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    }).finally(() => clearTimeout(timer));
    const outcome = { scope: 'shared-macos', scale, name, passed: code === 0 };
    outcomes.push(outcome);
    console.log((outcome.passed ? 'PASS ' : 'FAIL ') + JSON.stringify(outcome));
    if (!outcome.passed) console.error(output);
  }
}
console.log(
  JSON.stringify({ passed: outcomes.filter((item) => item.passed).length, total: outcomes.length }),
);
if (outcomes.some((item) => !item.passed)) process.exitCode = 1;
