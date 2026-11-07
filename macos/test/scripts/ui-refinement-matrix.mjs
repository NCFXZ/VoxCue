import path from 'node:path';
import assert from 'node:assert/strict';
import workspace from '../../../shared/scripts/workspace.mjs';
import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { prepareModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { needsModels } from '../../../shared/test/scripts/suite-policy.mjs';
import { watchTestDesktop } from '../../../shared/test/scripts/desktop-guard.mjs';
import { requireUnlockedDesktop, holdDesktopAwake } from './desktop-session.mjs';

// Synthetic accounts/audio/captures and fixed public models stay in this owned run.
// Uses the production shared UI; GUI stays serial.
const outcomes = [];
const suites = [
  'web-materials',
  'ui-material-refinement',
  'ui-alignment',
  'ui-refinement',
  'interview-screenshot',
  'interview-typography',
  'interview-chrome',
  'interview-ux',
  'typography',
  'updates',
  'updates-sidebar',
  'components-ui',
  'cloud-login',
  'cloud-account',
  'password-policy',
  'free-service',
  'account-erasure',
  'management-scrollbars',
  'client-update-ui',
  'shimmer',
  'knowledge',
  'local-mode',
  'telemetry',
  'settings',
  'language',
  'preparation-guide',
  'profile-ui',
  'profile-selection',
  'history-branding',
  'login',
  'login-entry',
  'composer',
  'provider-ui',
  'chat-response',
  'chat-progress',
  'account-usage-overview',
];
assert.ok(
  process.argv
    .slice(2)
    .every(
      (argument) =>
        /^--scale=(1|1\.25|1\.5|1\.75|2)$/.test(argument) ||
        argument.startsWith('--screenshots=') ||
        argument.startsWith('--suite=') ||
        argument === '--list',
    ),
  'Only --scale, --suite, --list and --screenshots are supported by the Mac UI matrix',
);
const requestedScale = process.argv.find((arg) => arg.startsWith('--scale='))?.slice(8);
const selections = process.argv.filter((arg) => arg.startsWith('--suite='));
assert.ok(selections.length <= 1, 'Use one --suite=<name,...>');
const names = selections.length ? selections[0].slice(8).split(',') : suites;
assert.ok(
  names.every((name) => suites.includes(name)),
  'Unknown Mac UI matrix suite',
);
const screenshots = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
if (screenshots) assert.ok(path.isAbsolute(screenshots), 'Screenshot directory must be absolute');
const scales = requestedScale ? [requestedScale] : ['1', '1.25', '1.5', '1.75', '2'];
assert.ok(scales.every((scale) => ['1', '1.25', '1.5', '1.75', '2'].includes(scale)));
if (process.argv.includes('--list')) {
  console.log(JSON.stringify({ scales, names, models: needsModels(names) }));
  process.exit(0);
}
const releaseDesktop = holdDesktopAwake();
try {
  const models = needsModels(names) ? await prepareModelFixtures() : null;
  for (const scale of scales) {
    for (const name of names) {
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
          ...(screenshots
            ? [
                '--screenshots=' +
                  path.join(
                    screenshots,
                    scale,
                    name === 'account-usage-overview' ? 'voxcue-usage-matrix-' + name : name,
                  ),
              ]
            : []),
        ],
        {
          cwd: workspace.platformRoot,
          env: {
            ...process.env,
            VOXCUE_TEST_SCALE_FACTOR: scale,
            ...(models
              ? {
                  VOXCUE_TEST_SPEECH_MODELS: models.speechModels,
                  VOXCUE_TEST_RAG_MODEL: models.ragModel,
                  VOXCUE_SPEECH_FIXTURE_DIR: models.speechFixtures,
                }
              : {}),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));
      const desktopGuard = watchTestDesktop(child, requireUnlockedDesktop);
      const timer = setTimeout(() => {
        desktopGuard.release();
        child.kill('SIGTERM');
      }, 180000);
      const code = await new Promise((resolve) => {
        child.once('exit', resolve);
        child.once('error', (error) => {
          output += error.stack + '\n';
          resolve(null);
        });
      }).finally(() => {
        clearTimeout(timer);
        desktopGuard.release();
      });
      if (desktopGuard.failure) throw desktopGuard.failure;
      const outcome = { scope: 'shared-macos', scale, name, passed: code === 0 };
      outcomes.push(outcome);
      console.log((outcome.passed ? 'PASS ' : 'FAIL ') + JSON.stringify(outcome));
      if (!outcome.passed) console.error(output);
    }
  }
} finally {
  releaseDesktop();
}
console.log(
  JSON.stringify({ passed: outcomes.filter((item) => item.passed).length, total: outcomes.length }),
);
if (outcomes.some((item) => !item.passed)) process.exitCode = 1;
