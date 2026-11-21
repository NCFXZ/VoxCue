import type { ApiKeyField, ApiKeyPromptCommand } from './presentation';
export type { ApiKeyField, ApiKeyPromptCommand } from './presentation';

/** Public connection metadata. Only the main process handles credentials. */
export const apiProviders = {
  openai: { name: 'OpenAI API', recipient: 'OpenAI', balance: false },
  anthropic: { name: 'Claude API', recipient: 'Anthropic', balance: false },
  gemini: { name: 'Gemini API', recipient: 'Google', balance: false },
  qwen: { name: '通义千问', recipient: '阿里云百炼', balance: false },
  deepseek: { name: 'DeepSeek', recipient: 'DeepSeek', balance: true },
  kimi: { name: 'Kimi', recipient: '月之暗面', balance: true },
  glm: { name: '智谱 GLM', recipient: '智谱 AI', balance: false },
  doubao: { name: '豆包', recipient: '火山方舟', balance: false },
} as const;
export type ApiProvider = keyof typeof apiProviders;
export const apiProviderIds = Object.keys(apiProviders) as ApiProvider[];
export function isApiProvider(value: unknown): value is ApiProvider {
  return typeof value === 'string' && Object.hasOwn(apiProviders, value);
}
export const qwenRegionRoutes = {
  beijing: { name: '北京', zone: 'cn-beijing', sharedHost: 'dashscope.aliyuncs.com' },
  singapore: { name: '新加坡', zone: 'ap-southeast-1', sharedHost: 'dashscope-intl.aliyuncs.com' },
  virginia: { name: '弗吉尼亚', zone: 'us-east-1', sharedHost: 'dashscope-us.aliyuncs.com' },
  tokyo: { name: '东京', zone: 'ap-northeast-1', sharedHost: null },
  hongkong: { name: '香港', zone: 'cn-hongkong', sharedHost: 'cn-hongkong.dashscope.aliyuncs.com' },
  frankfurt: { name: '法兰克福', zone: 'eu-central-1', sharedHost: null },
} as const;
export type QwenRegion = keyof typeof qwenRegionRoutes;
export const qwenRegions = Object.keys(qwenRegionRoutes) as QwenRegion[];
export function qwenRequiresWorkspace(region: QwenRegion) {
  return qwenRegionRoutes[region].sharedHost === null;
}
export interface ApiConnectionConfig {
  provider: ApiProvider;
  region?: QwenRegion;
  workspace?: string;
}
export function parseApiConnectionConfig(value: unknown): ApiConnectionConfig {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['provider', 'region', 'workspace'].includes(key))
  )
    throw Error('API 连接配置无效。');
  const { provider, region, workspace } = value as Partial<ApiConnectionConfig>;
  if (!isApiProvider(provider)) throw Error('API 服务无效。');
  if (region !== undefined && (provider !== 'qwen' || !qwenRegions.includes(region)))
    throw Error('API 服务地域无效。');
  if (
    workspace !== undefined &&
    (typeof workspace !== 'string' ||
      !['qwen', 'anthropic'].includes(provider) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(workspace) ||
      (provider === 'qwen' && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(workspace)))
  )
    throw Error('工作空间 ID 无效。');
  if (region && qwenRequiresWorkspace(region) && !workspace) throw Error('该地域需要填写百炼业务空间 ID。');
  return {
    provider,
    ...(provider === 'qwen' && { region: region ?? 'beijing' }),
    ...(workspace && { workspace }),
  };
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
