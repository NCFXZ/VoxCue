import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required');
const root = workspace.platformRoot;
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr || `${command} failed`);
  return result.stdout;
};
const common = ['clang++', '-std=c++17', '-arch', 'arm64', '-mmacosx-version-min=14.2', '-O2'];
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
  'Core Audio, screen-permission binding and launcher compiled/verified in temporary storage; running production binaries were not overwritten.',
);
