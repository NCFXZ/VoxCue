import { lstatSync, readFileSync } from 'node:fs';
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateInfo } from 'electron-updater';
import { atomicFile } from '../atomicFile';
import {
  manifestFile,
  releaseCandidates,
  type ReleaseCandidate,
  type ReleaseTarget,
} from './releases';

export const updateInterval = 60 * 60 * 1000;
export interface PlatformUpdateInfo extends UpdateInfo {
  selectedRelease: ReleaseCandidate;
}

export function platformUpdateInfo(
  candidate: ReleaseCandidate,
  metadata: unknown,
): PlatformUpdateInfo {
  const selected = manifestFile(metadata, candidate);
  return {
    version: candidate.version,
    files: [{ url: selected.url, sha512: selected.sha512, size: selected.size }],
    path: selected.url,
    sha512: selected.sha512,
    releaseDate: new Date(candidate.publishedAt).toISOString(),
    releaseName: candidate.tag,
    ...(selected.minimumSystemVersion
      ? { minimumSystemVersion: selected.minimumSystemVersion }
      : {}),
    selectedRelease: candidate,
  };
}

/** Reapply the same platform/name/version/digest rules to local public metadata. */
export function validatePlatformUpdate(value: unknown, target: ReleaseTarget): PlatformUpdateInfo {
  const info = value as Partial<PlatformUpdateInfo> | null;
  const candidate = info?.selectedRelease;
  if (!candidate || !Number.isFinite(candidate.publishedAt) || !candidate.binary)
    throw Error('Invalid cached platform release');
  const candidates = releaseCandidates(
    [
      {
        draft: false,
        prerelease: false,
        tag_name: candidate.tag,
        published_at: new Date(candidate.publishedAt).toISOString(),
        assets: [
          { name: candidate.manifest, size: 1, state: 'uploaded' },
          { ...candidate.binary, state: 'uploaded' },
          ...(target === 'windows-x64'
            ? [{ name: candidate.binary.name + '.blockmap', size: 1, state: 'uploaded' }]
            : []),
        ],
      },
    ],
    target,
  );
  const selected = candidates.find(
    (entry) => entry.version === candidate.version && entry.manifest === candidate.manifest,
  );
  if (!selected) throw Error('Cached release does not belong to this platform');
  return platformUpdateInfo(selected, value);
}

interface CacheState {
  schemaVersion: 1;
  target: ReleaseTarget;
  attemptedAt: number | null;
  attemptSucceeded: boolean;
  checkedAt: number | null;
  notBefore: number;
  info?: PlatformUpdateInfo;
  download?: PlatformUpdateInfo;
  completed?: PlatformUpdateInfo;
}
const validTime = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8_640_000_000_000_000;

/** Local state only; a failed durable attempt write must never start a request. */
export class UpdateCache {
  private state: CacheState;
  private fault?: Error;
  private retryRead = false;
  private saving = Promise.resolve();
  private checking?: Promise<PlatformUpdateInfo>;
  readonly file: string;
  private readonly directory: string;
  constructor(
    directory: string,
    readonly target: ReleaseTarget,
    private readonly validate: typeof validatePlatformUpdate = validatePlatformUpdate,
  ) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'release-cache.json');
    this.state = {
      schemaVersion: 1,
      target,
      attemptedAt: null,
      attemptSucceeded: false,
      checkedAt: null,
      notBefore: 0,
    };
    this.readState();
  }
  private readState() {
    const { target } = this;
    this.retryRead = false;
    this.fault = undefined;
    try {
      try {
        const directory = lstatSync(this.directory);
        if (!directory.isDirectory() || directory.isSymbolicLink())
          throw Error('Unsafe update cache directory');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const file = lstatSync(this.file);
      if (!file.isFile() || file.isSymbolicLink() || file.size > 256 * 1024)
        throw Error('Invalid update cache file');
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as CacheState;
      if (
        value?.schemaVersion !== 1 ||
        value.target !== target ||
        typeof value.attemptSucceeded !== 'boolean' ||
        (value.attemptedAt !== null && !validTime(value.attemptedAt)) ||
        (value.checkedAt !== null && !validTime(value.checkedAt)) ||
        !validTime(value.notBefore)
      )
        throw Error('Invalid update cache');
      this.state = {
        schemaVersion: 1,
        target,
        attemptedAt: value.attemptedAt,
        attemptSucceeded: value.attemptSucceeded,
        checkedAt: value.checkedAt,
        notBefore: value.notBefore,
        ...(value.info ? { info: this.validate(value.info, target) } : {}),
        ...(value.download ? { download: this.validate(value.download, target) } : {}),
        ...(value.completed ? { completed: this.validate(value.completed, target) } : {}),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.fault = Error('Update cache is unavailable or invalid');
        this.retryRead = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'EAGAIN';
      }
    }
  }
  private save(state = this.state) {
    if (this.fault) return Promise.reject(this.fault);
    const value = JSON.stringify(state);
    const job = this.saving
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        const directory = await lstat(this.directory);
        if (!directory.isDirectory() || directory.isSymbolicLink())
          throw Error('Unsafe update cache directory');
        await atomicFile(this.file, value);
      });
    this.saving = job;
    return job;
  }
  latest(force: boolean, load: () => Promise<PlatformUpdateInfo>) {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      if (this.fault) throw this.fault;
      const now = Date.now();
      const attemptedAt = this.state.attemptedAt;
      if (
        !force &&
        attemptedAt !== null &&
        (now < attemptedAt || now - attemptedAt < updateInterval)
      ) {
        if (this.state.attemptSucceeded && this.state.info)
          return this.validate(this.state.info, this.target);
        throw Error('The previous update check failed; retry after the hourly interval');
      }
      this.state.attemptedAt = now;
      this.state.attemptSucceeded = false;
      if (force) this.state.notBefore = 0;
      await this.save();
      const info = this.validate(await load(), this.target);
      const result = { ...this.state, info, checkedAt: Date.now(), attemptSucceeded: true };
      await this.save(result);
      this.state = result;
      return info;
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  lastCheckedAt() {
    return this.state.checkedAt;
  }
  info() {
    return this.state.info && this.validate(this.state.info, this.target);
  }
  journal() {
    if (this.retryRead) {
      this.readState();
      if (this.fault) throw this.fault;
    }
    return this.state.download && this.validate(this.state.download, this.target);
  }
  completed() {
    return this.state.completed && this.validate(this.state.completed, this.target);
  }
  async completeDownload(info: PlatformUpdateInfo) {
    const state = { ...this.state, completed: this.validate(info, this.target) };
    delete state.download;
    await this.save(state);
    this.state = state;
  }
  automaticAllowed() {
    return !this.fault && !this.state.download && Date.now() >= this.state.notBefore;
  }
  async beginDownload(info: PlatformUpdateInfo) {
    this.state.download = this.validate(info, this.target);
    await this.save();
  }
  async deferAutomaticDownload() {
    this.state.notBefore = Math.max(this.state.notBefore, Date.now() + updateInterval);
    await this.save();
  }
  async clearJournal() {
    const state = { ...this.state };
    delete state.download;
    await this.save(state);
    delete this.state.download;
  }
}
