import { reasoningEfforts, type ReasoningEffort } from '../../contracts/chat';
import { record } from '../chat/models';
import { ChatServiceError } from '../chat/errors';
import { applyCatalogDefault, catalogModel, type ApiModel, type CatalogGet, type CompatibleApi } from './types';

const kimi = 'https://api.moonshot.cn/v1';
const glm = 'https://open.bigmodel.cn/api/paas/v4';
const ark = 'https://ark.cn-beijing.volces.com/api/v3';
// BigModel distinguishes billing, capacity and permissions inside the same HTTP status.
const glmErrors = new Map([
  ['1113', 'API 账户可用余额不足，请查看服务商账单。'],
  ['1211', '所选 API 模型当前不可用，请刷新模型列表。'],
  ['1220', 'API 账户无权访问该服务，请检查权限、地域与套餐。'],
  ['1302', 'API 服务已达到调用限额，请查看服务商用量或稍后重试。'],
  ['1305', '当前模型繁忙，请稍后重试。'],
  ['1308', 'API 账户已达到支出或用量上限，请查看服务商账单。'],
  ['1310', 'API 账户已达到支出或用量上限，请查看服务商账单。'],
  ['1311', 'API 账户无权访问该服务，请检查权限、地域与套餐。'],
  ['1315', '请使用智谱开放平台通用 API 密钥，此密钥仅适用于企业编程套餐。'],
]);
const specializedModel = /(?:^|[-_./])(?:image|audio|voice|video|realtime|ocr|asr|tts|embeddings?|rerank(?:er)?)(?:$|[-_./])|^(?:cogview|cogvideo|cogtts)/i;
// Ark accepts seven spellings for these models but maps them to four distinct behaviors.
const arkFourLevelModels = new Set([
  'doubao-seed-evolving',
  'doubao-seed-2-1-pro-260915',
  'doubao-seed-2-1-lite-260915',
  'doubao-seed-2-1-pro-260628',
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-2-0-lite-260428',
  'doubao-seed-2-0-mini-260428',
  'doubao-seed-2-0-pro-260215',
  'doubao-seed-2-0-lite-260215',
  'doubao-seed-2-0-mini-260215',
  'doubao-seed-2-0-code-preview-260215',
  'doubao-seed-character-260628',
]);

// Documented Chat API behaviors when the Ark catalog omits optional capability fields.
// Only describe IDs actually returned by the authenticated catalog.
function arkDocumentedEfforts(id: string): ReasoningEffort[] | undefined {
  if (arkFourLevelModels.has(id)) return ['none', 'low', 'medium', 'high'];
  if (id === 'glm-5-3-flash-260828' || id === 'kimi-k3-1-pro-261024')
    return ['low', 'high', 'max'];
  if ([
    'glm-5-2-260617', 'deepseek-v4-1-flash-261017', 'deepseek-v4-1-flash-260910',
    'deepseek-v4-1-flash-economy-261017', 'deepseek-v4-pro-ga-260813', 'deepseek-v4-flash-ga-260731',
  ].includes(id))
    return ['none', 'low', 'high', 'max'];
}

async function models(
  base: string,
  get: CatalogGet,
  describe: (model: ApiModel, row: Record<string, unknown>) => ApiModel | undefined,
) {
  const rows = record(await get(base + '/models'))?.data;
  if (!Array.isArray(rows)) throw Error('模型目录格式无效。');
  const result: ApiModel[] = [];
  for (const item of rows) {
    const row = record(item);
    if (!row || (row.object !== undefined && row.object !== 'model')) continue;
    const model = catalogModel(row.id, row.display_name);
    const entry = model && describe(model, row);
    if (entry) result.push(entry);
  }
  return result;
}
function thinking(_model: ApiModel, effort: ReasoningEffort) {
  if (effort === 'on' || effort === 'none')
    return { thinking: { type: effort === 'on' ? 'enabled' : 'disabled' } };
  return { reasoning_effort: effort };
}

