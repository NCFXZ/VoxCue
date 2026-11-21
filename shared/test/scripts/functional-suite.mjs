import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { spawnTestProcess } from './test-workspace.mjs';
import { prepareModelFixtures } from './model-fixtures.mjs';
import assert from 'node:assert/strict';
import { executionBatches, needsModels, parallelSuites } from './suite-policy.mjs';
import { watchTestDesktop } from './desktop-guard.mjs';

const shared = [
  'web-materials',
  'ui-material-refinement',
  'login',
  'password-policy',
  'account-erasure',
  'account-transfer',
  'legacy-profile-upgrade',
  'quit-drain',
  'copilot-login',
  'copilot-runtime',
  'chatgpt-single-login',
  'chatgpt-usage-runtime',
  'login-entry',
  'local-mode',
  'client-update-ui',
  'telemetry',
  'telemetry-v2-http',
  'electron',
  'settings',
  'shortcut-settings',
  'language',
  'preparation-guide',
  'composer',
  'composer-resize',
  'conversations',
  'conversation-status',
  'chat-response',
  'chat-progress',
  'shimmer',
  'chat-lifecycle',
  'profile-ui',
  'profile-selection',
  'knowledge',
  'rag-ui',
  'rag-core',
  'knowledge-host',
  'utility-retirement',
  'history-branding',
  'history-scroll',
  'provider-ui',
  'api-interactive-preview',
  'recording',
  'floating',
  'interview-badge-layout',
  'interview-shortcuts',
  'mobile-bundle',
  'mobile-ui',
  'interview-typography',
  'interview-chrome',
  'interview-motion',
  'interview-ux',
  'interview-usage',
  'interview-screenshot',
  'interview-retry',
  'delete-controls',
  'ui-alignment',
  'ui-refinement',
  'ui-ux',
  'typography',
  'updates',
  'updates-sidebar',
  'components-ui',
  'adversarial',
  'cloud-account',
  ...(process.platform === 'win32' ? ['sync-conflict-workspace'] : []),
  'cloud-protocol',
  'free-service',
  'account-usage-overview',
  'management-scrollbars',
  'server-connection',
  'interview-stability',
  'audio-pipeline',
  'speech-soak',
];
const mac = [
  'account-archive-lifecycle',
  'login-actions-native',
  'interview-layout',
  'interview-effort',
  'chatgpt-renewal',
  'icons',
  'window-native',
  'screen-permission',
  'launcher',
  'native-build',
  'user-data',
  'telemetry-queue-native',
  'updates-native',
  'components',
  'dmg',
  'audio-synthetic',
  'echo-cancellation',
  'credential-upgrade',
  'development-signing',
  'app-icon',
  'package',
];
const options = process.argv.slice(2);
const jobOptions = options.filter((value) => value.startsWith('--jobs='));
assert.ok(jobOptions.length <= 1, 'Use one --jobs=<1|2|3>');
const selected = options.filter((value) => value !== '--list' && !value.startsWith('--jobs='));
const names = selected.length
  ? selected
  : [...shared, ...(process.platform === 'darwin' ? mac.filter((name) => !['package', 'components'].includes(name)) : [])];
for (const name of names)
  if (!shared.includes(name) && !(process.platform === 'darwin' && mac.includes(name)))
    throw Error('Unknown or unavailable suite: ' + name);
