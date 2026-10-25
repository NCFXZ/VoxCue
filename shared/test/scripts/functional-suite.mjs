import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { spawnTestProcess } from './test-workspace.mjs';
import { prepareModelFixtures } from './model-fixtures.mjs';
import assert from 'node:assert/strict';

const shared = [
  'web-materials',
  'ui-material-refinement',
  'login',
  'copilot-login',
  'copilot-runtime',
  'chatgpt-single-login',
  'chatgpt-usage-runtime',
  'login-entry',
  'electron',
  'settings',
  'composer',
  'composer-resize',
  'conversations',
  'conversation-status',
  'chat-response',
  'chat-progress',
  'chat-lifecycle',
  'profile-ui',
  'profile-selection',
  'knowledge',
  'rag-ui',
  'rag-core',
  'knowledge-host',
  'history-branding',
  'provider-ui',
  'floating',
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
  'interview-stability',
  'audio-pipeline',
  'speech-soak',
];
const mac = [
  'chatgpt-renewal',
  'icons',
  'window-native',
  'screen-permission',
  'launcher',
  'native-build',
  'user-data',
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
const selected = process.argv.slice(2);
const names = selected.length
  ? selected
  : [...shared, ...(process.platform === 'darwin' ? mac.filter((name) => name !== 'package') : [])];
for (const name of names)
  if (!shared.includes(name) && !(process.platform === 'darwin' && mac.includes(name)))
    throw Error('Unknown or unavailable suite: ' + name);
console.log(
  'Testing the production shared renderer and this platform’s system integration; GUI runs serially.',
);
const outcomes = [];
const models = await prepareModelFixtures();
const desktopProbe =
  process.platform === 'win32'
    ? (
        await import(
          pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/window-probe.mjs')).href
        )
      ).probe
    : undefined;
const modelEnvironment = {
  VOXCUE_TEST_SPEECH_MODELS: models.speechModels,
  VOXCUE_TEST_RAG_MODEL: models.ragModel,
  VOXCUE_SPEECH_FIXTURE_DIR: models.speechFixtures,
};
const cursor = desktopProbe?.('cursor');
try {
  for (const name of names) {
    if (desktopProbe)
      assert.equal(
        desktopProbe('desktop').interactive,
        true,
        'Shared GUI matrix requires an unlocked input desktop',
      );
    desktopProbe?.('move', 0, 0);
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
        if (/^Interview cycle \d+\/20 passed$/.test(line)) console.log('  ' + line);
    });
    child.stderr.on('data', (data) => (output += data));
    const timer = setTimeout(
      () => child.kill('SIGTERM'),
      name === 'speech-soak' ? 900000 : name === 'components' ? 600000 : 240000,
    );
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    }).finally(() => clearTimeout(timer));
    const outcome = { name, passed: code === 0, ms: Math.round(performance.now() - started) };
    outcomes.push(outcome);
    console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${name} (${outcome.ms}ms)`);
    if (!outcome.passed) console.error(output);
    else if (name === 'speech-soak') console.log(output.slice(output.lastIndexOf('\n{')).trim());
  }
} finally {
  if (desktopProbe && cursor) desktopProbe('move', cursor.x, cursor.y);
}
console.log(
  JSON.stringify({
    passed: outcomes.filter((item) => item.passed).length,
    total: outcomes.length,
    outcomes,
  }),
);
if (outcomes.some((item) => !item.passed)) process.exitCode = 1;
