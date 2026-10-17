import workspace from '../../shared/scripts/workspace.mjs';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { prepareRuntime } from './prepare-runtime.mjs';
if (path.resolve(process.cwd()) !== workspace.platformRoot)
  throw Error('Run from the macos installation.');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required.');
await prepareRuntime();
const contents = path.resolve('VoxCue.app/Contents');
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
run('/usr/bin/codesign', ['--force', '--sign', '-', path.dirname(contents)]);
console.log('Created macos/VoxCue.app. Double-click it to open the existing local build.');
