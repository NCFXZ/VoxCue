import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  apiProviderIds, isApiProvider, parseApiConnectionConfig,
  type ApiConnectionConfig, type ApiProvider,
} from '../../contracts/apiConnections';
import { storedProfileDirectories } from '../storedProfileDirectories';
import { atomicFile } from '../atomicFile';
import { systemCredentialEncryption, type CredentialEncryption } from '../auth/storage';
import type { ApiCredential } from './types';

class InvalidApiCredential extends Error {
  constructor() { super('API 密钥记录无效，请重新配置。'); }
}
const limit = 64 * 1024;

function checkKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[!-~]{1,4096}$/.test(value)) throw new InvalidApiCredential();
}

/** Public settings are readable without opening the OS vault; a second, encrypted copy
 * binds every key to its destination so editing metadata cannot redirect a credential. */
export class ApiCredentialStore {
  private readonly directory: string;
  private readonly lifetime = new AbortController();
  private writes = Promise.resolve();

  constructor(root: string, private encryption: CredentialEncryption = systemCredentialEncryption) {
    this.directory = path.join(root, 'auth-data', 'api-keys');
  }

  private file(provider: ApiProvider) {
    if (!isApiProvider(provider)) throw new InvalidApiCredential();
    return path.join(this.directory, provider + '.json');
  }

  private async envelope(provider: ApiProvider) {
    this.lifetime.signal.throwIfAborted();
    const handle = await open(this.file(provider), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!handle) return null;
    let contents: string;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > limit) throw new InvalidApiCredential();
      contents = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
    try {
      const value = JSON.parse(contents);
      if (value?.version !== 1 || value.config?.provider !== provider ||
          typeof value.ciphertext !== 'string' || !value.ciphertext) throw new InvalidApiCredential();
      return { config: parseApiConnectionConfig(value.config), ciphertext: value.ciphertext as string };
    } catch {
      throw new InvalidApiCredential();
    }
  }

  async list(): Promise<ApiConnectionConfig[]> {
    await this.writes;
    const entries = await Promise.all(apiProviderIds.map(async (provider) => {
      try {
        return (await this.envelope(provider))?.config;
      } catch (error) {
        // Keep a damaged entry visible for replacement/removal without hiding other providers.
        if (error instanceof InvalidApiCredential) return { provider };
        throw error;
      }
    }));
    this.lifetime.signal.throwIfAborted();
    return entries.flatMap((entry) => entry ? [entry] : []);
  }

  async read(provider: ApiProvider, decrypt = (value: Buffer) => this.encryption.decrypt(value)): Promise<ApiCredential | null> {
    await this.writes;
    const entry = await this.envelope(provider);
    if (!entry) return null;
    const decrypted = await decrypt(Buffer.from(entry.ciphertext, 'base64'));
    this.lifetime.signal.throwIfAborted();
    let data;
    try { data = JSON.parse(decrypted); } catch { throw new InvalidApiCredential(); }
    if (JSON.stringify(data?.config) !== JSON.stringify(entry.config)) throw new InvalidApiCredential();
    checkKey(data?.key);
    const { region, workspace } = entry.config;
    return { key: data.key, region, workspace };
  }

  private change(operation: () => Promise<void>) {
    const next = this.writes.then(() => {
      this.lifetime.signal.throwIfAborted();
      return operation();
    });
    this.writes = next.catch(() => {});
    return next;
  }

  save(provider: ApiProvider, credential: ApiCredential, signal?: AbortSignal) {
    const active = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    return this.change(async () => {
      active.throwIfAborted();
      checkKey(credential.key);
      const config = parseApiConnectionConfig({
        provider,
        ...(credential.region === undefined ? {} : { region: credential.region }),
        ...(credential.workspace === undefined ? {} : { workspace: credential.workspace }),
      });
      const encrypted = await this.encryption.encrypt(JSON.stringify({ config, key: credential.key }));
      active.throwIfAborted();
      const value = JSON.stringify({ version: 1, config, ciphertext: encrypted.toString('base64') });
      if (Buffer.byteLength(value) > limit) throw new InvalidApiCredential();
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await atomicFile(this.file(provider), value, active);
    });
  }

  remove(provider: ApiProvider) {
    return this.change(() => rm(this.file(provider), { force: true }));
  }

  dispose() {
    this.lifetime.abort();
    return this.writes;
  }
}

// Verify inactive accounts as well as the current one before retiring a historical system key.
export async function readApiKeyRecords(root: string, decrypt: (value: Buffer) => Promise<string>) {
  let found = false;
  for await (const profile of storedProfileDirectories(root)) {
    const directory = path.join(profile, 'auth-data', 'api-keys');
    for (const candidate of [path.dirname(directory), directory]) {
      const stat = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (stat && (!stat.isDirectory() || await realpath(candidate) !== candidate))
        throw new InvalidApiCredential();
    }
    const files = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    const store = new ApiCredentialStore(profile);
    for (const file of files) {
      const provider = apiProviderIds.find(id => file.name === id + '.json');
      if (!file.isFile() || !provider || !(await store.read(provider, decrypt)))
        throw new InvalidApiCredential();
      found = true;
    }
  }
  return found;
}
