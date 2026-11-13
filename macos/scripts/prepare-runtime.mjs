import workspace from '../../shared/scripts/workspace.mjs';
import { cp, copyFile, mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { buildMacIcons } from './build-icons.mjs';
import { loadDevelopmentSigning, verifyLocalApp } from './development-signing.mjs';
import { signMacApp } from './sign-app.mjs';
import { buildVaultCredentials } from './build-vault-credentials.mjs';
import {
  englishUsageDescriptions,
  localizeUsageDescriptions,
} from './localize-usage-descriptions.mjs';

// A local development host gives TCC a named app with explicit usage strings.
// Vendor node_modules and the user's installed applications are never modified.
export async function prepareRuntime() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('Apple Silicon required.');
  const signing = await loadDevelopmentSigning();
  await buildVaultCredentials();
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
    revision: 5,
    usageDescriptions: englishUsageDescriptions,
    signingCertificate: signing.sha256,
    icon: createHash('sha256')
      .update(await readFile(icns))
      .digest('hex'),
  });
  if ((await readFile(marker, 'utf8').catch(() => '')) !== expected) {
    await mkdir(path.dirname(directory), { recursive: true });
    // Build outside the File Provider workspace so it cannot reattach FinderInfo
    // to nested bundles between individual inside-out signing operations.
    const staging = await mkdtemp(path.join(os.tmpdir(), 'voxcue-electron-host-'));
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
          'VoxCue 仅在你点击截图按钮时捕获当前屏幕，图像暂存，点击发送后才用于回答，不持续录屏。',
      })) {
        const result = spawnSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist], {
          stdio: 'inherit',
        });
        if (result.status || result.error)
          throw Error('Unable to prepare development audio usage descriptions.');
      }
      await localizeUsageDescriptions(stagedApp);
      for (let attempt = 0; ; attempt++) {
        // File Provider can attach Finder metadata to this fresh staging bundle
        // during the copy, including nested frameworks. Remove only this fresh
        // bundle's display metadata, acting on symlinks themselves; preserve
        // quarantine, provenance, vendor files and running development hosts.
        const metadata = spawnSync('/usr/bin/xattr', [
          '-r',
          '-s',
          '-d',
          'com.apple.FinderInfo',
          stagedApp,
        ]);
        if (metadata.error) throw metadata.error;
        try {
          await signMacApp(stagedApp, {
            signing,
            identifier: 'com.voxcue.development',
            preserveMetadata: true,
          });
          break;
        } catch (error) {
          if (attempt === 4 || !/resource fork|Finder information|detritus/.test(error.message))
            throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
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
      let installed = false;
      try {
        await rename(staging, directory);
        installed = true;
        for (let attempt = 0; ; attempt++) {
          const metadata = spawnSync('/usr/bin/xattr', [
            '-r',
            '-s',
            '-d',
            'com.apple.FinderInfo',
            app,
          ]);
          if (metadata.error) throw metadata.error;
          try {
            verifyLocalApp(app, signing, 'com.voxcue.development');
            break;
          } catch (error) {
            if (attempt === 4 || !/resource fork|Finder information|detritus/.test(error.message))
              throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      } catch (error) {
        if (installed) await rename(directory, staging);
        if (moved) await rename(previous, directory);
        throw error;
      }
      if (moved)
        console.log('Preserved previous development host for any running application: ' + previous);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  verifyLocalApp(app, signing, 'com.voxcue.development', { strict: false });
  return { directory, executable: path.join(app, 'Contents/MacOS/Electron') };
}
