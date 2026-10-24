import path from 'node:path';
import { existsSync } from 'node:fs';
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
  'login-controls',
  'sidebar-updates',
  'content-controls',
  'component-controls',
  'progress-controls',
  'interview-glass',
  'image-save-hit',
  'audio-synthetic',
  'echo-cancellation',
  'credential-upgrade',
  'development-signing',
  'app-icon',
  'package',
];
// These shared fixtures explicitly support the actual Mac renderer/projection.
const nativeShared = [
  'composer-resize',
  'copilot-login',
  'chatgpt-single-login',
  'interview-screenshot',
];
const commonLogic = [
  'copilot-runtime',
  'chatgpt-usage-runtime',
  'rag-core',
  'knowledge-host',
  'audio-pipeline',
];
const nativeUI = [
  'login-controls',
  'sidebar-updates',
  'sidebar-glass',
  'component-controls',
  'interview-glass',
];
const nativeBinding = path.join(workspace.platformRoot, 'native/bin/VoxCue.SidebarGlass.node');
const liquidGlassAvailable =
  process.platform === 'darwin' &&
  existsSync(nativeBinding) &&
  workspace.platformRequire(nativeBinding).available === true;
if (process.platform === 'darwin')
  assert.ok(liquidGlassAvailable, 'Mac testing requires macOS 26+ and the Liquid Glass binding.');
const selected = process.argv.slice(2);
const names = selected.length
  ? selected
  : [
      ...(process.platform === 'darwin' ? nativeUI : []),
      ...(process.platform === 'darwin' ? [...commonLogic, ...nativeShared] : shared),
      ...(process.platform === 'darwin'
        ? mac.filter(
            (name) => !nativeUI.includes(name) && !['content-controls', 'package'].includes(name),
          )
        : []),
    ];
for (const name of names)
  if (
    !shared.includes(name) &&
    !(process.platform === 'darwin' && nativeShared.includes(name)) &&
    !(process.platform === 'darwin' && mac.includes(name))
  )
    throw Error('Unknown or unavailable suite: ' + name);
  else if (!liquidGlassAvailable && [...nativeUI, 'content-controls'].includes(name))
    throw Error('This suite requires actual macOS Liquid Glass: ' + name);
if (process.platform === 'darwin') {
  for (const name of names)
    if (shared.includes(name) && !commonLogic.includes(name) && !nativeShared.includes(name))
      throw Error('Windows web UI suites must run on Windows; use the Mac native suite: ' + name);
  assert.ok(!process.env.VOXCUE_TEST_WEB_RENDERER, 'Mac tests require the actual native renderer');
  console.log('Mac UI scope: actual AppKit/Liquid Glass only; Windows UI runs on Windows.');
  if (!selected.length)
    console.log(
      'Source validation: temporary packaged-app coverage; final release artifacts require explicit package suite.',
    );
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
    const directory =
      shared.includes(name) || nativeShared.includes(name)
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
          [
            'content-controls',
            'component-controls',
            'progress-controls',
            'login-controls',
            'sidebar-updates',
          ].includes(name)
            ? 'sidebar-glass-smoke.mjs'
            : name === 'image-save-hit'
              ? 'image-save-hit-check.mjs'
              : name + '-smoke.mjs',
        ),
        ...(name === 'login-controls'
          ? ['--login-only']
          : name === 'sidebar-updates'
            ? ['--updates-only']
            : name === 'content-controls'
              ? ['--content-only']
              : name === 'component-controls'
                ? ['--components-only']
                : name === 'progress-controls'
                  ? ['--progress-only']
                  : []),
      ],
      {
        cwd: workspace.platformRoot,
        env: {
          ...process.env,
          ...modelEnvironment,
          ...(process.platform === 'darwin' ? { VOXCUE_TEST_WEB_RENDERER: '' } : {}),
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
