import workspace from '../../shared/scripts/workspace.mjs';
import { cp, copyFile, mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { buildMacIcons } from './build-icons.mjs';

// A local development host gives TCC a named app with explicit usage strings.
// Vendor node_modules and the user's installed applications are never modified.
export async function prepareRuntime() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('Apple Silicon required.');
  const { icns } = await buildMacIcons();
  const root = workspace.platformRoot;
  const require = createRequire(path.join(root, 'package.json'));
  const version = require('electron/package.json').version;
  const directory = path.join(root, '.tools/electron-dev');
  const app = path.join(directory, 'Electron.app');
  const marker = path.join(directory, 'voxcue-runtime.json');
  const expected = JSON.stringify({
    electron: version,
    identity: 'com.voxcue.development',
    revision: 3,
    icon: createHash('sha256')
      .update(await readFile(icns))
      .digest('hex'),
  });
  if ((await readFile(marker, 'utf8').catch(() => '')) !== expected) {
    await mkdir(path.dirname(directory), { recursive: true });
    const staging = await mkdtemp(path.join(root, '.tools/electron-host-'));
    const stagedApp = path.join(staging, 'Electron.app');
    try {
      await cp(
        path.join(path.dirname(require.resolve('electron/package.json')), 'dist/Electron.app'),
        stagedApp,
        { recursive: true, verbatimSymlinks: true },
      );
      await copyFile(icns, path.join(stagedApp, 'Contents/Resources/voxcue.icns'));
      const plist = path.join(stagedApp, 'Contents/Info.plist');
      for (const [key, value] of Object.entries({
        CFBundleIdentifier: 'com.voxcue.development',
        CFBundleName: 'VoxCue',
        CFBundleDisplayName: 'VoxCue',
        CFBundleIconFile: 'voxcue.icns',
        NSMicrophoneUsageDescription:
          'VoxCue 在你开始语音输入或面试后在本机转写麦克风，不保存或上传音频。',
        NSAudioCaptureUsageDescription:
          'VoxCue 在你开始面试后在本机转写系统音频，不保存或上传音频。',
        NSScreenCaptureUsageDescription:
          'VoxCue 仅在你手动截图或开启附截图后捕获当前屏幕，用于回答当次面试问题，不持续录屏。',
      })) {
        const result = spawnSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist], {
          stdio: 'inherit',
        });
        if (result.status || result.error)
          throw Error('Unable to prepare development audio usage descriptions.');
      }
      const signed = spawnSync(
        '/usr/bin/codesign',
        [
          '--force',
          '--deep',
          '--sign',
          '-',
          '--preserve-metadata=entitlements,requirements,flags,runtime',
          stagedApp,
        ],
        { stdio: 'inherit' },
      );
      if (signed.status || signed.error) throw Error('Unable to sign local development host.');
      await writeFile(path.join(staging, 'voxcue-runtime.json'), expected);
      const previous = directory + '-previous-' + Date.now();
      let moved = false;
      await rename(directory, previous)
        .then(() => {
          moved = true;
        })
        .catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      try {
        await rename(staging, directory);
      } catch (error) {
        if (moved) await rename(previous, directory);
        throw error;
      }
      if (moved)
        console.log('Preserved previous development host for any running application: ' + previous);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  return { directory, executable: path.join(app, 'Contents/MacOS/Electron') };
}
