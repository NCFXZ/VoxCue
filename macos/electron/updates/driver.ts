import { app, net } from 'electron';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateDriver } from '../../../shared/electron/backend/updates/service';
import { fetchPlatformUpdate } from '../../../shared/electron/backend/updates/provider';
import {
  UpdateCache,
  platformUpdateInfo,
  validatePlatformUpdate,
  type PlatformUpdateInfo,
} from '../../../shared/electron/backend/updates/cache';
import {
  compareVersions,
  releaseAssetUrl,
} from '../../../shared/electron/backend/updates/releases';
import { signedMacUpdate, type SignedMacUpdate, publicUpdateKey } from './manifest';
import { downloadArchive, verifyDownload } from './download';
import { installFeed } from './install-feed';
import { MacArchiveOwnership } from './archives';

interface NativeInstaller {
  begin(url: string, callback: (event: { type: string; message?: string }) => void): void;
  commit(): void;
  cancel(): void;
}
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export class MacUpdateDriver extends EventEmitter implements UpdateDriver {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowDowngrade = false;
  allowPrerelease = false;
  private lifetime = new AbortController();
  private readonly cache: UpdateCache;
  private readonly directory: string;
  private readonly ownership: MacArchiveOwnership;
  private selected?: PlatformUpdateInfo;
  private update?: SignedMacUpdate;
  private archive?: string;
  private feed?: Awaited<ReturnType<typeof installFeed>>;
  private committed = false;
  private installing = false;
  private disposed = false;
  private checking?: Promise<{ cancellationToken: { cancel(): void } }>;
  private downloading?: Promise<void>;
  private restoring?: Promise<boolean>;
  private recovering?: Promise<void>;
  private installation?: Promise<void>;
  private disposing?: Promise<void>;
  constructor(
    private publicKey: string,
    private native: NativeInstaller,
    private cacheDirectory: string,
  ) {
    super();
    publicUpdateKey(publicKey);
    this.cacheDirectory = path.resolve(cacheDirectory);
    this.directory = path.join(this.cacheDirectory, 'archives');
    this.ownership = new MacArchiveOwnership(this.cacheDirectory, publicKey);
    this.cache = new UpdateCache(this.cacheDirectory, 'macos-arm64', (value, target) => {
      const info = validatePlatformUpdate(value, target);
      const update = signedMacUpdate(value, info.selectedRelease, this.publicKey);
      const raw = (value as { files: Array<Record<string, unknown>> }).files.find(
        (file) => file.url === update.url,
      )!;
      return {
        ...info,
        files: [{ ...update, voxcueSignature: raw.voxcueSignature }],
      };
    });
  }
  private async directories() {
    // Only fixed children of the main-owned userData directory are writable.
    for (const directory of [
      path.dirname(this.cacheDirectory),
      this.cacheDirectory,
      this.directory,
    ]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (await realpath(directory)) !==
          path.join(await realpath(path.dirname(directory)), path.basename(directory))
      )
        throw Error('Unsafe Mac update cache directory');
    }
  }
  private file(info: PlatformUpdateInfo, partial = false) {
    return path.join(
      this.directory,
      info.selectedRelease.binary.name + (partial ? '.partial' : ''),
    );
  }
  private authenticated(info: PlatformUpdateInfo) {
    const update = signedMacUpdate(info, info.selectedRelease, this.publicKey);
    const minimum = update.minimumSystemVersion.split('.').map(Number);
    const system = process.getSystemVersion().split('.').map(Number);
    if (
      minimum.some(
        (part, index) =>
          part > (system[index] ?? 0) && minimum.slice(0, index).every((p, i) => p === system[i]),
      )
    )
      throw Error('Update requires a newer macOS');
    return update;
  }
  private async complete(info: PlatformUpdateInfo, signal?: AbortSignal) {
    signal?.throwIfAborted();
    await this.directories();
    const update = this.authenticated(info);
    try {
      await verifyDownload(this.file(info), update, signal);
      return true;
    } catch (error) {
      if (absent(error)) return false;
      throw error;
    }
  }
  private async removePartial(info: PlatformUpdateInfo) {
    await this.directories();
    for (const partial of [true, false]) {
      const file = this.file(info, partial);
      try {
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unsafe partial Mac update');
        await unlink(file);
      } catch (error) {
        if (!absent(error)) throw error;
      }
    }
  }
  private async clearIncomplete(info: PlatformUpdateInfo, cooldown: boolean) {
    let failure: unknown;
    if (cooldown) {
      try {
        await this.cache.deferAutomaticDownload();
      } catch (error) {
        failure = error;
      }
    }
    try {
      await this.removePartial(info);
    } catch (error) {
      failure ??= error;
    }
    // Retain the durable journal if either persistence or cleanup failed.
    if (failure) throw failure;
    await this.cache.clearJournal();
  }
  private async recoverableComplete(info: PlatformUpdateInfo) {
    try {
      return await this.complete(info);
    } catch (error) {
      const stat = await lstat(this.file(info)).catch((error) => {
        if (!absent(error)) throw error;
        return undefined;
      });
      // Only an incomplete ordinary file may be removed. A redirected or
      // unexpected node remains untouched with its durable journal intact.
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw error;
      return false;
    }
  }
  private recover() {
    this.recovering ??= (async () => {
      await this.directories();
      const journal = this.cache.journal();
      if (journal) {
        // A crash after atomic publication must preserve its completed archive.
        if (await this.recoverableComplete(journal)) await this.cache.completeDownload(journal);
        else await this.clearIncomplete(journal, true);
      }
      await this.ownership
        .collect(
          app.getVersion(),
          (file) =>
            this.archive === file ||
            this.feed !== undefined ||
            this.installing ||
            (this.selected !== undefined && this.file(this.selected) === file) ||
            (this.cache.journal() !== undefined && this.file(this.cache.journal()!) === file),
          this.lifetime.signal,
        )
        .catch(() => {});
    })();
    return this.recovering;
  }
  checkForUpdates(force = false) {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      this.lifetime.signal.throwIfAborted();
      this.selected = undefined;
      this.update = undefined;
      this.archive = undefined;
      await this.recover();
      this.lifetime.signal.throwIfAborted();
      const completed = this.cache.completed();
      const local =
        !force &&
        completed &&
        compareVersions(completed.version, app.getVersion()) > 0 &&
        (await this.complete(completed, this.lifetime.signal))
          ? completed
          : undefined;
      const info =
        local ??
        (await this.cache.latest(force, async () => {
          const result = await fetchPlatformUpdate(
            'macos-arm64',
            this.lifetime.signal,
            (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
          );
          const selected = platformUpdateInfo(result.candidate, result.metadata);
          const update = signedMacUpdate(result.metadata, result.candidate, this.publicKey);
          const raw = (
            result.metadata as unknown as { files: Array<Record<string, unknown>> }
          ).files.find((file) => file.url === update.url)!;
          return { ...selected, files: [{ ...update, voxcueSignature: raw.voxcueSignature }] };
        }));
      const update = this.authenticated(info);
      this.lifetime.signal.throwIfAborted();
      this.selected = info;
      this.update = update;
      this.emit(
        compareVersions(update.version, app.getVersion()) > 0
          ? 'update-available'
          : 'update-not-available',
        { version: update.version },
      );
      return {
        cancellationToken: {
          cancel: () => {
            void this.dispose().catch(() => {});
          },
        },
      };
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  lastCheckedAt() {
    return this.cache.lastCheckedAt();
  }
  isAutomaticDownloadAllowed() {
    return !this.disposed && this.cache.automaticAllowed();
  }
  restoreDownloadedUpdate(signal?: AbortSignal) {
    if (this.restoring) return this.restoring;
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    this.restoring = (async () => {
      await this.recover();
      combined.throwIfAborted();
      const info = this.selected;
      if (
        !info ||
        compareVersions(info.version, app.getVersion()) <= 0 ||
        !(await this.complete(info, combined))
      )
        return false;
      combined.throwIfAborted();
      this.archive = this.file(info);
      this.update = this.authenticated(info);
      return true;
    })().finally(() => {
      this.restoring = undefined;
    });
    return this.restoring;
  }
  downloadUpdate(signal?: AbortSignal) {
    if (this.downloading) return this.downloading;
    const downloadSignal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    this.downloading = (async () => {
      await this.recover();
      downloadSignal.throwIfAborted();
      const info = this.selected;
      const update = this.update;
      if (!info || !update || compareVersions(update.version, app.getVersion()) <= 0)
        throw Error('No newer verified update');
      if (await this.complete(info, downloadSignal)) {
        downloadSignal.throwIfAborted();
        this.archive = this.file(info);
        this.emit('update-downloaded');
        return;
      }
      this.archive = undefined;
      await this.cache.beginDownload(info);
      let progressStep: number | undefined;
      try {
        await downloadArchive(
          releaseAssetUrl(info.selectedRelease, update.url),
          this.file(info, true),
          update,
          downloadSignal,
          (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
          (percent) => {
            const step = Math.floor(percent);
            if (!this.disposed && !downloadSignal.aborted && step !== progressStep) {
              progressStep = step;
              this.emit('download-progress', { percent });
            }
          },
        );
        downloadSignal.throwIfAborted();
        await rename(this.file(info, true), this.file(info));
        await this.cache.completeDownload(info);
        // Cleanup bookkeeping is best effort and never invalidates an authenticated download.
        await this.ownership.record(info).catch(() => {});
        downloadSignal.throwIfAborted();
        this.archive = this.file(info);
        this.emit('update-downloaded');
      } catch (error) {
        if (await this.recoverableComplete(info)) await this.cache.completeDownload(info);
        else await this.clearIncomplete(info, this.disposed || downloadSignal.aborted || (error as Error)?.name === 'TimeoutError');
        downloadSignal.throwIfAborted();
        throw error;
      }
    })().finally(() => {
      this.downloading = undefined;
    });
    return this.downloading;
  }
  quitAndInstall() {
    if (this.disposed || this.installing || !this.archive || !this.update)
      throw Error('No verified downloaded update');
    this.installing = true;
    const installation = this.install().catch((error) => {
      this.installing = false;
      this.feed?.close();
      this.feed = undefined;
      if (!this.disposed) this.emit('error', new Error('Mac update installation failed'));
      throw error;
    });
    // The caller receives setup failure; dispose still waits for its cleanup
    // without reporting the same already-handled installation error twice.
    this.installation = installation.catch(() => {});
    return installation;
  }
  private async install() {
    const update = this.authenticated(this.selected!);
    await this.directories();
    await verifyDownload(this.archive!, update, this.lifetime.signal);
    this.lifetime.signal.throwIfAborted();
    this.feed = await installFeed(this.archive!, update);
    this.lifetime.signal.throwIfAborted();
    this.native.begin(this.feed.url, (event) => {
      if (event.type === 'ready' && !this.disposed) {
        this.committed = true;
        try {
          this.native.commit();
        } catch {
          this.committed = false;
          this.installing = false;
          this.emit('error', new Error('Mac update commit failed'));
        }
      } else if (event.type === 'quit' && this.committed) app.quit();
      else if (event.type === 'error' && !this.disposed) {
        this.committed = false;
        this.installing = false;
        this.feed?.close();
        this.feed = undefined;
        this.emit('error', new Error('Mac update installation failed'));
      }
    });
  }
  dispose() {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.lifetime.abort();
    if (!this.committed) this.native.cancel();
    this.disposing = (async () => {
      const jobs = [this.checking, this.downloading, this.restoring, this.installation].filter(
        Boolean,
      ) as Promise<unknown>[];
      const results = await Promise.allSettled(jobs);
      this.feed?.close();
      this.feed = undefined;
      await this.recover();
      for (const result of results)
        if (result.status === 'rejected' && result.reason?.name !== 'AbortError')
          throw result.reason;
    })();
    return this.disposing;
  }
}

export function createMacUpdateDriver(): UpdateDriver {
  if (!app.isPackaged || process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('Unsupported Mac update host');
  const config = JSON.parse(
    readFileSync(path.join(process.resourcesPath, 'voxcue-update.json'), 'utf8'),
  );
  if (config.protocol !== 1 || config.repository !== 'NCFXZ/VoxCue-releases')
    throw Error('Invalid Mac update configuration');
  publicUpdateKey(config.publicKey);
  const native = require(
    path.join(process.resourcesPath, 'native/VoxCue.Updater.node'),
  ) as NativeInstaller;
  return new MacUpdateDriver(
    config.publicKey,
    native,
    path.join(app.getPath('userData'), 'updates'),
  );
}
