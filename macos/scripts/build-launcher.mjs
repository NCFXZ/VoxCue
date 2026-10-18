import workspace from '../../shared/scripts/workspace.mjs';
import { mkdir, writeFile, readFile, copyFile, mkdtemp, lstat, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { prepareRuntime } from './prepare-runtime.mjs';
if (path.resolve(process.cwd()) !== workspace.platformRoot)
  throw Error('Run from the macos installation.');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required.');
await prepareRuntime();
// Build a fresh bundle so Finder metadata on the existing launcher cannot invalidate signing.
const stage = await mkdtemp(path.join(os.tmpdir(), 'voxcue-launcher-build-'));
try {
  const bundle = path.join(stage, 'VoxCue.app');
  const contents = path.join(bundle, 'Contents');
  await mkdir(path.join(contents, 'MacOS'), { recursive: true });
  await mkdir(path.join(contents, 'Resources'), { recursive: true });
  const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    if (result.error) throw result.error;
    if (result.status) throw Error(`${command} failed (${result.status})`);
  };
  await copyFile('public/voxcue.icns', path.join(contents, 'Resources/voxcue.icns'));
  const version = JSON.parse(await readFile('../shared/package.json', 'utf8')).version;
  await writeFile(
    path.join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.voxcue.launcher</string>
  <key>CFBundleName</key><string>VoxCue</string>
  <key>CFBundleDisplayName</key><string>VoxCue</string>
  <key>CFBundleExecutable</key><string>VoxCue</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>voxcue.icns</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>14.2</string>
  <key>NSMicrophoneUsageDescription</key><string>VoxCue 在本机转写麦克风，不保存或上传音频。</string>
  <key>NSAudioCaptureUsageDescription</key><string>VoxCue 在本机转写系统音频，不保存或上传音频。</string>
  <key>NSScreenCaptureUsageDescription</key><string>VoxCue 仅在你手动截图或开启附截图后捕获当前屏幕，用于回答当次问题，不持续录屏。</string>
  </dict></plist>\n`,
  );
  run('/usr/bin/xcrun', [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-O2',
    '-arch',
    'arm64',
    '-mmacosx-version-min=14.2',
    'native/Launcher.mm',
    '-framework',
    'AppKit',
    '-o',
    path.join(contents, 'MacOS/VoxCue'),
  ]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  const target = path.resolve('VoxCue.app');
  const previous = path.join(stage, 'previous.app');
  const existing = await lstat(target).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink())
      throw Error('Unexpected launcher target');
    const plist = await readFile(path.join(target, 'Contents/Info.plist'), 'utf8');
    if (!/<key>CFBundleIdentifier<\/key>\s*<string>com\.voxcue\.launcher<\/string>/.test(plist))
      throw Error('Existing app is not the generated development launcher');
    const occupied = spawnSync('/usr/sbin/lsof', ['-t', '+D', target], { encoding: 'utf8' });
    if (occupied.error || occupied.stdout.trim())
      throw Error('Close the development launcher before rebuilding it');
    await rename(target, previous);
  }
  let installed = false;
  try {
    await rename(bundle, target);
    installed = true;
    // File Provider can reattach Finder metadata when the app enters the workspace.
    // This is our generated launcher only; quarantine/provenance are never removed.
    // The provider can attach it between a presence check and verification.
    // Bound retries to this freshly generated bundle; never clear security attributes.
    for (let attempt = 0; ; attempt++) {
      const metadata = spawnSync('/usr/bin/xattr', ['-d', 'com.apple.FinderInfo', target]);
      if (metadata.error) throw metadata.error;
      const verification = spawnSync(
        '/usr/bin/codesign',
        ['--verify', '--deep', '--strict', target],
        { encoding: 'utf8' },
      );
      if (!verification.error && verification.status === 0) break;
      if (attempt === 4 || verification.error)
        throw verification.error ?? Error(verification.stderr);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } catch (error) {
    if (installed) await rename(target, bundle);
    if (existing) await rename(previous, target);
    throw error;
  }
  console.log('Created macos/VoxCue.app. Double-click it to open the existing local build.');
} finally {
  await rm(stage, { recursive: true, force: true });
}
