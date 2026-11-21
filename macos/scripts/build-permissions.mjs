import workspace from '../../shared/scripts/workspace.mjs';
import { mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required.');
const root = workspace.platformRoot;
const headers = path.join(root, '.cache/node-api-headers');
await mkdir(headers, { recursive: true });
await mkdir(path.join(root, 'native/bin'), { recursive: true });
const installedHeaders = path.resolve(path.dirname(process.execPath), '../include/node');
for (const name of ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h'])
  await copyFile(path.join(installedHeaders, name), path.join(headers, name));
for (const [name, framework, identifier] of [
  ['ScreenPermission', 'CoreGraphics', 'screen-permission'],
  ['SecureInput', 'AppKit', 'secure-input'],
]) {
  const output = path.join(root, 'native/bin/VoxCue.' + name + '.node');
  for (const [command, args] of [
    ['/usr/bin/xcrun', ['clang++', '-fobjc-arc', '-std=c++17', '-DNAPI_VERSION=8', '-bundle',
      '-undefined', 'dynamic_lookup', '-arch', 'arm64', '-mmacosx-version-min=14.2', '-O2',
      '-I', headers, path.join(root, 'native', name + '.mm'), '-framework', framework, '-o', output]],
    ['/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'com.voxcue.' + identifier, output]],
  ]) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(command + ' failed (' + result.status + ').');
  }
}
console.log('Built arm64 screen permission and AppKit secure input bindings.');
