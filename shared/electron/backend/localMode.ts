import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicFile } from './atomicFile';
import { validLocalImportRevision } from '../contracts/cloudAccount';

// A local preference only; it never creates a cloud identity or grants cloud access.
export class LocalMode {
  active = false;
  private saving = false;
  private revision?: string;
  private revisionWrite = Promise.resolve();
  constructor(private file: string) {}
  private get revisionFile() { return path.join(path.dirname(this.file), 'local-import-revision'); }
  get importRevision() { return this.revision; }
  async load() {
    // A missing or damaged hint cannot determine the user's entry mode.
    const revision = await readFile(this.revisionFile, 'utf8').catch(() => undefined);
    this.revision = validLocalImportRevision(revision) ? revision : undefined;
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (typeof value !== 'boolean') throw Error('本地账户设置无效，请重新选择。');
      this.active = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  setImportRevision(revision: unknown) {
    if (!this.active) throw Error('Invalid local import revision');
    return this.saveRevision(revision);
  }
  /** Only a verified, committed move out of the inactive local profile can update its hint. */
  movedImportRevision(revision: string | null) {
    if (this.active) throw Error('Invalid local import revision');
    return this.saveRevision(revision);
  }
  private saveRevision(revision: unknown) {
    if (this.saving || (revision !== null && !validLocalImportRevision(revision)))
      throw Error('Invalid local import revision');
    const next = revision ?? undefined;
    const job = this.revisionWrite.then(async () => {
      if (this.revision === next) return;
      if (next) await atomicFile(this.revisionFile, next);
      else await rm(this.revisionFile, { force: true });
      this.revision = next;
    });
    this.revisionWrite = job.catch(() => {});
    return job;
  }
  async set(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw Error('Invalid local mode');
    if (this.saving) throw Error('使用模式正在切换，请稍候。');
    this.saving = true;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      if (!enabled) await this.revisionWrite;
      await writeFile(temporary, JSON.stringify(enabled), { mode: 0o600 });
      await rename(temporary, this.file);
      this.active = enabled;
    } finally {
      this.saving = false;
      await rm(temporary, { force: true });
    }
  }
}
