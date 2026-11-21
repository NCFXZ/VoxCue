import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isCloudProfileOwner, profileDirectoryName } from '../accountProfilePaths';
import { atomicFile } from './atomicFile';

export const legacyProfileAssignmentFile = 'legacy-profile-assignment-v1.json';
export class LegacyProfileMigrationError extends Error {
  constructor() {
    super('旧版资料迁移未完成。原件已保留，请重新打开应用后重试。');
  }
}
type Assignment = { owner: string | null; files: boolean; browser: boolean };

/** Inspect only directory entries, before Chromium creates storage for the current launch. */
export function hasChromiumAppStorage(root: string) {
  let actual: string;
  try {
    actual = realpathSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  for (const relative of ['IndexedDB', path.join('Local Storage', 'leveldb')]) {
    const directory = path.join(actual, relative);
    try {
      if (realpathSync(directory) !== directory) throw new LegacyProfileMigrationError();
      const entries = readdirSync(directory, { withFileTypes: true });
      if (relative === 'IndexedDB') {
        if (entries.some((entry) => entry.isDirectory() || entry.isFile())) return true;
      } else if (
        entries.some(
          (entry) =>
            entry.isFile() &&
            /^\d+\.(log|ldb|sst)$/i.test(entry.name) &&
            lstatSync(path.join(directory, entry.name)).size > 0,
        )
      )
        return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return false;
}

/** Both desktop platforms take Electron's single-instance lock. Within that process all attempts
 * share this queue. The first durable assignment is published before touching either data store. */
export class LegacyProfileClaim {
  private active?: { owner: string; controller: AbortController; work: Promise<void> };
  private stopped = false;
  constructor(
    private readonly root: string,
    private readonly ports: {
      browserPresent: boolean;
      filesPresent(): Promise<boolean>;
      migrateFiles(owner: string, signal: AbortSignal): Promise<void>;
      migrateBrowser(owner: string, signal: AbortSignal): Promise<void>;
    },
  ) {}
  get busy() {
    return !!this.active;
  }
  cancel() {
    this.active?.controller.abort();
  }
  async stop() {
    this.stopped = true;
    this.cancel();
    await this.active?.work.catch(() => {});
  }
  prepare(owner: string): Promise<void> {
    if (this.stopped || (owner !== 'local' && !isCloudProfileOwner(owner)))
      return Promise.reject(new LegacyProfileMigrationError());
    if (this.active) {
      if (this.active.owner === owner) return this.active.work;
      return this.active.work.catch(() => {}).then(() => this.prepare(owner));
    }
    const controller = new AbortController();
    const work = this.run(owner, controller.signal)
      .catch(() => {
        throw new LegacyProfileMigrationError();
      })
      .finally(() => {
        this.active = undefined;
      });
    this.active = { owner, controller, work };
    return work;
  }
  private async assignment(file: string): Promise<Assignment | undefined> {
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > 1024) throw new LegacyProfileMigrationError();
      const state: Assignment = JSON.parse(await readFile(file, 'utf8'));
      if (
        !state ||
        (state.owner !== null &&
          (typeof state.owner !== 'string' || !/^[a-f0-9]{64}$/.test(state.owner))) ||
        typeof state.files !== 'boolean' ||
        typeof state.browser !== 'boolean' ||
        (state.owner === null && (state.files || state.browser))
      )
        throw new LegacyProfileMigrationError();
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async owns(owner: string) {
    if (owner !== 'local' && !isCloudProfileOwner(owner)) return false;
    const file = path.join(await realpath(this.root), legacyProfileAssignmentFile);
    return (await this.assignment(file))?.owner === profileDirectoryName(owner);
  }
  private async run(owner: string, signal: AbortSignal) {
    const file = path.join(await realpath(this.root), legacyProfileAssignmentFile);
    let state = await this.assignment(file);
    if (!state) {
      const files = await this.ports.filesPresent(),
        browser = this.ports.browserPresent;
      state = { owner: files || browser ? profileDirectoryName(owner) : null, files, browser };
      signal.throwIfAborted();
      await atomicFile(file, JSON.stringify(state));
    }
    signal.throwIfAborted();
    if (state.owner !== profileDirectoryName(owner)) return;
    if (state.files) {
      await this.ports.migrateFiles(owner, signal);
      signal.throwIfAborted();
      state.files = false;
      await atomicFile(file, JSON.stringify(state));
    }
    if (state.browser) {
      await this.ports.migrateBrowser(owner, signal);
      signal.throwIfAborted();
      state.browser = false;
      await atomicFile(file, JSON.stringify(state));
    }
  }
}
