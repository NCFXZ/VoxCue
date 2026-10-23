import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { spawnTestProcess } from './test-workspace.mjs';
import { prepareModelFixtures } from './model-fixtures.mjs';
import assert from 'node:assert/strict';
import { testRoot } from './test-workspace.mjs';

const shared = [
  'web-materials',
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
  'profile-selection',
  'knowledge',
  'rag-ui',
  'rag-core',
  'knowledge-host',
  'history-branding',
  'provider-ui',
  'floating',
  'interview-typography',
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
  'dmg',
  'sidebar-glass',
  'content-controls',
  'component-controls',
  'interview-glass',
  'audio-synthetic',
  'echo-cancellation',
  'credential-upgrade',
  'development-signing',
  'app-icon',
];
const nativeUI = ['sidebar-glass', 'component-controls', 'interview-glass'];
const nativeBinding = path.join(workspace.platformRoot, 'native/bin/VoxCue.SidebarGlass.node');
const liquidGlassAvailable =
  process.platform === 'darwin' &&
  existsSync(nativeBinding) &&
  workspace.platformRequire(nativeBinding).available === true;
const selected = process.argv.slice(2);
const names = selected.length
  ? selected
  : [
      ...(liquidGlassAvailable ? nativeUI : []),
      ...shared,
      ...(process.platform === 'darwin'
        ? mac.filter((name) => !nativeUI.includes(name) && name !== 'content-controls')
        : []),
    ];
for (const name of names)
  if (!shared.includes(name) && !(process.platform === 'darwin' && mac.includes(name)))
    throw Error('Unknown or unavailable suite: ' + name);
  else if (!liquidGlassAvailable && [...nativeUI, 'content-controls'].includes(name))
    throw Error('This suite requires actual macOS Liquid Glass: ' + name);
if (process.platform === 'darwin' && !liquidGlassAvailable)
  console.log('Liquid Glass unavailable: exercising shared fallback and other Mac capabilities.');
// Shared DOM/business tests exercise the real web fallback bundle. AppKit
// controls/menus/projections have their own native matrix, with real tracking.
let webRenderer;
if (process.platform === 'darwin' && names.some((name) => shared.includes(name))) {
  const config = (
    await import(pathToFileURL(path.join(workspace.sharedRoot, 'vite.config.mjs')).href)
  ).default;
  const { build } = await import(pathToFileURL(workspace.platformRequire.resolve('vite')).href);
  webRenderer = path.join(testRoot, 'web-renderer/dist/index.html');
  await build({
    ...config,
    configFile: false,
    plugins: [
      ...config.plugins.filter((plugin) => !plugin.name?.startsWith('macos-')),
      {
        name: 'shared-fallback-boundary',
        generateBundle() {
          const modules = [...this.getModuleIds()];
          assert.ok(
            !modules.some((file) =>
              file.startsWith(path.join(workspace.platformRoot, 'src') + path.sep),
            ),
            'Mac controls must not enter the shared fallback',
          );
          for (const port of ['appearance-control', 'material-button', 'material-surface'])
            assert.ok(
              modules.includes(path.join(workspace.sharedRoot, 'src/components/ui', port + '.tsx')),
              'Shared fallback port missing: ' + port,
            );
        },
      },
    ],
    build: { ...config.build, outDir: path.dirname(webRenderer), assetsInlineLimit: 4096 },
    logLevel: 'error',
  });
  console.log('Shared UI scope: actual web fallback renderer; AppKit scope runs separately.');
}
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
for (const name of names) {
  if (desktopProbe)
    assert.equal(
      desktopProbe('desktop').interactive,
      true,
      'Shared GUI matrix requires an unlocked input desktop',
    );
  const directory = shared.includes(name)
    ? path.join(workspace.sharedRoot, 'test/scripts')
    : process.platform === 'darwin' && mac.includes(name)
      ? path.join(workspace.platformRoot, 'test/scripts')
      : undefined;
  if (!directory) throw Error('Unknown or unavailable suite: ' + name);
  const started = performance.now();
  const child = spawnTestProcess(
    process.execPath,
    [
      path.join(
        directory,
        ['content-controls', 'component-controls'].includes(name)
          ? 'sidebar-glass-smoke.mjs'
          : name + '-smoke.mjs',
      ),
      ...(name === 'content-controls'
        ? ['--content-only']
        : name === 'component-controls'
          ? ['--components-only']
          : []),
    ],
    {
      cwd: workspace.platformRoot,
      env: {
        ...process.env,
        ...modelEnvironment,
        ...(shared.includes(name) && webRenderer ? { VOXCUE_TEST_WEB_RENDERER: webRenderer } : {}),
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
    ['components', 'content-controls'].includes(name) ? 600000 : 240000,
  );
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