export const chineseProviders: Record<'kimi' | 'glm' | 'doubao', CompatibleApi> = {
  kimi: {
    endpoint: () => kimi + '/chat/completions',
    models: (_, get) =>
      models(kimi, get, (model, row) => {
        if (specializedModel.test(model.id)) return;
        if (row.supports_reasoning !== false && /^kimi-k3(?:\.1-pro(?:-highspeed)?)?$/.test(model.id))
          model.reasoningEfforts = ['low', 'high', 'max'];
        if (row.supports_reasoning !== false && /^kimi-k2\.[56]$/.test(model.id))
          model.reasoningEfforts = ['none', 'on'];
        model.imageInput = typeof row.supports_image_in === 'boolean' ? row.supports_image_in :
          /vision|^kimi-k(?:3(?:\.1-pro(?:-highspeed)?)?|2\.[56])$/.test(model.id);
        return model;
      }),
    reasoning: thinking,
    replayTextHistory: (model) => /^kimi-(?:k3|k2\.7-code)/.test(model.id),
    failure(status, body) {
      if (status !== 429) return;
      const type = record(record(body)?.error)?.type;
      if (type === 'exceeded_current_quota_error')
        return new ChatServiceError({ status, code: type, message: 'Kimi 账户额度不足或已停用，请检查余额与账单。' });
      if (type === 'engine_overloaded_error')
        return new ChatServiceError({ status, code: type, message: 'Kimi 服务节点繁忙，请稍后重试。' });
    },
    async balance(_, get) {
      const response = record(await get(kimi + '/users/me/balance'));
      const data = record(response?.data);
      if (
        response?.code !== 0 ||
        !data ||
        ![data.available_balance, data.voucher_balance, data.cash_balance].every(Number.isFinite)
      )
        throw Error('服务商返回的余额格式无效。');
      return [
        {
          currency: 'CNY',
          total: String(data.available_balance),
          granted: String(data.voucher_balance),
          toppedUp: String(data.cash_balance),
        },
      ];
    },
  },
  glm: {
    endpoint: () => glm + '/chat/completions',
    models: (_, get) =>
      models(glm, get, (model) => {
        const id = model.id.toLowerCase();
        // These assistant models require a separate endpoint and an assistant_id.
        if (specializedModel.test(id) || id === 'glm-4-assistant' || id === 'glm-4-alltools') return;
        if (!/^(?:chat)?glm(?:$|[-_./])|(?:^|[-_./])(?:chat|text)(?:$|[-_./])/.test(id)) return;
        const multimodalFlash = /^glm-5\.3-(?:flash|flashx(?:-legal)?)$/.test(id);
        if (id === 'glm-5.3' || multimodalFlash)
          model.reasoningEfforts = ['low', 'high', 'max'];
        else if (id === 'glm-5.2') model.reasoningEfforts = ['none', 'high', 'max'];
        else if (
          /^glm-4\.(?:[567](?:-flashx?)?|5-(?:airx?|x)|[56]v(?:-flashx?)?)$/.test(id) ||
          /^glm-5(?:\.1|-turbo|v-turbo|-flashx?)?$/.test(id)
        )
          model.reasoningEfforts = ['none', 'on'];
        model.imageInput = /\dv(?:-|$)/.test(id) || multimodalFlash;
        return model;
      }),
    reasoning: thinking,
    streamUsage: () => false, // GLM includes usage in the final choices chunk.
    failure(status, body) {
      const raw = record(record(body)?.error)?.code;
      if (typeof raw !== 'string' && typeof raw !== 'number') return;
      const code = String(raw);
      const message = glmErrors.get(code);
      if (message) return new ChatServiceError({ status, code: code === '1211' ? 'model_not_found' : code, message });
    },
  },
  doubao: {
    endpoint: () => ark + '/chat/completions',
    // These hosted versions always report usage alongside finish_reason.
    streamUsage: ({ id }) => id !== 'deepseek-v4-1-flash-261017' && id !== 'deepseek-v4-1-flash-economy-261017',
    failure(status, body) {
      if (status !== 404) return;
      const code = record(record(body)?.error)?.code;
      if (code === 'ModelNotOpen')
        return new ChatServiceError({ status, code, message: '此模型尚未开通，请在火山方舟控制台开通模型服务后重试。' });
      if (code === 'InvalidEndpointOrModel.ModelIDAccessDisabled')
        return new ChatServiceError({ status, code, message: '当前方舟账号仅允许通过自建推理接入点调用。此连接需要基础模型 ID 的调用权限。' });
    },
    models: (_, get) =>
      models(ark, get, (model, row) => {
        const modalities = record(row.modalities);
        const output = modalities?.output_modalities;
        const input = modalities?.input_modalities;
        const supported = record(row.api_supported);
        const documented = arkDocumentedEfforts(model.id);
        if (
          /^doubao-seed-translation(?:-|$)/.test(model.id) ||
          (row.status !== undefined && row.status !== 'Published' && row.status !== 'Retiring') ||
          supported?.chat_completions === false ||
          (output !== undefined && (!Array.isArray(output) || !output.includes('text'))) ||
          (input !== undefined && (!Array.isArray(input) || !input.includes('text')))
        )
          return;
        const tasks = Array.isArray(row.task_type) ? row.task_type : [];
        const textModalities = Array.isArray(input) && Array.isArray(output);
        const chatTask = tasks.includes('Chat') || tasks.includes('TextGeneration') ||
          (tasks.includes('VisualQuestionAnswering') && textModalities);
        const textChat = tasks.length ? chatTask :
          supported?.chat_completions === true || textModalities || row.domain === 'LLM' ||
          documented || model.id === 'doubao-seed-character-251128';
        if (!textChat) return;
        model.imageInput = Array.isArray(input) && input.includes('image');
        const thinkingType = record(record(row.features)?.thinking)?.type;
        if (thinkingType === 'disabled') return model;
        const catalogEffort = record(row.effort);
        const declared = catalogEffort?.supported_levels;
        const levels = new Set(Array.isArray(declared) ? declared : documented);
        if (arkFourLevelModels.has(model.id)) {
          if (levels.delete('minimal')) levels.add('none');
          if (levels.has('xhigh') || levels.has('max')) levels.add('high');
          levels.delete('xhigh');
          levels.delete('max');
        }
        const efforts = (documented ?? reasoningEfforts).filter((effort) => effort !== 'on' && levels.has(effort));
        if (documented?.includes('none') && !efforts.includes('none')) efforts.unshift('none');
        model.reasoningEfforts = efforts;
        applyCatalogDefault(model, catalogEffort, efforts);
        return model;
      }),
    reasoning(model, effort) {
      if (effort === 'none' && arkDocumentedEfforts(model.id)?.includes('none'))
        return { thinking: { type: 'disabled' } };
      return { reasoning_effort: effort };
    },
  },
};
