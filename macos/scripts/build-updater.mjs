import workspace from '../../shared/scripts/workspace.mjs';
import { mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { sparkleTools } from './sparkle-tools.mjs';
const root = workspace.platformRoot;
const tools = await sparkleTools();
const headers = path.join(root, '.cache/node-api-headers');
await mkdir(headers, { recursive: true });
await mkdir(path.join(root, 'native/bin'), { recursive: true });
for (const name of ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h'])
  await copyFile(
    path.resolve(path.dirname(process.execPath), '../include/node', name),
    path.join(headers, name),
  );
const output = path.join(root, 'native/bin/VoxCue.Updater.node');
for (const [command, args] of [
  [
    '/usr/bin/xcrun',
    [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-DNAPI_VERSION=8',
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-arch',
      'arm64',
      '-mmacosx-version-min=14.2',
      '-O2',
      '-I',
      headers,
      '-F',
      tools,
      '-Wl,-rpath,@loader_path/../../Frameworks',
      path.join(root, 'native/Updater.mm'),
      '-framework',
      'Sparkle',
      '-framework',
      'AppKit',
      '-o',
      output,
    ],
  ],
  ['/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'com.voxcue.updater', output]],
]) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(root, '.cache/clang') },
  });
  if (result.error || result.status)
    throw result.error ?? Error(`${command} failed (${result.status})`);
}
console.log('Built workspace-local Sparkle installer binding for macOS arm64.');
