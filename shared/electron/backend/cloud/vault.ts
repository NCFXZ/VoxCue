import { app, safeStorage } from 'electron';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from '../atomicFile';
import type { CredentialEncryption } from '../auth/storage';
import type { CloudVault } from './client';

export function createCloudVault(encryption?: CredentialEncryption): CloudVault {
  return createCredentialVault(
    path.join(app.getPath('userData'), 'cloud-account', 'session.bin'),
    encryption,
  );
}

export function createCredentialVault<T>(
  file: string,
  encryption?: CredentialEncryption,
  limit = 16384,
) {
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
        if ((await stat(file)).size > limit) throw Error('Invalid credentials');
        return JSON.parse(await crypto.decrypt(await readFile(file))) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(value: T) {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const encrypted = await crypto.encrypt(JSON.stringify(value));
      if (encrypted.byteLength > limit) throw Error('Invalid credentials');
      await atomicFile(file, encrypted);
    },
    async clear() {
      await rm(file, { force: true });
    },
  };
}
