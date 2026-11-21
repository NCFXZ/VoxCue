import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, copyFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { localizeUsageDescriptions } from '../../scripts/localize-usage-descriptions.mjs';
import { assertLocalizedPermissions } from './assert-localized-permissions.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required');
const root = workspace.platformRoot;
const localizedBundle = path.join(testRoot, 'PermissionLocalization.app');
await mkdir(path.join(localizedBundle, 'Contents/Resources'), { recursive: true });
const runtimeContents = path.join(root, '.tools/electron-dev/Electron.app/Contents');
await copyFile(
  path.join(runtimeContents, 'Info.plist'),
  path.join(localizedBundle, 'Contents/Info.plist'),
);
for (const locale of await readdir(path.join(runtimeContents, 'Resources'))) {
  if (locale.endsWith('.lproj'))
    await mkdir(path.join(localizedBundle, 'Contents/Resources', locale));
}
await localizeUsageDescriptions(localizedBundle);
await assertLocalizedPermissions(localizedBundle);
const qwen = path.join(root, 'native/bin/qwen');
const qwenFiles = JSON.parse(readFileSync(path.join(qwen, 'build.json'), 'utf8')).files;
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr || `${command} failed`);
  return result.stdout;
};
const common = ['clang++', '-std=c++17', '-arch', 'arm64', '-mmacosx-version-min=14.2', '-O2'];
for (const file of Object.keys(qwenFiles).filter(
  (file) => file === 'voxcue-qwen' || file.endsWith('.dylib'),
)) {
  const output = run('/usr/bin/otool', ['-l', path.join(qwen, file)]);
  const version = output.match(/\bminos (\d+)\.(\d+)/);
  assert.ok(
    version && (Number(version[1]) < 14 || (Number(version[1]) === 14 && Number(version[2]) <= 2)),
    'The pinned Qwen runtime deployment baseline remains unchanged: ' + file,
  );
}
// Verify the pinned runtime executables/bindings as well as our own deployment flags.
// This reads Mach-O metadata only and never starts an account or captures hardware.
const runtimeFiles = [
  'electron/dist/Electron.app/Contents/MacOS/Electron',
  'electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework',
  '@github/copilot-sdk-darwin-arm64/prebuilds/darwin-arm64/copilot-runtime',
  '@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
  '@lancedb/lancedb-darwin-arm64/lancedb.darwin-arm64.node',
  'sherpa-onnx-darwin-arm64/sherpa-onnx.node',
  'sherpa-onnx-darwin-arm64/libonnxruntime.dylib',
  'onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node',
  'onnxruntime-node/bin/napi-v6/darwin/arm64/libonnxruntime.1.dylib',
];
for (const file of runtimeFiles) {
  const output = run('/usr/bin/otool', [
    '-arch',
    'arm64',
    '-l',
    path.join(root, 'node_modules', file),
  ]);
  const minimum = output.match(/\bminos (\d+)\.(\d+)/);
  assert.ok(
    minimum && (Number(minimum[1]) < 14 || (Number(minimum[1]) === 14 && Number(minimum[2]) <= 2)),
    'Pinned runtime exceeds macOS 14.2: ' + file,
  );
}
console.log(
  'PASS: Electron, Copilot, Codex, LanceDB, Sherpa and ONNX Mach-O targets support the 14.2 deployment floor.',
);
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
const clock = path.join(testRoot, 'VoxCue.AudioClock.node');
run('/usr/bin/xcrun', [...common, '-DNAPI_VERSION=8', '-bundle', '-undefined', 'dynamic_lookup',
  '-I', path.join(root, '.cache/node-api-headers'), 'native/AudioClock.cpp', '-framework', 'CoreAudio', '-o', clock]);
for (const file of [audio, binding, clock]) {
  assert.match(run('/usr/bin/otool', ['-l', file]), /\bminos 14\.2\b/);
  run('/usr/bin/codesign', ['--force', '--sign', '-', file]);
  run('/usr/bin/codesign', ['--verify', '--strict', file]);
  if (!run('/usr/bin/file', [file]).includes('arm64'))
    throw Error('Unexpected native architecture');
}
// Bracket the binding with the kernel's sleep-excluding clock, without starting a capture.
const uptime = () => Number(run('/usr/bin/python3', ['-c',
  'import time; print(time.clock_gettime_ns(time.CLOCK_UPTIME_RAW) / 1e6)']));
const before = uptime();
const boundary = Number(run(workspace.platformRequire('electron'), ['-e', `console.log(require(${JSON.stringify(clock)})())`],
  { ...process.env, ELECTRON_RUN_AS_NODE: '1' }));
assert.ok(before <= boundary && boundary <= uptime(), 'Unmute must use the Core Audio host clock');
const code = `const binding=require(${JSON.stringify(binding)});if(typeof binding.preflight()!=='boolean')throw Error('Invalid Node-API response');console.log('Node-API 8 preflight ABI loaded; no permission request or pixel capture');`;
console.log(
  run(workspace.platformRequire('electron'), ['-e', code], {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  }).trim(),
);
console.log(
  'Core Audio and screen-permission binding compiled/verified in temporary storage; running production binaries were not overwritten.',
);
