import { app, safeStorage } from 'electron';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile, preserveEncryptedFile } from '../atomicFile';
import type { CredentialEncryption } from '../auth/storage';
import type { CloudVault } from './client';

export function createCloudVault(encryption?: CredentialEncryption) {
  return createCredentialVault<Parameters<CloudVault['write']>[0]>(
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
    async read(decrypt: (value: Buffer) => string | Promise<string> = crypto.decrypt) {
      try {
        if ((await stat(file)).size > limit) throw Error('Invalid credentials');
        const value: unknown = JSON.parse(await decrypt(await readFile(file)));
        if (value === null) throw Error('Invalid credentials');
        return value;
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
    async preserve() {
      await preserveEncryptedFile(file);
    },
  };
}
