import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CredentialEncryption } from '../auth/storage';
import type { CloudVault } from './client';

export function createCloudVault(encryption?: CredentialEncryption): CloudVault {
  const file = path.join(app.getPath('userData'), 'cloud-account', 'session.bin');
  const crypto = encryption ?? {
    async encrypt(value: string) {
      if (!safeStorage.isEncryptionAvailable())
        throw Error('System credential encryption unavailable');
      return safeStorage.encryptString(value);
    },
    async decrypt(value: Buffer) {
      if (!safeStorage.isEncryptionAvailable())
        throw Error('System credential encryption unavailable');
      return safeStorage.decryptString(value);
    },
  };
  return {
    async read() {
      try {
        if ((await stat(file)).size > 16384) throw Error('Invalid credentials');
        return JSON.parse(await crypto.decrypt(await readFile(file))) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(value) {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, await crypto.encrypt(JSON.stringify(value)), {
          mode: 0o600,
          flag: 'wx',
        });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async clear() {
      await rm(file, { force: true });
    },
  };
}
