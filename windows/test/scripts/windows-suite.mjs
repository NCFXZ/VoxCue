import assert from 'node:assert/strict';
import { prepareModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';

assert.equal(process.platform, 'win32');
const suites = process.argv.slice(2),
  windowsOnly = suites[0] === '--windows';
if (suites[0] === '--dpi') {
  const allowed = [
    'ui-refinement',
    'ui-alignment',
    'typography',
    'interview-typography',
    'components-ui',
    'updates-sidebar',
  ];
  const selected = suites.length > 1 ? suites.slice(1) : allowed;
  for (const name of selected) assert.ok(allowed.includes(name), 'Unknown DPI suite: ' + name);
  for (const scale of ['1', '1.25', '1.5', '1.75', '2']) {
    for (const name of selected) {
      const child = spawnTestProcess(
        process.execPath,
        ['../shared/test/scripts/' + name + '-smoke.mjs'],
        {
          env: { ...process.env, VOXCUE_TEST_SCALE_FACTOR: scale },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));
      const timer = setTimeout(() => child.kill(), 180000);
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      }).finally(() => clearTimeout(timer));
      if (code !== 0) console.error(output);
      assert.equal(code, 0, name + ' at DPI ' + scale);
      console.log('PASS DPI ' + scale + ' ' + name);
    }
  }
  process.exit(0);
}
const commands = windowsOnly
  ? [
      'platform-native',
      'interview-access',
      'interview-effort',
      'interview-layout',
      'interview-workflow',
      'interview-context',
      'updates-native',
      'user-data',
      'speech-adversarial',
      'presentation-native',
    ].map((name) => ['test/scripts/' + name + '-smoke.mjs'])
  : [['../shared/test/scripts/functional-suite.mjs', ...suites]];
const models = windowsOnly ? await prepareModelFixtures() : null;
let failed = false;
for (const args of commands) {
  const child = spawnTestProcess(process.execPath, args, {
    env: {
      ...process.env,
      ...(models
        ? {
            VOXCUE_TEST_SPEECH_MODELS: models.speechModels,
            VOXCUE_TEST_RAG_MODEL: models.ragModel,
            VOXCUE_SPEECH_FIXTURE_DIR: models.speechFixtures,
          }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
    if (!windowsOnly) process.stdout.write(data);
  });
  child.stderr.on('data', (data) => {
    output += data;
    if (!windowsOnly) process.stderr.write(data);
  });
  const timer = setTimeout(() => child.kill(), windowsOnly ? 180000 : 900000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  if (windowsOnly) {
    console.log((code === 0 ? 'PASS ' : 'FAIL ') + args[0]);
    if (code !== 0) console.error(output);
  }
  if (code !== 0) failed = true;
}
if (failed) process.exitCode = 1;
