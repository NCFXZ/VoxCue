import type { ApiKeyField, ApiKeyPromptCommand } from './presentation';
export type { ApiKeyField, ApiKeyPromptCommand } from './presentation';

/** Public connection metadata. Only the main process handles credentials. */
export const apiProviders = {
  openai: { name: 'OpenAI API', recipient: 'OpenAI', balance: false },
  deepseek: { name: 'DeepSeek', recipient: 'DeepSeek', balance: true },
} as const;
export type ApiProvider = keyof typeof apiProviders;
export const apiProviderIds = Object.keys(apiProviders) as ApiProvider[];
export function isApiProvider(value: unknown): value is ApiProvider {
  return typeof value === 'string' && Object.hasOwn(apiProviders, value);
}

// Historical IDs only, shared by upgrade cleanup and answer attribution.
export const retiredApiProviderIds = ['anthropic', 'gemini', 'kimi', 'glm', 'doubao', 'qwen'] as const;
const retiredApiProviders: ReadonlySet<string> = new Set(retiredApiProviderIds);
export function isRetiredApiProvider(value: unknown): boolean {
  return typeof value === 'string' && retiredApiProviders.has(value);
}

export interface ApiConnectionConfig {
  provider: ApiProvider;
}
export function parseApiConnectionConfig(value: unknown): ApiConnectionConfig {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 || !Object.hasOwn(value, 'provider')
  )
    throw Error('API 连接配置无效。');
  const { provider } = value as Partial<ApiConnectionConfig>;
  if (!isApiProvider(provider)) throw Error('API 服务无效。');
  return { provider };
}
export interface ApiBalance {
  currency: string;
  total: string;
  granted?: string;
  toppedUp?: string;
}
export interface ApiConnections {
  list(): Promise<ApiConnectionConfig[]>;
  configure(config: ApiConnectionConfig, requestId: string, field: ApiKeyField): Promise<boolean | { inputError: string }>;
  control(requestId: string, command: ApiKeyPromptCommand): Promise<void>;
  onTab(callback: (requestId: string, backwards: boolean) => void): () => void;
  remove(provider: ApiProvider): Promise<void>;
  balance(provider: ApiProvider): Promise<ApiBalance[]>;
  open(provider: ApiProvider, destination: 'keys' | 'billing'): Promise<void>;
}
