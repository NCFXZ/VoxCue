import { app } from 'electron';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile, preserveEncryptedFile } from '../atomicFile';
import { systemCredentialEncryption, type CredentialEncryption } from '../auth/storage';
import type { CloudVault } from './client';

const invalidCredentials = () =>
  Object.assign(Error('Invalid credentials'), { code: 'VOXCUE_CREDENTIAL_INVALID_DATA' });

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
  const crypto = encryption ?? systemCredentialEncryption;
  return {
    async read(decrypt: (value: Buffer) => string | Promise<string> = crypto.decrypt) {
      let bytes: Buffer;
      try {
        if ((await stat(file)).size > limit) throw invalidCredentials();
        bytes = await readFile(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      const plain = await decrypt(bytes);
      let value: unknown;
      try {
        value = JSON.parse(plain);
      } catch {
        throw invalidCredentials();
      }
      if (value === null) throw invalidCredentials();
      return value;
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
