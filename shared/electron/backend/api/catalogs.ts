import { qwenRegionRoutes, type ApiBalance } from '../../contracts/apiConnections';
import type { ReasoningEffort } from '../../contracts/chat';
import { advertisedEfforts, invalidCatalog, record } from '../chat/models';
import { ChatServiceError } from '../chat/errors';
import {
  applyCatalogDefault, catalogModel,
  type ApiCredential,
  type ApiModel,
  type CatalogGet,
  type CompatibleApi,
} from './types';

const google = 'https://generativelanguage.googleapis.com/v1beta';
const deepseek = 'https://api.deepseek.com';
export const claude = 'https://api.anthropic.com/v1';

function entries(value: unknown) {
  if (!Array.isArray(value)) throw invalidCatalog();
  return value.map(record).filter((item) => item !== undefined);
}

function has(value: unknown, member: string) {
  return Array.isArray(value) && value.includes(member);
}

export function claudeHeaders(credential: ApiCredential): Record<string, string> {
  return {
    'anthropic-version': '2026-10-21',
    ...(credential.workspace ? { 'anthropic-workspace-id': credential.workspace } : {}),
  };
}

export async function claudeModels(credential: ApiCredential, get: CatalogGet) {
  const models: ApiModel[] = [];
  const seen = new Set<string>();
  let cursor = '';
  for (let page = 0; page < 32; page++) {
    const url = new URL(claude + '/models');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('after_id', cursor);
    const data = record(await get(url.href, claudeHeaders(credential)));
    for (const item of entries(data?.data)) {
      const model = catalogModel(item.id, item.display_name);
      if (!model) continue;
      const caps = record(item.capabilities);
      const effort = record(caps?.effort);
      const supported = (value: unknown) => record(value)?.supported === true;
      const types = record(record(caps?.thinking)?.types);
      model.adaptiveThinking = supported(types?.adaptive);
      model.reasoningEfforts = advertisedEfforts(
        Object.keys(effort ?? {}).filter((key) => supported(effort?.[key])),
      );
      if (!model.reasoningEfforts.length && (model.adaptiveThinking || supported(types?.enabled)))
        model.reasoningEfforts.push('on');
      if (supported(types?.disabled)) model.reasoningEfforts.unshift('none');
      model.imageInput = supported(caps?.image_input);
      model.pdfInput = supported(caps?.pdf_input);
      if (Number.isSafeInteger(item.max_tokens) && Number(item.max_tokens) > 0)
        model.maxOutput = Number(item.max_tokens);
      models.push(model);
    }
    if (data?.has_more !== true) return models;
    const next = data.last_id;
    if (typeof next !== 'string' || !next || next.length > 200 || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  throw invalidCatalog();
}

function geminiEfforts(id: string): ReasoningEffort[] {
  if (/^gemini-2\.5-flash(?:$|-)/.test(id)) return ['none', 'low', 'medium', 'high'];
  if (/^gemini-3-pro(?:$|-)/.test(id)) return ['low', 'high'];
  if (/^gemini-(?:2\.5-pro|3\.1-pro|3\.8-flash|4-(?:carbon|argon))(?:$|-)/.test(id))
    return ['low', 'medium', 'high'];
  if (/^gemini-(?:3(?:\.6)?-flash|3\.(?:1|5)-flash-lite)(?:$|-)/.test(id))
    return ['minimal', 'low', 'medium', 'high'];
  if (/^gemini-4-(?:neon|hydrogen)(?:$|-)/.test(id)) return ['low', 'medium', 'high', 'xhigh'];
  return [];
}

function googleSpecialist(id: string) {
  return /^(?:imagen|veo|lyria|genie|deep-research|antigravity|embedding|text-embedding|aqa)(?:-|$)/.test(id) ||
    /^gemini-(?:embedding|nano-banana|robotics|decision)(?:-|$)|^gemini-omni-1(?:[.-]|$)/.test(id) ||
    (id.startsWith('gemini-') && /-(?:tts|live|transcribe|computer-use|audio)(?:-|$)|-image(?:$|-(?:generation|preview|exp|\d{2,4})(?:-|$))/.test(id));
}

function googleVision(id: string) {
  // Versioned previews and dated snapshots inherit the documented base model's inputs.
  const family = id.replace(/-(?:preview|exp|latest|\d{3})(?:-\d{2,4})*$/, '');
  return /^gemini-(?:1\.5-(?:flash(?:-8b)?|pro)|2\.[05]-(?:flash(?:-lite)?|pro)|3(?:\.1)?-pro|3(?:\.[68])?-flash|3\.[15]-flash-lite|4-(?:carbon|argon|neon|hydrogen))$/.test(family) ||
    /^gemma-4-(?:26b-a4b|31b)-it$/.test(family);
}

function googleModalities(value: unknown) {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string').map(item => item.toLowerCase());
}

const geminiApi: CompatibleApi = {
  endpoint: () => google + '/openai/chat/completions',
  failure(status, body) {
    const details = record(record(body)?.error)?.details;
    if (Array.isArray(details) && details.some((item) => {
      const detail = record(item);
      return detail?.domain === 'googleapis.com' && detail.reason === 'API_KEY_INVALID';
    })) {
      return new ChatServiceError({ status, code: 'API_KEY_INVALID', message: 'Gemini API 密钥无效，请在 Google AI Studio 检查或更换密钥。' });
    }
  },
  async models(credential, get) {
    const models: ApiModel[] = [];
    const cursors = new Set<string>();
    let token = '';
    for (let page = 0; page < 32; page++) {
      const url = new URL(google + '/models');
      url.searchParams.set('pageSize', '100');
      if (token) url.searchParams.set('pageToken', token);
      const data = record(await get(url.href, { 'x-goog-api-key': credential.key }));
      for (const entry of entries(data?.models)) {
        const id = typeof entry.name === 'string' ? entry.name.replace(/^models\//, '') : '';
        const model = catalogModel(id, entry.displayName);
        const baseId = typeof entry.baseModelId === 'string' ? entry.baseModelId : '';
        const input = googleModalities(entry.inputModalities);
        const output = googleModalities(entry.outputModalities);
        if (
          !model ||
          !has(entry.supportedGenerationMethods, 'generateContent') ||
          googleSpecialist(id) || googleSpecialist(baseId) ||
          (input && !input.includes('text')) || (output && !output.includes('text'))
        )
          continue;
        model.imageInput = input ? input.includes('image') : googleVision(id) || googleVision(baseId);
        // A version alias can be advertised under a concrete baseModelId. An
        // explicit negative capability always takes precedence over the family.
        if (entry.thinking !== false) {
          model.reasoningEfforts = geminiEfforts(id);
          if (!model.reasoningEfforts.length) model.reasoningEfforts = geminiEfforts(baseId);
        }
        models.push(model);
      }
      if (!data?.nextPageToken) return models;
      if (
        typeof data.nextPageToken !== 'string' ||
        data.nextPageToken.length > 2048 ||
        cursors.has(data.nextPageToken)
      )
        break;
      token = data.nextPageToken;
      cursors.add(token);
    }
    throw invalidCatalog();
  },
  reasoning: (_model, effort) => ({ reasoning_effort: effort }),
};

function qwenHost({ region = 'beijing', workspace }: ApiCredential) {
  const endpoints = qwenRegionRoutes[region];
  if (!endpoints) throw Error('百炼服务地域无效。');
  if (workspace) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workspace))
      throw Error('百炼业务空间 ID 无效。');
    return 'https://' + workspace + '.' + endpoints.zone + '.maas.aliyuncs.com';
  }
  if (!endpoints.sharedHost) throw Error('该地域需要填写百炼业务空间 ID。');
  return 'https://' + endpoints.sharedHost;
}

