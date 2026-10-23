import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required');
const root = workspace.platformRoot;
const qwen = path.join(root, 'native/bin/qwen');
const qwenFiles = JSON.parse(readFileSync(path.join(qwen, 'build.json'), 'utf8')).files;
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr || `${command} failed`);
  return result.stdout;
};
const common = ['clang++', '-std=c++17', '-arch', 'arm64', '-mmacosx-version-min=14.2', '-O2'];
const glassBinding = path.join(root, 'native/bin/VoxCue.SidebarGlass.node');
assert.match(run('/usr/bin/otool', ['-l', glassBinding]), /\bminos 14\.2\b/);
assert.match(
  run('/usr/bin/nm', ['-m', glassBinding]),
  /weak external _OBJC_CLASS_\$_NSGlassEffectView/,
  'Older macOS must be able to load the binding before choosing the shared fallback',
);
for (const file of Object.keys(qwenFiles).filter(
  (file) => file === 'voxcue-qwen' || file.endsWith('.dylib'),
)) {
  const output = run('/usr/bin/otool', ['-l', path.join(qwen, file)]);
  const version = output.match(/\bminos (\d+)\.(\d+)/);
  assert.ok(
    version && (Number(version[1]) < 14 || (Number(version[1]) === 14 && Number(version[2]) <= 2)),
    'Qwen must not raise the application macOS 14.2 minimum: ' + file,
  );
}
const audio = path.join(testRoot, 'VoxCue.Audio');
run('/usr/bin/xcrun', [
  ...common,
  '-fobjc-arc',
  'native/AudioCapture.mm',
  '-framework',
  'Foundation',
  '-framework',
  'AVFoundation',
  '-framework',
  'CoreAudio',
  '-Wl,-sectcreate,__TEXT,__info_plist,' + path.join(root, 'native/Info.plist'),
  '-o',
  audio,
]);
const binding = path.join(testRoot, 'VoxCue.ScreenPermission.node');
run('/usr/bin/xcrun', [
  ...common,
  '-DNAPI_VERSION=8',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-I',
  path.join(root, '.cache/node-api-headers'),
  'native/ScreenPermission.mm',
  '-framework',
  'CoreGraphics',
  '-o',
  binding,
]);
const launcher = path.join(testRoot, 'VoxCue');
run('/usr/bin/xcrun', [
  ...common,
  '-fobjc-arc',
  'native/Launcher.mm',
  '-framework',
  'AppKit',
  '-o',
  launcher,
]);
for (const file of [audio, binding, launcher]) {
  run('/usr/bin/codesign', ['--force', '--sign', '-', file]);
  run('/usr/bin/codesign', ['--verify', '--strict', file]);
  if (!run('/usr/bin/file', [file]).includes('arm64'))
    throw Error('Unexpected native architecture');
}
const code = `const binding=require(${JSON.stringify(binding)});if(typeof binding.preflight()!=='boolean')throw Error('Invalid Node-API response');console.log('Node-API 8 preflight ABI loaded; no permission request or pixel capture');`;
console.log(
  run(workspace.platformRequire('electron'), ['-e', code], {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  }).trim(),
);
console.log(
  run(
    workspace.platformRequire('electron'),
    [
      '-e',
      `
const binding=require(${JSON.stringify(path.join(root, 'native/bin/VoxCue.SidebarGlass.node'))});
const names=['apply','configureButton','popUpMenu','configureScrollChrome','detachSurface','attachSurface','configureContentControls','configureInterviewMaterials','configureInterviewAppearance'];
if(names.some(name=>typeof binding[name]!=='function') || typeof binding.available!=='boolean' || 'configureSwitch' in binding)
  throw Error('Invalid native presentation ABI');
console.log('Liquid Glass Node-API exports loaded; removed switch is absent');
`,
    ],
    { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  ).trim(),
);
console.log(
  'Core Audio, screen-permission binding and launcher compiled/verified in temporary storage; running production binaries were not overwritten.',
);
