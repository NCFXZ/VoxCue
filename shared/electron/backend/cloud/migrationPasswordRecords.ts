import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { profileDirectoryName } from '../../accountProfilePaths';
import { cloudOrigin } from './client';
import { validMigrationVerifier } from './migrationPasswords';

export const migrationPasswordFileName = 'migration-password.bin';
const invalid = () => Error('离线迁移验证记录无效。');

/** Verify each existing envelope with the candidate system key before retiring any older key. */
export async function readMigrationPasswordRecords(
  userData: string,
  decrypt: (ciphertext: Buffer) => Promise<string>,
): Promise<boolean> {
  const root = path.join(await realpath(userData), 'account-profiles');
  const base = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!base) return false;
  if (!base.isDirectory() || (await realpath(root)) !== root) throw invalid();
  let found = false;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!/^[0-9a-f]{64}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    if (!entry.isDirectory() || (await realpath(directory)) !== directory) throw invalid();
    const file = path.join(directory, migrationPasswordFileName);
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!stat) continue;
    if (!stat.isFile() || (await realpath(file)) !== file) throw invalid();
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
      const current = await handle.stat();
      if (
        !current.isFile() ||
        current.dev !== stat.dev ||
        current.ino !== stat.ino ||
        current.size < 1 ||
        current.size > 16_384
      )
        throw invalid();
      bytes = Buffer.alloc(current.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw invalid();
        offset += bytesRead;
      }
      if ((await handle.stat()).size !== current.size) throw invalid();
    } finally {
      await handle.close();
    }
    const value: unknown = JSON.parse(await decrypt(bytes));
    if (
      !validMigrationVerifier(value) ||
      typeof value.id !== 'string' ||
      cloudOrigin(value.origin, true) !== value.origin ||
      profileDirectoryName('account:' + value.id) !== entry.name
    )
      throw invalid();
    found = true;
  }
  return found;
}
