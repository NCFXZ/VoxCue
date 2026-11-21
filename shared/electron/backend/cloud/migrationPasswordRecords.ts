import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { profileDirectoryName } from '../../accountProfilePaths';
import { storedProfileDirectories } from '../storedProfileDirectories';
import { cloudOrigin } from './client';
import { validMigrationVerifier } from './migrationPasswords';

export const migrationPasswordFileName = 'migration-password.bin';
const invalid = () => Error('离线迁移验证记录无效。');

/** Verify each existing envelope with the candidate system key before retiring any older key. */
export async function readMigrationPasswordRecords(
  userData: string,
  decrypt: (ciphertext: Buffer) => Promise<string>,
): Promise<boolean> {
  let found = false;
  for await (const directory of storedProfileDirectories(userData)) {
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
      profileDirectoryName('account:' + value.id) !== path.basename(directory)
    )
      throw invalid();
    found = true;
  }
  return found;
}
