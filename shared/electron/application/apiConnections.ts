import {
  apiProviders,
  type ApiBalance,
  type ApiConnectionConfig,
  type ApiProvider,
} from '../contracts/apiConnections';
import type { AuthSession } from '../contracts/auth';
import type { AIChatService } from '../backend/chat/ports';
import { publicFailure } from '../backend/chat/errors';
import type { ApiCredentialStore } from '../backend/api/credentials';
import type { ApiCredential } from '../backend/api/types';

type ApiChat = AIChatService & { invalidateModels(): void };
function credentialFailure(error: unknown): never {
  if (error instanceof Error && 'path' in error) throw Error('无法访问本机 API 密钥记录。');
  throw error;
}
interface AdapterPorts {
  chat(provider: ApiProvider, credential: () => Promise<ApiCredential>): ApiChat;
  balance(
    provider: ApiProvider,
    credential: ApiCredential,
    signal: AbortSignal,
  ): Promise<ApiBalance[]>;
}

/** One instance per VoxCue profile. Only verified replacements reach the credential store. */
export class ProfileApiConnections {
  private readonly services = new Map<ApiProvider, ApiChat>();
  private readonly lifetime = new AbortController();
  private mutation?: ApiProvider;
  constructor(
    private store: Pick<ApiCredentialStore, 'list' | 'read' | 'save' | 'remove' | 'dispose'>,
    private adapters: AdapterPorts,
  ) {}

  list() {
    return this.store.list().catch(credentialFailure);
  }
  busy(provider: ApiProvider) {
    return this.mutation === provider;
  }
  async session(provider: ApiProvider): Promise<AuthSession | null> {
    if (!(await this.list()).some((entry) => entry.provider === provider)) return null;
    return {
      mode: provider,
      user: { id: provider, name: apiProviders[provider].name, email: '' },
      expiresAt: null,
    };
  }
  private async credential(provider: ApiProvider) {
    this.lifetime.signal.throwIfAborted();
    const credential = await this.store.read(provider).catch(credentialFailure);
    this.lifetime.signal.throwIfAborted();
    if (!credential) throw Error('请先配置该服务的 API 密钥。');
    return credential;
  }
  chat(provider: ApiProvider) {
    let service = this.services.get(provider);
    if (!service) {
      service = this.adapters.chat(provider, () => this.credential(provider));
      this.services.set(provider, service);
    }
    return service;
  }
  private async change<T>(provider: ApiProvider, action: () => Promise<T>) {
    if (this.mutation) throw Error('API 密钥操作正在进行。');
    this.lifetime.signal.throwIfAborted();
    this.mutation = provider;
    try {
      return await action();
    } finally {
      this.mutation = undefined;
    }
  }
  configure(
    config: ApiConnectionConfig,
    prompt: (signal: AbortSignal) => Promise<string | null>,
    check: () => void,
    ownerSignal: AbortSignal,
  ) {
    return this.change(config.provider, async () => {
      const signal = AbortSignal.any([this.lifetime.signal, ownerSignal]);
      const key = await prompt(signal);
      signal.throwIfAborted();
      if (key === null) return false;
      if (!/^[\x21-\x7e]{1,4096}$/.test(key)) return { inputError: 'API 密钥格式无效。' };
      const { provider, ...settings } = config;
      const credential: ApiCredential = { ...settings, key };
      const candidate = this.adapters.chat(provider, async () => credential);
      try {
        const models = await candidate.models(true, signal);
        if (!models.length) return { inputError: '服务商的目录未返回 VoxCue 支持的对话模型。' };
      } catch (error) {
        signal.throwIfAborted();
        return { inputError: publicFailure(error).message };
      } finally {
        candidate.invalidateModels();
      }
      signal.throwIfAborted();
      check();
      await this.store.save(provider, credential, signal).catch(credentialFailure);
      this.services.get(provider)?.invalidateModels();
      return true;
    });
  }
  remove(provider: ApiProvider) {
    return this.change(provider, async () => {
      await this.store.remove(provider).catch(credentialFailure);
      this.services.get(provider)?.invalidateModels();
    });
  }
  async balance(provider: ApiProvider) {
    if (!apiProviders[provider].balance) throw Error('请前往官方账单查看余额。');
    return this.adapters.balance(provider, await this.credential(provider), this.lifetime.signal);
  }
  invalidateModels() {
    for (const service of this.services.values()) service.invalidateModels();
  }
  dispose() {
    this.lifetime.abort();
    this.invalidateModels();
    return this.store.dispose();
  }
}
