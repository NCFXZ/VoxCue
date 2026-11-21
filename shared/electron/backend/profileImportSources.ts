import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isCloudProfileOwner, profileDirectoryName } from '../accountProfilePaths';
import type { AccountImportSource } from '../contracts/accountData';
import { validCloudEmail, type CloudUser } from '../contracts/cloudAccount';
import { atomicFile } from './atomicFile';

const identityFile = 'profile-owner.json';
const invalid = () => Error('无法读取本机账号列表。');

export class ProfileImportSources {
  private pending: Promise<void> = Promise.resolve();
  constructor(
    private userData: string,
    private localRevision: () => string | undefined,
  ) {}

  /** Only called with the identity of the signed-in profile. No session or credential is stored here. */
  remember(user: Pick<CloudUser, 'id' | 'email'>) {
    const owner = { id: 'account:' + user.id, email: user.email };
    if (!isCloudProfileOwner(owner.id) || !validCloudEmail(owner.email)) throw invalid();
    const work = this.pending
      .catch(() => {})
      .then(async () => {
        const root = path.join(await realpath(this.userData), 'account-profiles');
        await mkdir(root, { mode: 0o700, recursive: true });
        if ((await realpath(root)) !== root) throw invalid();
        const name = profileDirectoryName(owner.id);
        const directory = path.join(root, name);
        await mkdir(directory, { mode: 0o700, recursive: true });
        if ((await realpath(directory)) !== directory) throw invalid();
        const current = await this.read(root, name);
        if (current?.email !== owner.email)
          await atomicFile(path.join(directory, identityFile), JSON.stringify(owner));
      });
    this.pending = work;
    // Failure is reported from list() when migration is actually requested.
    void work.catch(() => {});
  }
  async drain() {
    await this.pending.catch(() => {});
  }
  private async read(root: string, name: string): Promise<AccountImportSource | undefined> {
    const file = path.join(root, name, identityFile);
    try {
      if ((await realpath(file)) !== file || !(await lstat(file)).isFile()) return;
      const fd = await open(file, 'r');
      try {
        if ((await fd.stat()).size > 2048) return;
        const bytes = Buffer.alloc(2049);
        const { bytesRead } = await fd.read(bytes);
        if (bytesRead > 2048) return;
        const value: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
        if (
          !value ||
          typeof value !== 'object' ||
          !('id' in value) ||
          !('email' in value) ||
          !isCloudProfileOwner(value.id) ||
          !validCloudEmail(value.email) ||
          profileDirectoryName(value.id) !== name
        )
          return;
        return { id: value.id, email: value.email };
      } finally {
        await fd.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)
        return;
      throw invalid();
    }
  }
  async list(current: string) {
    await this.pending.catch(() => {
      throw invalid();
    });
    const root = path.join(await realpath(this.userData), 'account-profiles');
    const result: AccountImportSource[] = [];
    const currentName = profileDirectoryName(current);
    try {
      if ((await realpath(root)) !== root) throw invalid();
      for (const directory of await readdir(root, { withFileTypes: true })) {
        if (
          !directory.isDirectory() ||
          !/^[0-9a-f]{64}$/.test(directory.name) ||
          directory.name === currentName
        )
          continue;
        const identity = await this.read(root, directory.name);
        if (identity) result.push(identity);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw invalid();
    }
    result.sort((a, b) => a.email!.localeCompare(b.email!));
    if (current !== 'local' && this.localRevision()) result.unshift({ id: 'local' });
    return result;
  }
}
