import { existsSync } from 'node:fs';
import path from 'node:path';
import type { UpdateDriver } from './service';
import { releaseTarget } from './releases';
import type { AppUpdater } from 'electron-updater';
import { platformReleaseProvider, type ReleaseFetch } from './provider';

export function configurePlatformUpdates(
  updater: AppUpdater,
  target: NonNullable<ReturnType<typeof releaseTarget>>,
  fetcher: ReleaseFetch = (input, init) =>
    updater.netSession.fetch(input instanceof URL ? input.href : input, init),
): UpdateDriver {
  const lifetime = new AbortController();
  updater.setFeedURL({
    provider: 'custom',
    updateProvider: platformReleaseProvider(target, lifetime.signal, fetcher),
  });
  updater.logger = null;
  return {
    get autoDownload() {
      return updater.autoDownload;
    },
    set autoDownload(value) {
      updater.autoDownload = value;
    },
    get autoInstallOnAppQuit() {
      return updater.autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(value) {
      updater.autoInstallOnAppQuit = value;
    },
    get allowDowngrade() {
      return updater.allowDowngrade;
    },
    set allowDowngrade(value) {
      updater.allowDowngrade = value;
    },
    get allowPrerelease() {
      return updater.allowPrerelease;
    },
    set allowPrerelease(value) {
      updater.allowPrerelease = value;
    },
    on: (event, listener) => updater.on(event, listener),
    removeListener: (event, listener) => updater.removeListener(event, listener),
    checkForUpdates: () => updater.checkForUpdates(),
    downloadUpdate: () => updater.downloadUpdate(),
    quitAndInstall: (silent, forceRun) => updater.quitAndInstall(silent, forceRun),
    dispose: () => lifetime.abort(),
  };
}

export function createUpdateDriver(packaged: boolean): UpdateDriver | undefined {
  const target = releaseTarget(process.platform, process.arch);
  if (!packaged || !target || !existsSync(path.join(process.resourcesPath, 'app-update.yml')))
    return undefined;
  // app-update.yml still supplies native cache/signature settings. Release selection
  // is platform-specific and never uses the repository-wide Latest pointer.
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  return configurePlatformUpdates(autoUpdater, target);
}

export function updateUnavailableReason(packaged: boolean) {
  if (!packaged) return '开发版本不检查线上更新，请使用 VoxCue 安装版。';
  if (!releaseTarget(process.platform, process.arch))
    return '当前系统或处理器架构不支持自动更新；macOS 仅支持 Apple Silicon。';
  return '便携版不支持自动安装更新，请使用 VoxCue 安装版。';
}
