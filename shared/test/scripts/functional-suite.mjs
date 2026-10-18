import path from 'node:path';
import workspace from '../../scripts/workspace.mjs';
import { spawnTestProcess } from './test-workspace.mjs';
import { prepareModelFixtures } from './model-fixtures.mjs';

const shared = [
  'login',
  'login-entry',
  'electron',
  'settings',
  'composer',
  'conversations',
  'conversation-status',
  'chat-response',
  'chat-progress',
  'chat-lifecycle',
  'profile-ui',
  'knowledge',
  'rag-ui',
  'rag-core',
  'history-branding',
  'provider-ui',
  'floating',
  'interview-screenshot',
  'delete-controls',
  'ui-alignment',
  'ui-ux',
  'typography',
  'updates',
  'updates-sidebar',
  'components-ui',
  'adversarial',
  'interview-stability',
  'audio-pipeline',
];
const mac = [
  'window-native',
  'screen-permission',
  'icons',
  'launcher',
  'native-build',
  'user-data',
  'updates-native',
  'components',
];
const selected = process.argv.slice(2);
const names = selected.length
  ? selected
  : [...shared, ...(process.platform === 'darwin' ? mac : [])];
for (const name of names)
  if (!shared.includes(name) && !(process.platform === 'darwin' && mac.includes(name)))
    throw Error('Unknown or unavailable suite: ' + name);
const outcomes = [];
const models = await prepareModelFixtures();
const modelEnvironment = {
  VOXCUE_TEST_SPEECH_MODELS: models.speechModels,
  VOXCUE_TEST_RAG_MODEL: models.ragModel,
  VOXCUE_SPEECH_FIXTURE_DIR: models.speechFixtures,
};
for (const name of names) {
  const directory = shared.includes(name)
    ? path.join(workspace.sharedRoot, 'test/scripts')
    : process.platform === 'darwin' && mac.includes(name)
      ? path.join(workspace.platformRoot, 'test/scripts')
      : undefined;
  if (!directory) throw Error('Unknown or unavailable suite: ' + name);
  const started = performance.now();
  const child = spawnTestProcess(process.execPath, [path.join(directory, name + '-smoke.mjs')], {
    cwd: workspace.platformRoot,
    env: { ...process.env, ...modelEnvironment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  const timer = setTimeout(() => child.kill('SIGTERM'), name === 'components' ? 600000 : 240000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  const outcome = { name, passed: code === 0, ms: Math.round(performance.now() - started) };
  outcomes.push(outcome);
  console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${name} (${outcome.ms}ms)`);
  if (!outcome.passed) console.error(output);
}
console.log(
  JSON.stringify({
    passed: outcomes.filter((item) => item.passed).length,
    total: outcomes.length,
    outcomes,
  }),
);
if (outcomes.some((item) => !item.passed)) process.exitCode = 1;