const batches = executionBatches(names, jobOptions.length ? Number(jobOptions[0].slice(7)) : 2);
if (options.includes('--list')) {
  console.log(JSON.stringify({ names, batches, models: needsModels(names) }));
} else {
  console.log(
    'Testing every selected suite; isolated Node protocol checks may run in parallel; GUI/native/inference/soak stay serial.',
  );
  const headless = new Set([
    'telemetry-v2-http',
    'speech-soak',
    'audio-pipeline',
    'cloud-protocol',
    'server-connection',
    'copilot-runtime',
    'chatgpt-usage-runtime',
    'chatgpt-renewal',
    'native-build',
    'audio-synthetic',
    'echo-cancellation',
    'credential-upgrade',
    'development-signing',
    'app-icon',
  ]);
  const desktop =
    process.platform === 'darwin' && !names.every((name) => headless.has(name))
      ? await import(
          pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/desktop-session.mjs')).href
        )
      : undefined;
  const releaseDesktop = desktop?.holdDesktopAwake();
  const outcomes = [];
  const models = needsModels(names) ? await prepareModelFixtures() : null;
  const windowsDesktop =
    process.platform === 'win32' && names.some((name) => !parallelSuites.has(name))
      ? await import(
          pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/window-probe.mjs')).href
        )
      : undefined;
  let desktopFailure;
  function requireDesktop() {
    if (desktopFailure) throw desktopFailure;
    try {
      desktop?.requireUnlockedDesktop();
      if (windowsDesktop)
        assert.equal(
          windowsDesktop.probe('desktop').interactive,
          true,
          'Shared GUI/native matrix requires an unlocked input desktop',
        );
    } catch (error) {
      desktopFailure = error;
      throw error;
    }
  }
  const modelEnvironment = models
    ? {
        VOXCUE_TEST_SPEECH_MODELS: models.speechModels,
        VOXCUE_TEST_RAG_MODEL: models.ragModel,
        VOXCUE_SPEECH_FIXTURE_DIR: models.speechFixtures,
      }
    : {};
  const cursor = windowsDesktop?.probe('cursor');
  let interruption;
  try {
    const run = async (name) => {
      if (!parallelSuites.has(name)) {
        requireDesktop();
        await windowsDesktop?.parkMatrixCursor();
      }
      const directory = shared.includes(name)
        ? path.join(workspace.sharedRoot, 'test/scripts')
        : process.platform === 'darwin' && mac.includes(name)
          ? path.join(workspace.platformRoot, 'test/scripts')
          : undefined;
      if (!directory) throw Error('Unknown or unavailable suite: ' + name);
      const started = performance.now();
      const child = spawnTestProcess(
        process.execPath,
        name === 'speech-soak'
          ? [
              path.join(directory, 'run-electron-node.mjs'),
              path.join(directory, 'speech-soak.mjs'),
              '--seconds=600',
            ]
          : name === 'management-scrollbars'
            ? [path.join(directory, 'cloud-account-smoke.mjs'), '--scrollbars']
            : name === 'api-interactive-preview'
              ? [path.join(directory, 'api-interactive-preview.mjs'), '--check-only']
            : [path.join(directory, name + '-smoke.mjs')],
        {
          cwd: workspace.platformRoot,
          env: {
            ...process.env,
            ...modelEnvironment,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      let progress = '';
      child.stdout.on('data', (data) => {
        output += data;
        const lines = (progress + data).split('\n');
        progress = lines.pop();
        for (const line of lines)
          if (
            /^Interview cycle \d+\/20 passed$/.test(line) ||
            line.startsWith('Speech soak progress ')
          )
            console.log('  ' + line);
      });
      child.stderr.on('data', (data) => (output += data));
      const desktopGuard =
        !parallelSuites.has(name) && (desktop || windowsDesktop)
          ? watchTestDesktop(child, requireDesktop)
          : undefined;
      const timer = setTimeout(
        () => {
          desktopGuard?.release();
          child.kill('SIGTERM');
        },
        name === 'speech-soak' ? 900000 : name === 'components' ? 600000 : 240000,
      );
      const code = await new Promise((resolve) => {
        child.once('error', (error) => {
          output += error.stack + '\n';
          resolve(null);
        });
        child.once('exit', resolve);
      }).finally(() => {
        clearTimeout(timer);
        desktopGuard?.release();
      });
      if (desktopGuard?.failure) throw desktopGuard.failure;
      const outcome = { name, passed: code === 0, ms: Math.round(performance.now() - started) };
      outcomes.push(outcome);
      console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${name} (${outcome.ms}ms)`);
      if (!outcome.passed) console.error(output);
      else if (name === 'speech-soak') console.log(output.slice(output.lastIndexOf('\n{')).trim());
    };
    for (const batch of batches) {
      // Settle every member before moving to an exclusive suite, even on a spawn failure.
      const settled = await Promise.allSettled(batch.map(run));
      const failed = settled.find((value) => value.status === 'rejected');
      if (failed) throw failed.reason;
    }
  } catch (error) {
    interruption = error;
    console.error('Shared matrix interrupted:', error);
    throw error;
  } finally {
    releaseDesktop?.();
    if (cursor && !interruption && !desktopFailure) {
      requireDesktop();
      windowsDesktop.restoreParkedMatrixCursor(cursor);
    }
  }
  console.log(
    JSON.stringify({
      passed: outcomes.filter((item) => item.passed).length,
      total: outcomes.length,
      outcomes,
    }),
  );
  if (outcomes.some((item) => !item.passed)) process.exitCode = 1;
}
