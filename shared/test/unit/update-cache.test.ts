import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { AppUpdater } from 'electron-updater';
import { DownloadedUpdateHelper } from 'electron-updater/out/DownloadedUpdateHelper';
import { configurePlatformUpdates } from '../../../shared/electron/backend/updates/driver';
import {
  UpdateCache,
  platformUpdateInfo,
  updateInterval,
  type PlatformUpdateInfo,
} from '../../../shared/electron/backend/updates/cache';
import type { ReleaseFetch } from '../../../shared/electron/backend/updates/provider';
import { atomicFile } from '../../../shared/electron/backend/atomicFile';

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, lstatSync: vi.fn(fs.lstatSync) };
});
vi.mock('../../../shared/electron/backend/atomicFile', async (original) => {
  const fs = await original<typeof import('../../../shared/electron/backend/atomicFile')>();
  return { atomicFile: vi.fn(fs.atomicFile) };
});

const payload = Buffer.from('owned synthetic installer');
const name = 'VoxCue-Setup-1.0.1-x64.exe';
const digest = createHash('sha512').update(payload).digest('base64');
const metadata = { version: '1.0.1', files: [{ url: name, size: payload.length, sha512: digest }] };
const info = platformUpdateInfo(
  {
    version: '1.0.1',
    tag: 'windows-v1.0.1',
    manifest: 'latest.yml',
    publishedAt: 1_700_000_000_000,
    binary: { name, size: payload.length },
  },
  metadata,
);
const release = [
  {
    draft: false,
    prerelease: false,
    tag_name: info.selectedRelease.tag,
    published_at: info.releaseDate,
    assets: [
      { name: 'latest.yml', size: 100, state: 'uploaded' },
      { name, size: payload.length, state: 'uploaded' },
      { name: name + '.blockmap', size: 1, state: 'uploaded' },
    ],
  },
];
const logger = { info() {}, warn() {}, error() {} };
let root: string;
let now: number;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'voxcue-update-cache-'));
  now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (
    path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
    !path.basename(root).startsWith('voxcue-update-cache-')
  )
    throw Error('Unsafe fixture cleanup');
  await rm(root, { recursive: true, force: true });
});
const cacheDirectory = () => path.join(root, 'state');
const state = async () =>
  JSON.parse(await readFile(path.join(cacheDirectory(), 'release-cache.json'), 'utf8'));

class NativeFixture extends EventEmitter {
  currentVersion = { version: '1.0.0' };
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowDowngrade = false;
  allowPrerelease = false;
  logger: unknown = null;
  _logger = logger;
  helper = new DownloadedUpdateHelper(path.join(root, 'stock'));
  provider: any;
  info!: PlatformUpdateInfo;
  hold = false;
  started!: () => void;
  signature: string | null = null;
  verified = vi.fn(async () => this.signature);
  installerRestored = false;
  httpExecutor = {
    download: vi.fn(async () => {
      throw Error('Unexpected network');
    }),
    downloadToBuffer: vi.fn(async () => {
      throw Error('Unexpected network');
    }),
  };
  task = vi.fn(async (destination: string) => {
    await writeFile(destination, payload);
  });
  quitAndInstall = vi.fn();
  setFeedURL(options: any) {
    this.provider = new options.updateProvider({}, this, {
      platform: 'win32',
      executor: {},
      isUseMultipleRangeRequest: false,
    });
  }
  async checkForUpdates() {
    this.info = await this.provider.getLatestVersion();
    this.emit('update-available', this.info);
    return { cancellationToken: { cancel() {} } };
  }
  getOrCreateDownloadHelper() {
    return Promise.resolve(this.helper);
  }
  verifySignature(file: string) {
    return this.verified(file);
  }
  async downloadUpdate(token: any) {
    const pending = this.helper.cacheDirForPendingUpdate;
    if (this.hold) {
      await mkdir(pending, { recursive: true });
      await writeFile(path.join(pending, 'temp-' + name), 'partial');
      this.started();
      return new Promise<never>((_, reject) =>
        token.onCancel(() => reject(Error('Stock cancelled'))),
      );
    }
    // Exercise the installed stock helper and executeDownload cache-hit path,
    // with an owned synthetic payload replacing only the native network task.
    return (AppUpdater.prototype as any).executeDownload.call(this, {
      fileExtension: 'exe',
      fileInfo: this.provider.resolveFiles(this.info)[0],
      downloadUpdateOptions: {
        cancellationToken: token,
        updateInfoAndProvider: { info: this.info, provider: this.provider },
      },
      task: this.task,
      done: async (event: unknown) => {
        this.installerRestored = true;
        this.emit('update-downloaded', event);
      },
    });
  }
}
function setup(fetcher?: ReleaseFetch) {
  const updater = new NativeFixture();
  const requests = vi.fn<ReleaseFetch>(
    fetcher ??
      (async (input) =>
        new Response(
          JSON.stringify(new URL(String(input)).hostname === 'api.github.com' ? release : metadata),
        )),
  );
  const driver = configurePlatformUpdates(
    updater as unknown as AppUpdater,
    'windows-x64',
    requests,
    { cacheDirectory: cacheDirectory() },
  );
  return { updater, requests, driver };
}
async function writeComplete(updater: NativeFixture, bytes = payload) {
  const pending = updater.helper.cacheDirForPendingUpdate;
  await mkdir(pending, { recursive: true });
  await writeFile(path.join(pending, name), bytes);
  await writeFile(
    path.join(pending, 'update-info.json'),
    JSON.stringify({ fileName: name, sha512: digest, isAdminRightsRequired: false }),
  );
}

