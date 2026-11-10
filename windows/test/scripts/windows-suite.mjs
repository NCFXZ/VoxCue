import assert from 'node:assert/strict';
import { prepareModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { probe, holdDesktopAwake } from './window-probe.mjs';
import { needsModels } from '../../../shared/test/scripts/suite-policy.mjs';
import { watchTestDesktop } from '../../../shared/test/scripts/desktop-guard.mjs';

assert.equal(process.platform, 'win32');
let desktopFailure;
function requireDesktop() {
  if (desktopFailure) throw desktopFailure;
  try {
    assert.equal(
      probe('desktop').interactive,
      true,
      'Windows GUI/native matrix requires an unlocked input desktop',
    );
  } catch (error) {
    desktopFailure = error;
    throw error;
  }
}
function restoreCursor(cursor, interruption) {
  if (!cursor || desktopFailure) return;
  try {
    requireDesktop();
    probe('move', cursor.x, cursor.y);
  } catch (error) {
    console.error('Windows matrix cursor restoration stopped:', error);
    if (!interruption) throw error;
  }
}
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
    'updates',
    'client-update-ui',
    'shimmer',
    'knowledge',
    'local-mode',
    'telemetry',
    'settings',
    'shortcut-settings',
    'interview-badge-layout',
    'interview-shortcuts',
    'mobile-ui',
    'conversations',
    'language',
    'preparation-guide',
    'profile-ui',
    'history-branding',
    'history-scroll',
    'free-service',
    'account-usage-overview',
    'account-erasure',
    'login',
    'chat-progress',
    'chat-response',
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
  const releaseDesktopAwake = await holdDesktopAwake();
  let interruption;
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
        const desktopGuard = watchTestDesktop(child, requireDesktop);
        const timer = setTimeout(() => {
          desktopGuard.release();
          child.kill();
        }, 180000);
        const code = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        })
          .catch((error) => {
            throw desktopGuard.failure ?? error;
          })
          .finally(() => {
            clearTimeout(timer);
            desktopGuard.release();
          });
        if (desktopGuard.failure) throw desktopGuard.failure;
        if (code !== 0) console.error(output);
        if (code !== 0) failures.push({ scale, name });
        console.log((code === 0 ? 'PASS DPI ' : 'FAIL DPI ') + scale + ' ' + name);
      }
    }
  } catch (error) {
    interruption = error;
    // Cursor restoration can also fail if the desktop changed. Keep the cause
    // that stopped the matrix visible before attempting that cleanup.
    console.error('Windows DPI matrix interrupted:', error);
    throw error;
  } finally {
    try { restoreCursor(cursor, interruption); }
    finally { await releaseDesktopAwake(); }
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
  'speech-input-state',
  'echo-cancellation',
  'wasapi-packets',
  'electron-output',
  'components-native',
  'presentation-native',
  'rag-core',
  'screenshot-performance',
  'screenshot-monitor',
];
const selectedNative = windowsOnly && suites.length > 1 ? suites.slice(1) : nativeNames;
if (windowsOnly)
  for (const name of selectedNative)
    assert.ok(nativeNames.includes(name), 'Unknown native suite: ' + name);
const commands = windowsOnly
  ? selectedNative.flatMap((name) => {
      // Each DPI keeps the original native watchdog and every login assertion;
      // the five-scale total must not consume one child's time allowance.
      if (name === 'login-actions-native')
        return ['1', '1.25', '1.5', '1.75', '2'].map((scale) => [
          'test/scripts/login-actions-native-smoke.mjs',
          '--scale=' + scale,
        ]);
      return [
        name === 'screenshot-performance'
          ? ['../shared/test/scripts/screenshot-performance.mjs', '--native', '--platform']
          : [
              name === 'rag-core'
                ? '../shared/test/scripts/rag-core-smoke.mjs'
                : 'test/scripts/' + name + '-smoke.mjs',
            ],
      ];
    })
  : [['../shared/test/scripts/functional-suite.mjs', ...suites]];
const models = windowsOnly ? await prepareModelFixtures() : null;
let failed = false;
const nativeCursor = windowsOnly ? probe('cursor') : undefined;
const releaseDesktopAwake = await holdDesktopAwake();
let interruption;
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
    const desktopGuard = watchTestDesktop(child, requireDesktop);
    const timer = setTimeout(
      () => {
        desktopGuard.release();
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
    })
      .catch((error) => {
        throw desktopGuard.failure ?? error;
      })
      .finally(() => {
        clearTimeout(timer);
        desktopGuard.release();
      });
    if (desktopGuard.failure) throw desktopGuard.failure;
    if (windowsOnly) {
      console.log((code === 0 ? 'PASS ' : 'FAIL ') + args.join(' '));
      if (code !== 0) console.error(output);
    }
    if (code !== 0) failed = true;
  }
} catch (error) {
  interruption = error;
  console.error('Windows matrix interrupted:', error);
  throw error;
} finally {
  try { restoreCursor(nativeCursor, interruption); }
  finally { await releaseDesktopAwake(); }
}
if (failed) process.exitCode = 1;
