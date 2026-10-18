import { app, net } from 'electron';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { UpdateDriver } from '../../../shared/electron/backend/updates/service';
import { fetchPlatformUpdate } from '../../../shared/electron/backend/updates/provider';
import {
  compareVersions,
  releaseAssetUrl,
} from '../../../shared/electron/backend/updates/releases';
import { signedMacUpdate, type SignedMacUpdate, publicUpdateKey } from './manifest';
import { downloadArchive, verifyDownload } from './download';
import { installFeed } from './install-feed';

interface NativeInstaller {
  begin(url: string, callback: (event: { type: string; message?: string }) => void): void;
  commit(): void;
  cancel(): void;
}

export class MacUpdateDriver extends EventEmitter implements UpdateDriver {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowDowngrade = false;
  allowPrerelease = false;
  private lifetime = new AbortController();
  private candidate?: Awaited<ReturnType<typeof fetchPlatformUpdate>>['candidate'];
  private update?: SignedMacUpdate;
  private directory?: string;
  private archive?: string;
  private feed?: Awaited<ReturnType<typeof installFeed>>;
  private committed = false;
  private installing = false;
  private disposed = false;
  constructor(
    private publicKey: string,
    private native: NativeInstaller,
  ) {
    super();
  }
  async checkForUpdates() {
    this.candidate = undefined;
    this.update = undefined;
    await this.clearDownload();
    const result = await fetchPlatformUpdate('macos-arm64', this.lifetime.signal, (input, init) =>
      net.fetch(input instanceof URL ? input.href : input, init),
    );
    const update = signedMacUpdate(result.metadata, result.candidate, this.publicKey);
    const minimum = update.minimumSystemVersion.split('.').map(Number);
    const system = process.getSystemVersion().split('.').map(Number);
    if (
      minimum.some(
        (part, index) =>
          part > (system[index] ?? 0) && minimum.slice(0, index).every((p, i) => p === system[i]),
      )
    )
      throw Error('Update requires a newer macOS');
    this.lifetime.signal.throwIfAborted();
    this.candidate = result.candidate;
    this.update = update;
    this.emit(
      compareVersions(update.version, app.getVersion()) > 0
        ? 'update-available'
        : 'update-not-available',
      { version: update.version },
    );
    return { cancellationToken: { cancel: () => this.dispose() } };
  }
  async downloadUpdate(signal?: AbortSignal) {
    const downloadSignal = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(30 * 60 * 1000),
      ...(signal ? [signal] : []),
    ]);
    downloadSignal.throwIfAborted();
    if (
      !this.update ||
      !this.candidate ||
      compareVersions(this.update.version, app.getVersion()) <= 0
    )
      throw Error('No newer verified update');
    await this.clearDownload();
    this.directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-update-'));
    const archive = path.join(this.directory, 'update.zip');
    try {
      await downloadArchive(
        releaseAssetUrl(this.candidate, this.update.url),
        archive,
        this.update,
        downloadSignal,
        (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
        (percent) => this.emit('download-progress', { percent }),
      );
      downloadSignal.throwIfAborted();
      this.archive = archive;
      this.emit('update-downloaded');
    } catch (error) {
      await this.clearDownload();
      throw error;
    }
  }
  quitAndInstall() {
    if (this.disposed || this.installing || !this.archive || !this.update)
      throw Error('No verified downloaded update');
    this.installing = true;
    void this.install().catch(() => {
      this.installing = false;
      this.feed?.close();
      this.feed = undefined;
      if (!this.disposed) this.emit('error', new Error('Mac update installation failed'));
    });
  }
  private async install() {
    await verifyDownload(this.archive!, this.update!);
    this.lifetime.signal.throwIfAborted();
    this.feed = await installFeed(this.archive!, this.update!);
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
  private async clearDownload() {
    const directory = this.directory;
    this.directory = undefined;
    this.archive = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    if (!this.committed) this.native.cancel();
    this.feed?.close();
    this.feed = undefined;
    void this.clearDownload();
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
  return new MacUpdateDriver(config.publicKey, native);
}
