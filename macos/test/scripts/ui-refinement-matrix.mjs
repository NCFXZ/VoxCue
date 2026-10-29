import path from 'node:path';
import assert from 'node:assert/strict';
import workspace from '../../../shared/scripts/workspace.mjs';
import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { requireUnlockedDesktop, holdDesktopAwake } from './desktop-session.mjs';

// UI fixtures install synthetic accounts, components, audio and captures. They
// need no model weights. Uses the production shared UI; GUI stays serial.
const outcomes = [];
assert.ok(
  process.argv
    .slice(2)
    .every(
      (argument) =>
        /^--scale=(1|1\.25|1\.5|1\.75|2)$/.test(argument) || argument.startsWith('--screenshots='),
    ),
  'Only --scale and --screenshots are supported by the Mac UI matrix',
);
const requestedScale = process.argv.find((arg) => arg.startsWith('--scale='))?.slice(8);
const screenshots = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
if (screenshots) assert.ok(path.isAbsolute(screenshots), 'Screenshot directory must be absolute');
const scales = requestedScale ? [requestedScale] : ['1', '1.25', '1.5', '1.75', '2'];
assert.ok(scales.every((scale) => ['1', '1.25', '1.5', '1.75', '2'].includes(scale)));
const releaseDesktop = holdDesktopAwake();
for (const scale of scales) {
  for (const name of [
    'ui-alignment',
    'ui-refinement',
    'interview-screenshot',
    'typography',
    'updates-sidebar',
    'components-ui',
    'cloud-login',
    'cloud-account',
    'password-policy',
    'free-service',
    'account-erasure',
    'management-scrollbars',
  ]) {
    requireUnlockedDesktop();
    const accountArguments = {
      'cloud-login': ['--login-check'],
      'cloud-account': [],
      'management-scrollbars': ['--scrollbars'],
    }[name];
    const child = spawnTestProcess(
      process.execPath,
      [
        path.join(
          workspace.sharedRoot,
          'test/scripts',
          (accountArguments ? 'cloud-account' : name) + '-smoke.mjs',
        ),
        ...(accountArguments ?? []),
        ...(screenshots ? ['--screenshots=' + path.join(screenshots, scale, name)] : []),
      ],
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
releaseDesktop();
console.log(
  JSON.stringify({ passed: outcomes.filter((item) => item.passed).length, total: outcomes.length }),
);
if (outcomes.some((item) => !item.passed)) process.exitCode = 1;
