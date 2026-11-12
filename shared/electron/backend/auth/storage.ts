import { safeStorage, app } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicFile } from '../atomicFile';
import type { CredentialRecord, AuthStorage } from './service';
export interface CredentialEncryption {
  encrypt(value: string): Buffer | Promise<Buffer>;
  decrypt(value: Buffer): string | Promise<string>;
}
export function createAuthStorage(
  credentialEncryptionLabel = '系统凭据加密',
  encryption?: CredentialEncryption,
): AuthStorage {
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
    async read() {
      let value: Buffer;
      try {
        value = await readFile(credentials);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      const record = JSON.parse(await encryption.decrypt(value)) as CredentialRecord;
      if (
        record.version !== 1 ||
        !record.clientId?.startsWith('oaiapp_') ||
        !record.subject ||
        !record.hostId
      )
        throw new Error('本地登录信息无效，请检查应用数据。');
      return record;
    },
    async write(record) {
      await atomicWrite(credentials, await encryption.encrypt(JSON.stringify(record)));
    },
  };
}
