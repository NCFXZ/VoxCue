import { chatGPTProvider, reasoningEfforts, type ChatModel, type ReasoningEffort } from '../../contracts/chat';
import { ChatServiceError } from './errors';

export type OpenAIAccess = { token: string; account: string } & (
  | { kind: 'codex'; chatgptAccountId: string; runtimeVersion: string }
  | { kind: 'api-key' }
);

export interface OpenAIModel extends ChatModel {
  imageInput?: boolean;
  fileInput?: boolean;
  reasoningSummary: boolean;
  nativeProfileFormat: boolean;
  webSearch?: boolean;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function modelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 160 &&
    !/[^\w./:-]/.test(value)
  );
}

export function modelLabel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 120 &&
    !!value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function advertisedEfforts(value: unknown) {
  if (!Array.isArray(value)) return [];
  const levels = new Set(value.map((item) => record(item)?.effort ?? item));
  return reasoningEfforts.filter((effort) => levels.has(effort));
}

export function invalidCatalog() {
  return new ChatServiceError({
    code: 'invalid_model_catalog',
    message: '模型列表响应无效，请重试。',
  });
}

function meetsMinimumVersion(runtime: string, minimum: unknown) {
  if (minimum == null) return true;
  const stable = /^\d{1,8}\.\d{1,8}\.\d{1,8}$/;
  const required =
    typeof minimum === 'string' && stable.test(minimum) ? minimum.split('.').map(Number) : minimum;
  if (
    !stable.test(runtime) ||
    !Array.isArray(required) ||
    required.length !== 3 ||
    !required.every((part) => Number.isSafeInteger(part) && part >= 0)
  ) return false;
  const actual = runtime.split('.').map(Number);
  for (let i = 0; i < required.length; i++) {
    if (actual[i] !== required[i]) return actual[i] > required[i];
  }
  return true;
}

// The public Models endpoint commonly returns only IDs. Match documented model
// families precisely, keeping new text models usable with their own defaults.
function publicModelEfforts(family: string): ReasoningEffort[] {
  if (/^gpt-5(?:-mini|-nano)?$/.test(family)) return ['minimal', 'low', 'medium', 'high'];
  if (family === 'gpt-5-pro') return ['high'];
  if (/^gpt-5\.(?:2|4)-pro$/.test(family)) return ['medium', 'high', 'xhigh'];
  if (family === 'gpt-5.1') return ['none', 'low', 'medium', 'high'];
  if (/^gpt-5\.(?:2|4(?:-mini|-nano)?|5)$/.test(family)) return ['none', 'low', 'medium', 'high', 'xhigh'];
  if (/^(?:gpt-5\.6(?:-sol)?|gpt-6-luna|gpt-6\.1-terra)$/.test(family)) return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (/^gpt-6(?:-astra|\.1-sol|\.2-(?:sol|astra))$/.test(family)) return ['low', 'medium', 'high', 'xhigh', 'max'];
  if (/^(?:o1|o3|o3-mini|o4-mini)$/.test(family)) return ['low', 'medium', 'high'];
  return [];
}

export function openAIModels(payload: unknown, access: OpenAIAccess, provider = chatGPTProvider): OpenAIModel[] {
  const apiKey = access.kind === 'api-key';
  const entries = record(payload)?.[apiKey ? 'data' : 'models'];
  if (!Array.isArray(entries)) throw invalidCatalog();
  const seen = new Set<string>();
  const models: OpenAIModel[] = [];
  for (const value of entries) {
    const entry = record(value);
    if (!entry) continue;
    const id = apiKey ? entry.id : entry.slug;
    const label =
      apiKey && !modelLabel(entry.display_name) && typeof id === 'string'
        ? id.slice(0, 120)
        : entry.display_name;
    if (
      !modelId(id) ||
      !modelLabel(label) ||
      seen.has(id) ||
      (!apiKey && entry.visibility !== 'list') ||
      (apiKey && entry.visibility !== undefined && entry.visibility !== 'list') ||
      (access.kind === 'codex' && !meetsMinimumVersion(access.runtimeVersion, entry.minimal_client_version)) ||
      entry.available === false
    )
      continue;
    if (apiKey) {
      // Fine-tuned IDs include an organization and a freely chosen suffix.
      const baseId = id.startsWith('ft:') ? id.split(':', 2)[1] : id;
      if (!baseId || /(?:^|-)(?:embedding|moderation|audio|realtime|transcribe|tts|whisper|image|search-preview|search-api|instruct|deep-research)(?:-|$)|^gpt-live(?:-|$)|^(?:dall-e|sora|babbage|davinci|computer-use)/.test(baseId))
        continue;
      // These Responses models accept non-streaming requests only.
      if (/^(?:o[13]-pro|gpt-5\.5-pro)(?:-\d{4}-\d{2}-\d{2})?$/.test(baseId)) continue;
      if (Array.isArray(entry.output_modalities) && !entry.output_modalities.includes('text')) continue;
    }
    const family = id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
    const publicVisionAndSearch = apiKey && /^(?:gpt-5-pro|gpt-5\.(?:[24]-pro|4|5)|gpt-6-luna|gpt-6\.1-terra|gpt-6\.2-(?:sol|astra))$/.test(family);
    const reasoningEfforts = apiKey && entry.supported_reasoning_levels === undefined
      ? publicModelEfforts(family) : advertisedEfforts(entry.supported_reasoning_levels);
    const modalities = entry.input_modalities;
    if (Array.isArray(modalities) && !modalities.includes('text')) continue;
    seen.add(id);
    const summary = entry.supports_reasoning_summary_parameter;
    models.push({
      id,
      label,
      description: apiKey ? 'OpenAI API 模型' : 'ChatGPT 账户可用模型',
      provider,
      reasoningEfforts,
      // New ID-only models can still propose profile edits using the schema in the prompt.
      nativeProfileFormat: !apiKey || (
        id !== 'gpt-4o-2024-05-13' && (
          /^(?:gpt-4o(?:-mini)?|gpt-4\.1(?:-mini|-nano)?|o1|o3(?:-mini)?|o4-mini)$/.test(family) ||
          /^gpt-5(?:-pro|-mini|-nano|\.1|\.2|\.4(?:-mini|-nano)?|\.5|\.6-(?:terra|luna|sol))?$/.test(family) ||
          /^gpt-6(?:-(?:luna|sol|astra)|\.1-(?:sol|terra)|\.2-(?:sol|astra))$/.test(family)
        )
      ),
      // Codex omits this field when true. Require actual reasoning metadata as well.
      reasoningSummary:
        summary === true ||
        (access.kind === 'codex' &&
          summary === undefined &&
          reasoningEfforts.some((effort) => effort !== 'none')),
      imageInput: Array.isArray(modalities) ? modalities.includes('image') : publicVisionAndSearch || undefined,
      webSearch:
        entry.web_search_tool_type === 'text' || entry.web_search_tool_type === 'text_and_image' ||
          (entry.web_search_tool_type === undefined && publicVisionAndSearch)
          ? true
          : undefined,
    });
  }
  return models;
}
