import type { ApiBalance, QwenRegion } from '../../contracts/apiConnections';
import type { ChatModel, ReasoningEffort } from '../../contracts/chat';
import { modelId, modelLabel } from '../chat/models';
import type { ChatServiceError } from '../chat/errors';

// Never crosses the preload boundary.
export interface ApiCredential {
  key: string;
  region?: QwenRegion;
  workspace?: string;
}

export interface ApiModel extends ChatModel {
  imageInput?: boolean;
  pdfInput?: boolean;
  adaptiveThinking?: boolean;
  maxOutput?: number;
}

export type CatalogGet = (url: string, headers?: Record<string, string>) => Promise<unknown>;
export interface CompatibleApi {
  endpoint(credential: ApiCredential): string;
  models(credential: ApiCredential, get: CatalogGet): Promise<ApiModel[]>;
  reasoning?(model: ApiModel, effort: ReasoningEffort): Record<string, unknown>;
  historyOptions?(model: ApiModel): Record<string, unknown>;
  streamUsage?(model: ApiModel): boolean;
  replayTextHistory?(model: ApiModel): boolean;
  failure?(status: number, body: unknown): ChatServiceError | undefined;
  balance?(credential: ApiCredential, get: CatalogGet): Promise<ApiBalance[]>;
}

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
