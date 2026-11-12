import { lstat, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from '../../../shared/electron/backend/atomicFile';
import {
  validatePlatformUpdate,
  type PlatformUpdateInfo,
} from '../../../shared/electron/backend/updates/cache';
import { compareVersions } from '../../../shared/electron/backend/updates/releases';
import { signedMacUpdate } from './manifest';
import { verifyDownload } from './download';

/** Records only downloads completed by this implementation; never scans legacy files. */
export class MacArchiveOwnership {
  private readonly file: string;
  constructor(
    private directory: string,
    private publicKey: string,
  ) {
    this.file = path.join(directory, 'archive-ownership-v1.json');
  }
  private async load(): Promise<PlatformUpdateInfo[]> {
    let info;
    try {
      info = await lstat(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid!() ||
      info.nlink !== 1 ||
      info.size > 256 * 1024 ||
      info.mode & 0o077
    )
      throw Error('Unsafe Mac archive ownership record');
    const value = JSON.parse(await readFile(this.file, 'utf8'));
    if (value?.version !== 1 || !Array.isArray(value.items) || value.items.length > 64)
      throw Error('Invalid Mac archive ownership record');
    return value.items.map((item: unknown) => {
      const info = validatePlatformUpdate(item, 'macos-arm64');
      signedMacUpdate(item, info.selectedRelease, this.publicKey);
      // Keep the authenticated metadata, including its signature.
      return item as PlatformUpdateInfo;
    });
  }
  private save(items: PlatformUpdateInfo[]) {
    return atomicFile(this.file, JSON.stringify({ version: 1, items }));
  }
  async record(info: PlatformUpdateInfo) {
    signedMacUpdate(info, info.selectedRelease, this.publicKey);
    const items = (await this.load()).filter((item) => item.path !== info.path);
    if (items.length >= 64) return;
    await this.save([...items, info]);
  }
  async collect(installed: string, active: (file: string) => boolean, signal: AbortSignal) {
    const items = await this.load();
    const retained: PlatformUpdateInfo[] = [];
    for (const info of items) {
      signal.throwIfAborted();
      const file = path.join(this.directory, 'archives', info.selectedRelease.binary.name);
      if (compareVersions(info.version, installed) > 0 || active(file)) {
        retained.push(info);
        continue;
      }
      try {
        const before = await lstat(file);
        if (
          !before.isFile() ||
          before.isSymbolicLink() ||
          before.uid !== process.getuid!() ||
          before.nlink !== 1
        )
          throw Error('Unsafe owned update archive');
        const update = signedMacUpdate(info, info.selectedRelease, this.publicKey);
        await verifyDownload(file, update, signal);
        const after = await lstat(file);
        signal.throwIfAborted();
        if (
          active(file) ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          after.isSymbolicLink()
        )
          throw Error('Owned update archive changed or became active');
        await unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') retained.push(info);
      }
    }
    signal.throwIfAborted();
    if (retained.length !== items.length) await this.save(retained);
  }
}
