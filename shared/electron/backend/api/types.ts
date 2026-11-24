import type { ChatModel, ReasoningEffort } from '../../contracts/chat';
import { modelId, modelLabel } from '../chat/models';
import type { AIChatService } from '../chat/ports';

// Never crosses the preload boundary.
export interface ApiCredential {
  key: string;
}

export interface ApiChatService extends AIChatService {
  invalidateModels(): void;
}

export interface ApiModel extends ChatModel {
  imageInput?: boolean;
}

export type CatalogGet = (url: string) => Promise<unknown>;

export function catalogModel(id: unknown, label?: unknown): ApiModel | undefined {
  if (!modelId(id)) return;
  return { id, label: modelLabel(label) ? label : id.slice(0, 120), description: '' };
}

export function applyCatalogDefault(
  model: ApiModel, effort: Record<string, unknown> | undefined, selectable: readonly ReasoningEffort[],
) {
  const declared = effort?.supported_levels;
  if (!Array.isArray(declared) || !declared.includes(effort?.default_level)) return;
  const reported = selectable.find((level) => level === effort?.default_level);
  if (reported) model.defaultReasoningEffort = reported;
}
