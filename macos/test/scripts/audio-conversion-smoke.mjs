import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required');
if (process.argv.length !== 2) throw Error('Audio conversion regression accepts no arguments');
const releaseAwake = holdDesktopAwake();
const directory = await mkdtemp(path.join(tmpdir(), 'voxcue-audio-conversion-'));
try {
  const binary = path.join(directory, 'audio-conversion');
  const fixture = fileURLToPath(new URL('../fixtures/audio-conversion.cpp', import.meta.url));
  execFileSync(
    '/usr/bin/xcrun',
    [
      'clang++',
      '-std=c++17',
      '-arch',
      'arm64',
      '-mmacosx-version-min=14.2',
      '-g',
      '-O1',
      '-fsanitize=address,undefined',
      '-fno-omit-frame-pointer',
      fixture,
      '-o',
      binary,
    ],
    { stdio: 'inherit', timeout: 60000 },
  );
  requireUnlockedDesktop();
  execFileSync(binary, [], { stdio: 'inherit', timeout: 30000 });
  const writer = path.join(directory, 'audio-writer');
  execFileSync('/usr/bin/xcrun', [
    'clang++', '-std=c++17', '-arch', 'arm64', '-mmacosx-version-min=14.2', '-fobjc-arc',
    // Only the fixture needs direct access to the capture queue, without opening a device.
    '-fno-access-control', '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
    fileURLToPath(new URL('../fixtures/audio-writer.mm', import.meta.url)),
    '-framework', 'CoreAudio', '-framework', 'Foundation', '-framework', 'AVFoundation', '-o', writer,
  ], { stdio: 'inherit', timeout: 60000 });
  for (const mode of ['drain', 'stall']) {
    requireUnlockedDesktop();
    execFileSync(writer, [mode], { stdio: 'inherit', timeout: 10000 });
  }
  console.log('PASS: the native writer drains ordered PCM to a slow reader and bounds shutdown of a stalled pipe.');
} finally {
  await rm(directory, { recursive: true, force: true });
  releaseAwake();
}