function qwenEfforts(id: string): ReasoningEffort[] {
  if (/^qwen4-max(?:$|-)/.test(id)) return ['none', 'low', 'high', 'xhigh'];
  if (/^qwen3\.8-2\.4t-a95b(?:$|-)/.test(id)) return ['low', 'medium', 'xhigh'];
  if (/^qwen3\.8-(?:max|flash|27b|omni-flash)(?:$|-)/.test(id))
    return ['none', 'low', 'medium', 'xhigh'];
  if (/^qwen3\.7-max-(?:preview|2026-05-17)$/.test(id)) return [];
  if (/^qwen3\.6-35b-a3b$|^qwen3\.5-(?:27b|122b-a10b|397b-a17b)$/.test(id)) return ['none', 'on'];
  if (/^qwen3\.[567]-(?:plus|max|flash)(?:$|-)/.test(id)) return ['none', 'on'];
  const legacy = /^qwen-(plus|flash)(?:-(latest|\d{4}-\d{2}-\d{2}))?$/.exec(id);
  if (legacy && (!legacy[2] || legacy[2] === 'latest' ||
    legacy[2] >= (legacy[1] === 'plus' ? '2025-04-28' : '2025-07-28'))) return ['none', 'on'];
  return [];
}

const qwenApi: CompatibleApi = {
  endpoint: (credential) => qwenHost(credential) + '/compatible-mode/v1/chat/completions',
  async models(credential, get) {
    const models: ApiModel[] = [];
    let received = 0;
    // The List Models reference specifies the shared regional host for Virginia.
    const host =
      credential.region === 'virginia' ? 'https://' + qwenRegionRoutes.virginia.sharedHost : qwenHost(credential);
    for (let page = 1; page <= 64; page++) {
      const url = new URL(host + '/api/v1/models');
      url.searchParams.set('providers', 'qwen');
      url.searchParams.set('capabilities', 'TG');
      url.searchParams.set('page_no', String(page));
      url.searchParams.set('page_size', '50');
      const result = record(await get(url.href));
      const output = record(result?.output);
      if (result?.success === false || result?.code != null ||
        (output?.page_no !== undefined && output.page_no !== page)) throw invalidCatalog();
      const rows = entries(output?.models);
      for (const entry of rows) {
        const model = catalogModel(entry.model, entry.name);
        // Filter on the server: the documented response may omit both filter fields.
        if (!model || (entry.provider !== undefined && entry.provider !== 'qwen') ||
          (entry.capabilities !== undefined && !has(entry.capabilities, 'TG'))) continue;
        // These use a different protocol, billing endpoint or task-specific message format.
        if (model.id === 'qwen4-max-preview' || model.id === 'qwen3-omni-30b-a3b-captioner' ||
          /(?:^|-)realtime(?:-|$)|^qwen-mt-|^qwen(?:-vl|3\.5)-ocr(?:-|$)/.test(model.id)) continue;
        const io = record(entry.inference_metadata);
        if ((io?.request_modality !== undefined && !has(io.request_modality, 'Text')) ||
          (io?.response_modality !== undefined && !has(io.response_modality, 'Text')))
          continue;
        model.imageInput = has(io?.request_modality, 'Image');
        model.reasoningEfforts = entry.capabilities === undefined || has(entry.capabilities, 'Reasoning')
          ? qwenEfforts(model.id) : [];
        models.push(model);
      }
      received += rows.length;
      const total = output?.total;
      if (total !== undefined) {
        if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw invalidCatalog();
        if (received >= total) return models;
        if (!rows.length) throw invalidCatalog();
      } else if (rows.length < 50) return models;
    }
    throw invalidCatalog();
  },
  reasoning: (_model, effort) =>
    effort === 'none' || effort === 'on'
      ? { enable_thinking: effort === 'on' }
      : { enable_thinking: true, reasoning_effort: effort },
  // VoxCue replays public assistant messages and never retains private reasoning.
  historyOptions: ({ id }) => /^(?:qwen4-max|qwen3\.8-(?:max(?:-0902)?|flash|omni-flash))$/.test(id)
    ? { preserve_thinking: false } : {},
};

function amount(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d{1,20}(?:\.\d{1,16})?$/.test(value);
}

const deepseekApi: CompatibleApi = {
  endpoint: () => deepseek + '/chat/completions',
  async models(_credential, get) {
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
  reasoning: (_model, effort) =>
    effort === 'none'
      ? { thinking: { type: 'disabled' } }
      : { thinking: { type: 'enabled' }, reasoning_effort: effort },
  async balance(_credential, get): Promise<ApiBalance[]> {
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

export const compatibleApis = { gemini: geminiApi, qwen: qwenApi, deepseek: deepseekApi };
