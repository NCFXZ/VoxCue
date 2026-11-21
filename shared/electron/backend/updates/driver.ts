import { createReadStream, existsSync, type BigIntStats } from 'node:fs';
import { lstat, readFile, realpath, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { storeUpdateMessage } from '../../contracts/updates';
import type { UpdateDriver } from './service';
import { compareVersions, releaseTarget } from './releases';
import type { AppUpdater } from 'electron-updater';
import { fetchPlatformUpdate, platformReleaseProvider, type ReleaseFetch } from './provider';
import {
  UpdateCache,
  platformUpdateInfo,
  validatePlatformUpdate,
  type PlatformUpdateInfo,
} from './cache';

interface DriverOptions {
  cacheDirectory?: string;
  mapInfo?: typeof platformUpdateInfo;
  validate?: typeof validatePlatformUpdate;
}
// Pinned electron-updater internals are confined to this adapter. Installation
// still runs through its stock downloader, signature verifier and NSIS state.
interface StockCacheAccess {
  readonly installerPath: string | null;
  getOrCreateDownloadHelper(): Promise<{ cacheDir: string; cacheDirForPendingUpdate: string }>;
  verifySignature(file: string): Promise<string | null>;
  httpExecutor: {
    download: (...args: any[]) => Promise<any>;
    downloadToBuffer: (...args: any[]) => Promise<any>;
  };
}
interface VerifiedInstaller {
  file: string;
  identity: string;
}
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export function configurePlatformUpdates(
  updater: AppUpdater,
  target: NonNullable<ReturnType<typeof releaseTarget>>,
  fetcher: ReleaseFetch = (input, init) =>
    updater.netSession.fetch(input instanceof URL ? input.href : input, init),
  options: DriverOptions = {},
): UpdateDriver {
  const lifetime = new AbortController();
  const native = updater as unknown as StockCacheAccess;
  const validate = options.validate ?? validatePlatformUpdate;
  const mapInfo = options.mapInfo ?? platformUpdateInfo;
  const cache = options.cacheDirectory
    ? new UpdateCache(options.cacheDirectory, target, validate)
    : undefined;
  let selected: PlatformUpdateInfo | undefined;
  let localComplete: PlatformUpdateInfo | undefined;
  let checkedInstaller: VerifiedInstaller | false = false;
  let checkedAt: number | null = null;
  let forceNext = false;
  let disposed = false;
  let checking: ReturnType<AppUpdater['checkForUpdates']> | undefined;
  let downloading: Promise<unknown> | undefined;
  let restoring: Promise<boolean> | undefined;
  let recovering: Promise<void> | undefined;
  let installation: Promise<void> | undefined;
  let disposing: Promise<void> | undefined;
  updater.setFeedURL({
    provider: 'custom',
    updateProvider: platformReleaseProvider(target, lifetime.signal, fetcher, async () => {
      const remote = async () => {
        const { candidate, metadata } = await fetchPlatformUpdate(target, lifetime.signal, fetcher);
        const info = validate(mapInfo(candidate, metadata), target);
        checkedAt = Date.now();
        return info;
      };
      lifetime.signal.throwIfAborted();
      selected = localComplete ?? (cache ? await cache.latest(forceNext, remote) : await remote());
      lifetime.signal.throwIfAborted();
      return selected;
    }),
  });
  updater.logger = null;

  async function pendingDirectory() {
    const helper = await native.getOrCreateDownloadHelper();
    const root = path.resolve(helper.cacheDir);
    const pending = path.resolve(helper.cacheDirForPendingUpdate);
    if (path.dirname(pending) !== root || path.basename(pending) !== 'pending')
      throw Error('Invalid native update cache directory');
    try {
      const directory = await lstat(pending);
      if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        (await realpath(pending)) !== path.join(await realpath(root), 'pending')
      )
        throw Error('Unsafe native update cache directory');
    } catch (error) {
      if (!absent(error)) throw error;
    }
    return pending;
  }
  async function cachedInfo(pending: string) {
    try {
      const file = path.join(pending, 'update-info.json');
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
        throw Error('Unsafe native update cache metadata');
      return JSON.parse(await readFile(file, 'utf8')) as { fileName?: unknown; sha512?: unknown };
    } catch (error) {
      if (absent(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }
  async function complete(
    info: PlatformUpdateInfo,
    signal?: AbortSignal,
    verifySignature = false,
    checked?: VerifiedInstaller | false,
  ) {
    info = validate(info, target);
    signal?.throwIfAborted();
    const pending = await pendingDirectory();
    const file = path.join(pending, info.selectedRelease.binary.name);
    const metadata = await cachedInfo(pending);
    if (metadata?.fileName !== info.selectedRelease.binary.name || metadata.sha512 !== info.sha512)
      return false;
    let stat;
    try {
      stat = await lstat(file, { bigint: true });
    } catch (error) {
      if (absent(error)) return false;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unsafe cached update file');
    if (stat.size !== BigInt(info.selectedRelease.binary.size)) return false;
    const identity = (s: BigIntStats) =>
      [file, info.sha512, s.dev, s.ino, s.size, s.birthtimeNs, s.ctimeNs, s.mtimeNs].join('\0');
    const observed = identity(stat);
    if (checked && checked.identity === observed && stat.ino > 0n && stat.ctimeNs > 0n) {
      signal?.throwIfAborted();
      return checked;
    }
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
    signal?.throwIfAborted();
    if (hash.digest('base64') !== info.sha512) return false;
    if (verifySignature && (await native.verifySignature(file)) !== null)
      throw Error('Cached update signature verification failed');
    if (verifySignature) {
      const after = await lstat(file, { bigint: true }).catch(error => {
        if (!absent(error)) throw error;
      });
      if (!after?.isFile() || identity(after) !== observed) throw Error('Offline update cache changed');
    }
    signal?.throwIfAborted();
    return { file, identity: observed };
  }
  async function removePartial(info: PlatformUpdateInfo) {
    const pending = await pendingDirectory();
    const binary = info.selectedRelease.binary.name;
    const names = [
      binary,
      `temp-${binary}`,
      `0-temp-${binary}`,
      `1-temp-${binary}`,
      `2-temp-${binary}`,
    ];
    const metadata = await cachedInfo(pending);
    if (metadata?.fileName === binary && metadata.sha512 === info.sha512)
      names.push('update-info.json');
    for (const name of names) {
      const file = path.join(pending, name);
      try {
        const stat = await lstat(file);
        if (!stat.isFile() && !stat.isSymbolicLink()) throw Error('Unsafe partial update file');
        await unlink(file);
      } catch (error) {
        if (!absent(error)) throw error;
      }
    }
  }
  function recover() {
    recovering ??= (async () => {
      const journal = cache?.journal();
      if (!journal) return;
      if (await complete(journal)) await cache!.clearJournal();
      else await clearIncomplete(journal, true);
    })().catch(error => {
      recovering = undefined;
      throw error;
    });
    return recovering;
  }
  async function clearIncomplete(info: PlatformUpdateInfo, cooldown: boolean) {
    let failure: unknown;
    if (cooldown) {
      try {
        await cache!.deferAutomaticDownload();
      } catch (error) {
        failure = error;
      }
    }
    // Still remove an owned partial if persisting the cooldown fails. Keep the
    // durable journal on either failure so the next launch retries cleanup.
    try {
      await removePartial(info);
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
    await cache!.clearJournal();
  }
  async function stockDownload(signal: AbortSignal, offline = false) {
    signal.throwIfAborted();
    const { CancellationToken } = createRequire(require.resolve('electron-updater/package.json'))(
      'builder-util-runtime',
    ) as typeof import('builder-util-runtime');
    const cancellation = new CancellationToken();
    const abort = () => cancellation.cancel();
    signal.addEventListener('abort', abort, { once: true });
    const executor = offline ? native.httpExecutor : undefined;
    const download = executor?.download,
      buffer = executor?.downloadToBuffer;
    if (executor) {
      // Never fall through to network if a complete cache changes while restoring.
      executor.download = executor.downloadToBuffer = async () => {
        throw Error('Offline update cache changed');
      };
    }
    try {
      const result = await updater.downloadUpdate(cancellation);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      if (executor) {
        executor.download = download!;
        executor.downloadToBuffer = buffer!;
      }
    }
  }
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
    on(event, listener) {
      if (event !== 'download-invalidated') updater.on(event, listener);
    },
    removeListener(event, listener) {
      if (event !== 'download-invalidated') updater.removeListener(event, listener);
    },
    checkForUpdates(force = false) {
      if (checking) return checking;
      checkedInstaller = false;
      checking = (async () => {
        lifetime.signal.throwIfAborted();
        await recover();
        lifetime.signal.throwIfAborted();
        localComplete = undefined;
        const info = cache?.info();
        let proof: VerifiedInstaller | false = false;
        if (
          !force &&
          target === 'windows-x64' &&
          info &&
          compareVersions(info.version, updater.currentVersion.version) > 0
        ) {
          proof = await complete(info, lifetime.signal, true);
          if (proof) localComplete = info;
        }
        lifetime.signal.throwIfAborted();
        forceNext = force;
        const result = await updater.checkForUpdates();
        if (result && localComplete === selected) checkedInstaller = proof;
        return result;
      })().finally(() => {
        checking = undefined;
        forceNext = false;
        localComplete = undefined;
      });
      return checking;
    },
    downloadUpdate(signal) {
      if (downloading) return downloading;
      checkedInstaller = false;
      const combined = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
      downloading = (async () => {
        await recover();
        combined.throwIfAborted();
        const info = selected ?? cache?.info();
        if (cache && !info) throw Error('Check updates before downloading');
        if (cache) await cache.beginDownload(info!);
        try {
          const result = await stockDownload(combined);
          if (cache) await cache.clearJournal();
          return result;
        } catch (error) {
          if (cache) {
            if (await complete(info!)) await cache.clearJournal();
            else await clearIncomplete(info!, disposed);
          }
          combined.throwIfAborted();
          throw error;
        }
      })().finally(() => {
        downloading = undefined;
      });
      return downloading;
    },
    restoreDownloadedUpdate(signal) {
      if (restoring) return restoring;
      const checked = checkedInstaller;
      checkedInstaller = false;
      restoring = (async () => {
        const combined = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
        await recover();
        combined.throwIfAborted();
        const info = selected ?? cache?.info();
        if (target !== 'windows-x64' || !info || !(await complete(info, combined, true, checked)))
          return false;
        await stockDownload(combined, true);
        return true;
      })().finally(() => {
        restoring = undefined;
      });
      return restoring;
    },
    isAutomaticDownloadAllowed: () => !disposed && (cache?.automaticAllowed() ?? true),
    lastCheckedAt: () => (cache ? cache.lastCheckedAt() : checkedAt),
    quitAndInstall(silent, forceRun) {
      installation ??= (async () => {
        const info = selected ?? cache?.info();
        const verified = !disposed && info && (await complete(info, lifetime.signal, true));
        if (!verified || (target === 'windows-x64' && native.installerPath !== verified.file))
          throw Error('Authenticated update is unavailable or changed before installation');
        lifetime.signal.throwIfAborted();
        updater.quitAndInstall(silent, forceRun);
      })().finally(() => {
        installation = undefined;
      });
      return installation;
    },
    dispose() {
      if (disposing) return disposing;
      disposed = true;
      lifetime.abort();
      disposing = (async () => {
        const jobs = [checking, downloading, restoring, installation].filter(
          Boolean,
        ) as Promise<unknown>[];
        const results = await Promise.allSettled(jobs);
        await recover();
        for (const result of results)
          if (result.status === 'rejected' && result.reason?.name !== 'AbortError')
            throw result.reason;
      })();
      return disposing;
    },
  };
}

export function createUpdateDriver(
  packaged: boolean,
  options: DriverOptions = {},
): UpdateDriver | undefined {
  const target = releaseTarget(process.platform, process.arch);
  if (
    !packaged ||
    process.windowsStore ||
    !target ||
    !existsSync(path.join(process.resourcesPath, 'app-update.yml'))
  )
    return undefined;
  // app-update.yml retains its original stock cache and signature settings.
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  return configurePlatformUpdates(autoUpdater, target, undefined, options);
}

export function updateUnavailableReason(packaged: boolean) {
  if (!packaged) return '开发版本不检查线上更新，请使用 VoxCue 安装版。';
  if (process.windowsStore) return storeUpdateMessage;
  if (!releaseTarget(process.platform, process.arch))
    return '当前系统或处理器架构不支持自动更新；macOS 仅支持 Apple Silicon。';
  return '便携版不支持自动安装更新，请使用 VoxCue 安装版。';
}
