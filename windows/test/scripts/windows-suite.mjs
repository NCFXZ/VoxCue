import assert from 'node:assert/strict';
import { prepareModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { probe } from './window-probe.mjs';

assert.equal(process.platform, 'win32');
const requireDesktop = () =>
  assert.equal(
    probe('desktop').interactive,
    true,
    'Windows GUI matrix requires an unlocked input desktop',
  );
const suites = process.argv.slice(2),
  windowsOnly = suites[0] === '--windows';
if (suites[0] === '--dpi') {
  const allowed = [
    'ui-refinement',
    'ui-alignment',
    'typography',
    'interview-typography',
    'interview-ux',
    'components-ui',
    'updates-sidebar',
  ];
  const scales = ['1', '1.25', '1.5', '1.75', '2'];
  const scaleOptions = suites.slice(1).filter((arg) => arg.startsWith('--scale='));
  assert.ok(scaleOptions.length <= 1, 'Use one --scale=<DPI factor>');
  const requestedScale = scaleOptions[0]?.slice(8);
  assert.ok(!scaleOptions.length || scales.includes(requestedScale), 'Unknown DPI scale');
  const names = suites.slice(1).filter((arg) => !arg.startsWith('--scale='));
  const selected = names.length ? names : allowed;
  for (const name of selected) assert.ok(allowed.includes(name), 'Unknown DPI suite: ' + name);
  const models = await prepareModelFixtures();
  for (const scale of requestedScale ? [requestedScale] : scales) {
    for (const name of selected) {
      requireDesktop();
      const child = spawnTestProcess(
        process.execPath,
        ['../shared/test/scripts/' + name + '-smoke.mjs'],
        {
          env: {
            ...process.env,
            VOXCUE_TEST_SCALE_FACTOR: scale,
            VOXCUE_TEST_SPEECH_MODELS: models.speechModels,
            VOXCUE_TEST_RAG_MODEL: models.ragModel,
            VOXCUE_SPEECH_FIXTURE_DIR: models.speechFixtures,
          },
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
const nativeNames = [
  'platform-native',
  'interview-access',
  'interview-effort',
  'interview-layout',
  'interview-workflow',
  'interview-context',
  'updates-native',
  'user-data',
  'speech-adversarial',
  'echo-cancellation',
  'wasapi-packets',
  'electron-output',
  'components-native',
  'presentation-native',
  'rag-core',
];
const selectedNative = windowsOnly && suites.length > 1 ? suites.slice(1) : nativeNames;
if (windowsOnly)
  for (const name of selectedNative)
    assert.ok(nativeNames.includes(name), 'Unknown native suite: ' + name);
const commands = windowsOnly
  ? selectedNative.map((name) => [
      name === 'rag-core'
        ? '../shared/test/scripts/rag-core-smoke.mjs'
        : 'test/scripts/' + name + '-smoke.mjs',
    ])
  : [['../shared/test/scripts/functional-suite.mjs', ...suites]];
const models = windowsOnly ? await prepareModelFixtures() : null;
let failed = false;
for (const args of commands) {
  requireDesktop();
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
