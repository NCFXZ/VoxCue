import { safeStorage, app } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicFile, preserveEncryptedFile } from '../atomicFile';
import type { CredentialRecord, AuthStorage } from './service';
export interface CredentialEncryption {
  encrypt(value: string): Buffer | Promise<Buffer>;
  decrypt(value: Buffer): string | Promise<string>;
}
export function createAuthStorage(
  credentialEncryptionLabel = '系统凭据加密',
  encryption?: CredentialEncryption,
) {
  const usesElectronEncryption = !encryption;
  encryption ??= {
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(`${credentialEncryptionLabel}不可用，登录信息未保存。`);
      return safeStorage.encryptString(value);
    },
    decrypt(value) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(`${credentialEncryptionLabel}不可用，请稍后重试。`);
      return safeStorage.decryptString(value);
    },
  };
  const directory = path.join(app.getPath('userData'), 'auth-data');
  const credentials = path.join(directory, 'credentials.bin');
  let unreadable = false;
  async function atomicWrite(target: string, value: string | Buffer) {
    await mkdir(directory, { recursive: true });
    await atomicFile(target, value);
  }
  return {
    async hostId() {
      if (usesElectronEncryption && !safeStorage.isEncryptionAvailable())
        throw new Error(`${credentialEncryptionLabel}不可用，请稍后重试。`);
      const file = path.join(directory, 'host-id');
      try {
        const value = await readFile(file, 'utf8');
        if (/^urn:uuid:[0-9a-f-]{36}$/i.test(value)) return value;
        throw new Error('设备标识损坏，请检查本地应用数据。');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const value = `urn:uuid:${randomUUID()}`;
      await atomicWrite(file, value);
      return value;
    },
    async read(decrypt: (value: Buffer) => string | Promise<string> = encryption.decrypt) {
      let value: Buffer;
      try {
        value = await readFile(credentials);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        unreadable = true;
        throw error;
      }
      try {
        const record = JSON.parse(await decrypt(value)) as CredentialRecord;
        if (
          !record ||
          typeof record !== 'object' ||
          Array.isArray(record) ||
          record.version !== 1 ||
          typeof record.clientId !== 'string' ||
          !record.clientId.startsWith('oaiapp_') ||
          typeof record.subject !== 'string' ||
          !record.subject ||
          typeof record.hostId !== 'string' ||
          !record.hostId ||
          typeof record.name !== 'string' ||
          typeof record.email !== 'string' ||
          !Number.isFinite(record.expiresAt) ||
          record.expiresAt < 0 ||
          (record.accessExpiresAt !== undefined && !Number.isFinite(record.accessExpiresAt)) ||
          [record.idToken, record.accessToken, record.refreshToken].some(
            (value) => value !== undefined && (typeof value !== 'string' || !value),
          ) ||
          (record.grantedScopes !== undefined &&
            (!Array.isArray(record.grantedScopes) ||
              record.grantedScopes.some((value) => typeof value !== 'string')))
        )
          throw new Error('本地登录信息无效，请检查应用数据。');
        unreadable = false;
        return record;
      } catch (error) {
        unreadable = true;
        throw error;
      }
    },
    async write(record) {
      const encrypted = await encryption.encrypt(JSON.stringify(record));
      if (unreadable) await preserveEncryptedFile(credentials);
      await atomicWrite(credentials, encrypted);
      unreadable = false;
    },
  } satisfies AuthStorage;
}
