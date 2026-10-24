import workspace from '../../shared/scripts/workspace.mjs';
import { mkdir, copyFile, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildSidebarGlass() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('Apple Silicon required.');
  const root = workspace.platformRoot;
  const headers = path.join(root, '.cache/node-api-headers');
  await mkdir(headers, { recursive: true });
  await mkdir(path.join(root, 'native/bin'), { recursive: true });
  const installedHeaders = path.resolve(path.dirname(process.execPath), '../include/node');
  for (const name of ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h'])
    await copyFile(path.join(installedHeaders, name), path.join(headers, name));
  const destination = path.join(root, 'native/bin/VoxCue.SidebarGlass.node');
  const staging = await mkdtemp(path.join(root, 'native/bin/.sidebar-glass-build-'));
  const output = path.join(staging, 'VoxCue.SidebarGlass.node');
  try {
    // Embed the original shared brand artwork, without another asset copy or
    // any renderer-provided path/data in the native control contract.
    for (const [file, name] of [
      ['chatgpt', 'ChatGPT'],
      ['copilot', 'Copilot'],
    ]) {
      const brand = await readFile(path.join(workspace.sharedRoot, `src/assets/${file}.svg`));
      await writeFile(
        path.join(staging, `${name}Brand.h`),
        `static const unsigned char VoxCue${name}Brand[]={${[...brand].join(',')}};\n`,
      );
    }
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
          '-mmacosx-version-min=26.0',
          '-O2',
          '-I',
          headers,
          '-I',
          staging,
          path.join(root, 'native/SidebarGlass.mm'),
          path.join(root, 'native/LiquidGlassControls.mm'),
          path.join(root, 'native/NativeMenu.mm'),
          path.join(root, 'native/ScrollChrome.mm'),
          path.join(root, 'native/ContentControls.mm'),
          path.join(root, 'native/InterviewMaterials.mm'),
          '-framework',
          'AppKit',
          '-framework',
          'QuartzCore',
          '-o',
          output,
        ],
      ],
      [
        '/usr/bin/codesign',
        ['--force', '--sign', '-', '--identifier', 'com.voxcue.sidebar-glass', output],
      ],
    ]) {
      const result = spawnSync(command, args, { stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status) throw Error(`${command} failed (${result.status}).`);
    }
    // Never overwrite a mapped addon in a running app. Publish only the complete
    // signed file; existing processes retain their original inode until restart.
    await rename(output, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  console.log('Built arm64 sidebar Liquid Glass binding (macOS 26+, Node-API 8).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildSidebarGlass();
