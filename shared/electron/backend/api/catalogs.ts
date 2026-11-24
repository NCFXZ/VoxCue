import type { ApiBalance } from '../../contracts/apiConnections';
import type { ReasoningEffort } from '../../contracts/chat';
import { advertisedEfforts, invalidCatalog, record } from '../chat/models';
import { applyCatalogDefault, catalogModel, type CatalogGet } from './types';

const deepseek = 'https://api.deepseek.com';

function entries(value: unknown) {
  if (!Array.isArray(value)) throw invalidCatalog();
  return value.map(record).filter(item => item !== undefined);
}

function has(value: unknown, member: string) {
  return Array.isArray(value) && value.includes(member);
}

function amount(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d{1,20}(?:\.\d{1,16})?$/.test(value);
}

export const deepseekApi = {
  endpoint: deepseek + '/chat/completions',
  async models(get: CatalogGet) {
    const data = record(await get(deepseek + '/models'));
    return entries(data?.data).flatMap((entry) => {
      const model = catalogModel(entry.id, entry.name);
      if (
        !model ||
        (entry.input_modalities && !has(entry.input_modalities, 'text')) ||
        (entry.output_modalities && !has(entry.output_modalities, 'text'))
      )
        return [];
      const effort = record(entry.effort);
      model.imageInput = has(entry.input_modalities, 'image');
      if (effort) {
        const enabled = advertisedEfforts(effort.supported_levels).filter(
          (item) => item !== 'none' && item !== 'on',
        );
        if (enabled.length) {
          model.reasoningEfforts = ['none', ...enabled];
          applyCatalogDefault(model, effort, enabled);
        }
      }
      return [model];
    });
  },
  reasoning: (effort: ReasoningEffort) =>
    effort === 'none'
      ? { thinking: { type: 'disabled' } }
      : { thinking: { type: 'enabled' }, reasoning_effort: effort },
  async balance(get: CatalogGet): Promise<ApiBalance[]> {
    const data = record(await get(deepseek + '/user/balance'));
    if (
      !Array.isArray(data?.balance_infos) ||
      !data.balance_infos.length ||
      data.balance_infos.length > 16
    )
      throw Error('DeepSeek 余额响应无效。');
    return data.balance_infos.map((value) => {
      const item = record(value);
      if (
        !item ||
        !['CNY', 'USD'].includes(String(item.currency)) ||
        !amount(item.total_balance) ||
        !amount(item.granted_balance) ||
        !amount(item.topped_up_balance)
      )
        throw Error('DeepSeek 余额响应无效。');
      return {
        currency: String(item.currency),
        total: item.total_balance,
        granted: item.granted_balance,
        toppedUp: item.topped_up_balance,
      };
    });
  },
};