describe('persistent release check policy', () => {
  it('writes the attempt before one remote lookup, coalesces, survives restart/rollback, and permits hourly/forced checks', async () => {
    const first = new UpdateCache(cacheDirectory(), 'windows-x64');
    const load = vi.fn(async () => {
      expect((await state()).attemptedAt).toBe(now);
      return info;
    });
    await Promise.all([first.latest(false, load), first.latest(false, load)]);
    expect(load).toHaveBeenCalledTimes(1);
    const checkedAt = first.lastCheckedAt();
    now += 1000;
    const restarted = new UpdateCache(cacheDirectory(), 'windows-x64');
    await restarted.latest(false, load);
    expect(restarted.lastCheckedAt()).toBe(checkedAt);
    now -= 2000;
    await restarted.latest(false, load);
    expect(load).toHaveBeenCalledTimes(1);
    now += updateInterval + 2000;
    await restarted.latest(false, load);
    expect(load).toHaveBeenCalledTimes(2);
    await restarted.latest(true, load);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('persists failed attempts, retains a valid older result/time, and does not fetch again on restart', async () => {
    const cache = new UpdateCache(cacheDirectory(), 'windows-x64');
    const failure = vi.fn(async () => {
      throw Error('offline');
    });
    await expect(cache.latest(false, failure)).rejects.toThrow('offline');
    await expect(
      new UpdateCache(cacheDirectory(), 'windows-x64').latest(false, failure),
    ).rejects.toThrow('hourly');
    expect(failure).toHaveBeenCalledTimes(1);
    await cache.latest(true, async () => info);
    const checked = cache.lastCheckedAt();
    now += updateInterval;
    await expect(cache.latest(false, failure)).rejects.toThrow();
    const restarted = new UpdateCache(cacheDirectory(), 'windows-x64');
    await expect(restarted.latest(false, failure)).rejects.toThrow('hourly');
    expect(restarted.info()).toEqual(info);
    expect(restarted.lastCheckedAt()).toBe(checked);
  });
  it('publishes a successful result only after its durable write and replays a failed result write until force can retry', async () => {
    const cache = new UpdateCache(cacheDirectory(), 'windows-x64');
    await cache.latest(false, async () => info);
    const checkedAt = cache.lastCheckedAt();
    now += updateInterval;
    const binary = 'VoxCue-Setup-1.0.2-x64.exe';
    const next = platformUpdateInfo(
      {
        ...info.selectedRelease,
        version: '1.0.2',
        tag: 'windows-v1.0.2',
        binary: { ...info.selectedRelease.binary, name: binary },
      },
      { version: '1.0.2', files: [{ ...info.files[0], url: binary }] },
    );
    const fs = await vi.importActual<typeof import('../../../shared/electron/backend/atomicFile')>(
      '../../../shared/electron/backend/atomicFile',
    );
    vi.mocked(atomicFile)
      .mockImplementationOnce(fs.atomicFile)
      .mockImplementationOnce(async (_, value) => {
        expect(JSON.parse(String(value)).attemptSucceeded).toBe(true);
        expect(cache.info()).toEqual(info);
        expect(cache.lastCheckedAt()).toBe(checkedAt);
        throw Error('Result durable write failed');
      });
    const load = vi.fn(async () => next);
    try {
      await expect(cache.latest(false, load)).rejects.toThrow('Result durable write failed');
      expect(cache.info()).toEqual(info);
      expect(cache.lastCheckedAt()).toBe(checkedAt);
      expect(await state()).toMatchObject({
        attemptedAt: now,
        attemptSucceeded: false,
        checkedAt,
        info,
      });
      await expect(cache.latest(false, load)).rejects.toThrow('hourly');
      const restarted = new UpdateCache(cacheDirectory(), 'windows-x64');
      await expect(restarted.latest(false, load)).rejects.toThrow('hourly');
      expect(restarted.lastCheckedAt()).toBe(checkedAt);
      expect(load).toHaveBeenCalledOnce();
      now += 1000;
      await expect(cache.latest(true, load)).resolves.toEqual(next);
      expect(cache.lastCheckedAt()).toBe(now);
      expect(await state()).toMatchObject({ attemptSucceeded: true, checkedAt: now, info: next });
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.mocked(atomicFile).mockReset().mockImplementation(fs.atomicFile);
    }
  });
  it('fails safely without remote I/O on damaged/wrong-platform state or a failed attempt write', async () => {
    await mkdir(cacheDirectory(), { recursive: true });
    const load = vi.fn(async () => info);
    await writeFile(path.join(cacheDirectory(), 'release-cache.json'), '{broken');
    const corrupt = new UpdateCache(cacheDirectory(), 'windows-x64');
    await expect(corrupt.latest(true, load)).rejects.toThrow('cache');
    const blocked = path.join(root, 'blocked');
    const cache = new UpdateCache(blocked, 'windows-x64');
    await writeFile(blocked, 'not a directory');
    await expect(cache.latest(false, load)).rejects.toThrow();
    const valid = new UpdateCache(path.join(root, 'valid'), 'windows-x64');
    await valid.latest(false, async () => info);
    const value = JSON.parse(await readFile(valid.file, 'utf8'));
    value.info.selectedRelease.binary.name = 'VoxCue-1.0.1-arm64.zip';
    await writeFile(valid.file, JSON.stringify(value));
    await expect(
      new UpdateCache(path.join(root, 'valid'), 'windows-x64').latest(false, load),
    ).rejects.toThrow('cache');
    expect(load).not.toHaveBeenCalled();
  });
  it('refuses a linked cache directory without reading or replacing its target', async () => {
    const existing = new UpdateCache(cacheDirectory(), 'windows-x64');
    await existing.latest(false, async () => info);
    const before = await readFile(existing.file, 'utf8');
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const stat = fs.lstatSync(cacheDirectory());
    // The managed runner cannot create native junctions. Model only lstat's
    // junction result; the owned valid cache and all writes remain real I/O.
    vi.mocked(lstatSync).mockImplementation((input) =>
      String(input) === cacheDirectory()
        ? Object.assign(Object.create(stat), { isSymbolicLink: () => true })
        : fs.lstatSync(input),
    );
    const load = vi.fn(async () => info);
    try {
      await expect(
        new UpdateCache(cacheDirectory(), 'windows-x64').latest(true, load),
      ).rejects.toThrow('cache');
      expect(load).not.toHaveBeenCalled();
      expect(await readFile(existing.file, 'utf8')).toBe(before);
    } finally {
      vi.mocked(lstatSync).mockImplementation(fs.lstatSync);
    }
  });
});

describe('Windows stock pending cache ownership', () => {
  it('uses a newer complete installer after the hourly TTL even offline, while force still reaches the remote feed', async () => {
    const first = setup();
    await first.driver.checkForUpdates();
    await writeComplete(first.updater);
    await first.driver.dispose?.();
    const checkedAt = now;
    now += updateInterval + 1;
    const restarted = setup(async () => {
      throw Error('offline');
    });
    await restarted.driver.checkForUpdates();
    expect(restarted.requests).not.toHaveBeenCalled();
    expect(restarted.driver.lastCheckedAt?.()).toBe(checkedAt);
    await expect(restarted.driver.restoreDownloadedUpdate?.()).resolves.toBe(true);
    await expect(restarted.driver.checkForUpdates(true)).rejects.toThrow('offline');
    expect(restarted.requests).toHaveBeenCalledOnce();
    await restarted.driver.dispose?.();
  });
  it('does not let a complete cache of the installed version prevent the next hourly remote check', async () => {
    const first = setup();
    await first.driver.checkForUpdates();
    await writeComplete(first.updater);
    await first.driver.dispose?.();
    now += updateInterval;
    const installed = setup();
    installed.updater.currentVersion.version = '1.0.1';
    await installed.driver.checkForUpdates();
    expect(installed.requests).toHaveBeenCalledTimes(2);
    expect(installed.updater.verified).not.toHaveBeenCalled();
    await installed.driver.dispose?.();
  });
  it('restores a hash/signature-verified complete installer across restart through stock cache state, without download I/O', async () => {
    const first = setup();
    await first.driver.checkForUpdates();
    await writeComplete(first.updater);
    await first.driver.dispose?.();
    now += 1000;
    const restarted = setup();
    await restarted.driver.checkForUpdates();
    expect(restarted.requests).not.toHaveBeenCalled();
    expect(restarted.driver.lastCheckedAt?.()).toBe(now - 1000);
    restarted.updater.verified.mockClear();
    await expect(restarted.driver.restoreDownloadedUpdate?.()).resolves.toBe(true);
    expect(restarted.updater.verified).toHaveBeenCalledOnce();
    expect(restarted.updater.installerRestored).toBe(true);
    expect(restarted.updater.helper.file).toBe(path.join(root, 'stock', 'pending', name));
    expect(restarted.updater.task).not.toHaveBeenCalled();
    expect(restarted.updater.httpExecutor.download).not.toHaveBeenCalled();
    await restarted.driver.dispose?.();
    expect(await readFile(path.join(root, 'stock', 'pending', name))).toEqual(payload);
  });
  it('does not restore missing/incomplete/tampered files or a failed signature, and never downloads during restore', async () => {
    const fixture = setup();
    await fixture.driver.checkForUpdates();
    expect(await fixture.driver.restoreDownloadedUpdate?.()).toBe(false);
    await writeComplete(fixture.updater, Buffer.alloc(payload.length));
    expect(await fixture.driver.restoreDownloadedUpdate?.()).toBe(false);
    await writeComplete(fixture.updater);
    fixture.updater.signature = 'wrong signer';
    await expect(fixture.driver.restoreDownloadedUpdate?.()).rejects.toThrow('signature');
    expect(fixture.updater.installerRestored).toBe(false);
    expect(fixture.updater.task).not.toHaveBeenCalled();
    expect(fixture.updater.httpExecutor.download).not.toHaveBeenCalled();
    await fixture.driver.dispose?.();
  });
  it('blocks stock network fallback if a verified cache disappears before state restoration', async () => {
    const fixture = setup();
    await fixture.driver.checkForUpdates();
    await writeComplete(fixture.updater);
    fixture.updater.verified.mockImplementation(async () => {
      await unlink(path.join(root, 'stock', 'pending', name));
      return null;
    });
    fixture.updater.task.mockImplementation(async () => {
      await fixture.updater.httpExecutor.download();
    });
    await expect(fixture.driver.restoreDownloadedUpdate?.()).rejects.toThrow(
      'Offline update cache changed',
    );
    expect(fixture.updater.httpExecutor.download).not.toHaveBeenCalled();
    expect(fixture.updater.installerRestored).toBe(false);
    await fixture.driver.dispose?.();
  });
  it('recovers a crashed partial journal, preserves unrelated files, and permits manual download/forced recovery during automatic cooldown', async () => {
    const cache = new UpdateCache(cacheDirectory(), 'windows-x64');
    await cache.latest(false, async () => info);
    await cache.beginDownload(info);
    const pending = path.join(root, 'stock', 'pending');
    await mkdir(pending, { recursive: true });
    await writeFile(path.join(pending, 'temp-' + name), 'partial');
    await writeFile(path.join(pending, 'keep.txt'), 'unrelated');
    const restarted = setup();
    await restarted.driver.checkForUpdates();
    await expect(readFile(path.join(pending, 'temp-' + name))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(path.join(pending, 'keep.txt'), 'utf8')).toBe('unrelated');
    expect(restarted.driver.isAutomaticDownloadAllowed?.()).toBe(false);
    expect((await state()).notBefore).toBe(now + updateInterval);
    await restarted.driver.downloadUpdate();
    expect(await readFile(path.join(pending, name))).toEqual(payload);
    await restarted.driver.checkForUpdates(true);
    expect(restarted.requests).toHaveBeenCalledTimes(2);
    expect(restarted.driver.isAutomaticDownloadAllowed?.()).toBe(true);
    await restarted.driver.dispose?.();
  });
  it('cancels an active stock transfer on exit, removes only its partial, and persists cooldown across a clean restart', async () => {
    const fixture = setup();
    await fixture.driver.checkForUpdates();
    fixture.updater.hold = true;
    const started = new Promise<void>((resolve) => {
      fixture.updater.started = resolve;
    });
    const outcome = fixture.driver.downloadUpdate().catch((error: Error) => error);
    await started;
    await fixture.driver.dispose?.();
    expect(((await outcome) as Error).name).toBe('AbortError');
    await expect(
      readFile(path.join(root, 'stock', 'pending', 'temp-' + name)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await state()).download).toBeUndefined();
    expect(setup().driver.isAutomaticDownloadAllowed?.()).toBe(false);
  });
  it('aborts a pending release read on dispose while preserving the durable failed-attempt throttle', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cancelled = vi.fn();
    const fixture = setup(async () => {
      entered();
      return new Response(new ReadableStream({ cancel: cancelled }));
    });
    const outcome = fixture.driver.checkForUpdates().catch((error: Error) => error);
    await started;
    await fixture.driver.dispose?.();
    expect(((await outcome) as Error).name).toBe('AbortError');
    expect(cancelled).toHaveBeenCalled();
    const restarted = setup();
    await expect(restarted.driver.checkForUpdates()).rejects.toThrow('hourly');
    expect(restarted.requests).not.toHaveBeenCalled();
    await restarted.driver.dispose?.();
  });
  it('reports cleanup failure without recursively deleting an unexpected directory and retains its journal for retry', async () => {
    const fixture = setup();
    await fixture.driver.checkForUpdates();
    fixture.updater.hold = true;
    const started = new Promise<void>((resolve) => {
      fixture.updater.started = resolve;
    });
    const outcome = fixture.driver.downloadUpdate().catch((error: Error) => error);
    await started;
    const temporary = path.join(root, 'stock', 'pending', 'temp-' + name);
    await unlink(temporary);
    await mkdir(temporary);
    await writeFile(path.join(temporary, 'keep.txt'), 'unknown directory contents');
    await expect(fixture.driver.dispose?.()).rejects.toThrow('Unsafe partial');
    expect(((await outcome) as Error).name).not.toBe('AbortError');
    expect((await state()).download.version).toBe(info.version);
    expect((await state()).notBefore).toBe(now + updateInterval);
    expect(await readFile(path.join(temporary, 'keep.txt'), 'utf8')).toBe(
      'unknown directory contents',
    );
  });
});
