import workspace from '../../shared/scripts/workspace.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
if (path.resolve(process.cwd()) !== workspace.platformRoot)
  throw Error('Run from the macos installation.');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Mac audio requires Apple Silicon.');
mkdirSync('native/bin', { recursive: true });
const binary = path.resolve('native/bin/VoxCue.Audio');
for (const [command, args] of [
  [
    'xcrun',
    [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-O2',
      '-arch',
      'arm64',
      '-mmacosx-version-min=14.2',
      'native/AudioCapture.mm',
      '-framework',
      'Foundation',
      '-framework',
      'AVFoundation',
      '-framework',
      'CoreAudio',
      '-Wl,-sectcreate,__TEXT,__info_plist,' + path.resolve('native/Info.plist'),
      '-o',
      binary,
    ],
  ],
  ['codesign', ['--force', '--sign', '-', '--identifier', 'com.voxcue.audio', binary]],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}
console.log('Built local arm64 Core Audio helper (macOS 14.2+).');
