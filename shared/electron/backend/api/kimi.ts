import type { ApiBalance } from '../../contracts/apiConnections';
import type { ModelProvider } from '../../contracts/chat';
import { publicWebSearchInstructions } from '../chat/input';
import { invalidCatalog, record, type OpenAIModel } from '../chat/models';
import type { CatalogGet } from './types';

const base = 'https://api.moonshot.cn/v1';
// The models endpoint also lists models that only speak Chat Completions.
const labels = new Map([
  ['kimi-k3.1-pro', 'Kimi K3.1 Pro'],
  ['kimi-k3.1-pro-highspeed', 'Kimi K3.1 Pro Highspeed'],
  ['kimi-k3', 'Kimi K3'],
]);

export const kimiApi = {
  base,
  webSearchInstructions: publicWebSearchInstructions,
  profileRecovery: 'preview' as const,
  models(payload: unknown, provider: ModelProvider): OpenAIModel[] {
    const rows = record(payload)?.data;
    if (!Array.isArray(rows)) throw invalidCatalog();
    const models = new Map<string, OpenAIModel>();
    for (const row of rows) {
      const entry = record(row);
      if (!entry || typeof entry.id !== 'string' || (entry.object !== undefined && entry.object !== 'model')) continue;
      const label = labels.get(entry.id);
      if (!label || models.has(entry.id)) continue;
      models.set(entry.id, {
        id: entry.id, label, provider, description: '',
        imageInput: entry.supports_image_in !== false, fileInput: false,
        reasoningEfforts: entry.supports_reasoning === false ? [] : ['low', 'high', 'max'],
        defaultReasoningEffort: entry.supports_reasoning === false ? undefined : 'max',
        // Keep strict decoding: with long reasoning, prompt-only schemas returned plain prose instead of JSON.
        reasoningSummary: false, nativeProfileFormat: true, webSearch: true,
      });
    }
    return [...models.values()];
  },
  async balance(get: CatalogGet): Promise<ApiBalance[]> {
    const response = record(await get(base + '/users/me/balance'));
    const data = record(response?.data);
    if (response?.code !== 0 || !data ||
        ![data.available_balance, data.voucher_balance, data.cash_balance].every(Number.isFinite))
      throw Error('服务商返回的余额格式无效。');
    return [{
      currency: 'CNY', total: String(data.available_balance),
      granted: String(data.voucher_balance), toppedUp: String(data.cash_balance),
    }];
  },
};
