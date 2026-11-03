import assert from 'node:assert/strict';
import { prepareModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { probe } from './window-probe.mjs';
import { needsModels } from '../../../shared/test/scripts/suite-policy.mjs';

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
    'web-materials',
    'ui-material-refinement',
    'ui-refinement',
    'ui-alignment',
    'profile-selection',
    'typography',
    'interview-typography',
    'interview-chrome',
    'interview-motion',
    'interview-screenshot',
    'interview-retry',
    'interview-ux',
    'components-ui',
    'updates-sidebar',
    'client-update-ui',
    'shimmer',
    'knowledge',
    'local-mode',
    'telemetry',
    'settings',
    'language',
    'preparation-guide',
    'profile-ui',
    'history-branding',
    'free-service',
    'account-erasure',
    'login',
  ];
  const scales = ['1', '1.25', '1.5', '1.75', '2'];
  const scaleOptions = suites.slice(1).filter((arg) => arg.startsWith('--scale='));
  assert.ok(scaleOptions.length <= 1, 'Use one --scale=<DPI factor>');
  const requestedScale = scaleOptions[0]?.slice(8);
  assert.ok(!scaleOptions.length || scales.includes(requestedScale), 'Unknown DPI scale');
  const names = suites.slice(1).filter((arg) => !arg.startsWith('--scale='));
  const selected = names.length ? names : allowed;
  for (const name of selected) assert.ok(allowed.includes(name), 'Unknown DPI suite: ' + name);
  const models = needsModels(selected) ? await prepareModelFixtures() : null;
  const failures = [];
  const cursor = probe('cursor');
  try {
    for (const scale of requestedScale ? [requestedScale] : scales) {
      for (const name of selected) {
        requireDesktop();
        // A pending native WM_MOUSEMOVE can replace Chromium's injected hover.
        // Park the real pointer outside the controls while the isolated UI runs.
        probe('move', 0, 0);
        const child = spawnTestProcess(
          process.execPath,
          ['../shared/test/scripts/' + name + '-smoke.mjs'],
          {
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
        if (code !== 0) failures.push({ scale, name });
        console.log((code === 0 ? 'PASS DPI ' : 'FAIL DPI ') + scale + ' ' + name);
      }
    }
  } catch (error) {
    // Cursor restoration can also fail if the desktop changed. Keep the cause
    // that stopped the matrix visible before attempting that cleanup.
    console.error('Windows DPI matrix interrupted:', error);
    throw error;
  } finally {
    probe('move', cursor.x, cursor.y);
  }
  assert.deepEqual(failures, [], 'Windows DPI matrix failures');
  process.exit(0);
}
const nativeNames = [
  'platform-native',
  'login-actions-native',
  'interview-access',
  'interview-effort',
  'interview-layout',
  'interview-workflow',
  'interview-context',
  'updates-native',
  'user-data',
  'telemetry-queue-native',
  'speech-adversarial',
  'echo-cancellation',
  'wasapi-packets',
  'electron-output',
  'components-native',
  'presentation-native',
  'rag-core',
  'screenshot-performance',
];
const selectedNative = windowsOnly && suites.length > 1 ? suites.slice(1) : nativeNames;
if (windowsOnly)
  for (const name of selectedNative)
    assert.ok(nativeNames.includes(name), 'Unknown native suite: ' + name);
const commands = windowsOnly
  ? selectedNative.map((name) =>
      name === 'screenshot-performance'
        ? ['../shared/test/scripts/screenshot-performance.mjs', '--native', '--platform']
        : [
            name === 'rag-core'
              ? '../shared/test/scripts/rag-core-smoke.mjs'
              : 'test/scripts/' + name + '-smoke.mjs',
          ],
    )
  : [['../shared/test/scripts/functional-suite.mjs', ...suites]];
const models = windowsOnly ? await prepareModelFixtures() : null;
let failed = false;
const nativeCursor = windowsOnly ? probe('cursor') : undefined;
try {
  for (const args of commands) {
    requireDesktop();
    if (nativeCursor) probe('move', 0, 0);
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
    // The shared runner bounds each suite, including a 10-minute soak.
    // Its outer watchdog must allow the complete serial matrix to finish.
    const nativeLimit = args[0].endsWith('/login-actions-native-smoke.mjs') ? 360000 : 180000;
    const timer = setTimeout(
      () => {
        console.error(
          'Suite watchdog expired: ' +
            args[0] +
            ' (' +
            (windowsOnly ? nativeLimit : 4 * 60 * 60 * 1000) +
            'ms)',
        );
        child.kill();
      },
      windowsOnly ? nativeLimit : 4 * 60 * 60 * 1000,
    );
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
} finally {
  if (nativeCursor) probe('move', nativeCursor.x, nativeCursor.y);
}
if (failed) process.exitCode = 1;
