import type {
  PersonalInfo,
  ProfileChanges,
  ProfilePreview,
  ProfileGeneration,
  SkillSourceIssue,
} from './profile';
import type { ChatActivity } from './activity';
export type { ChatActivity } from './activity';
export interface ModelProvider {
  id: string;
  name: string;
  dataRecipient: string;
  modelName?: string;
  modelVendor?: string;
}
export const chatGPTProvider: ModelProvider = {
  id: 'chatgpt',
  name: 'ChatGPT',
  dataRecipient: 'OpenAI',
};
export const copilotProvider: ModelProvider = {
  id: 'copilot',
  name: 'GitHub Copilot',
  dataRecipient: 'GitHub Copilot',
};
export interface ChatModel {
  id: string;
  label: string;
  description: string;
  provider?: ModelProvider;
  reasoningEfforts?: ReasoningEffort[];
  /** Catalog metadata only. Auto leaves the effort unset on requests. */
  defaultReasoningEffort?: ReasoningEffort;
}
export const CHAT_MODEL_CATALOG_TTL_MS = 300_000;
export const reasoningEfforts = [
  'none',
  'on',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export interface AppUsage extends TokenUsage {
  requests: number;
  updatedAt: number | null;
}
export interface ChatSource {
  title: string;
  url: string;
}
export interface LocalChatSource {
  reference: string;
  itemId: string;
  documentId: string;
  baseId: string;
  revision: string;
  source: string;
  title: string;
  page?: number;
  section: string;
  matchedItemId?: string;
  scope?: 'excerpt';
}
export interface ChatFailure {
  message: string;
  code?: string;
  status?: number;
  requestId?: string;
  param?: string;
}
export interface ChatFile {
  name: string;
  bytes: Uint8Array;
}
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  files?: ChatFile[];
}
export const CHAT_TEXT_LIMIT = 200000;
export const CHAT_INSTRUCTIONS_LIMIT = 60000;
export const CHAT_TURN_LIMIT = 100;
export const CHAT_FILE_LIMIT = 20;
export const CHAT_FILE_BYTES_LIMIT = 20 * 1024 * 1024;
export const CHAT_FILES_BYTES_LIMIT = 32 * 1024 * 1024;
export interface ChatRequest {
  id: string;
  modelId: string;
  effort?: ReasoningEffort;
  webSearch: boolean;
  instructions: string;
  turns: ChatTurn[];
  profile?: PersonalInfo;
  profileTask?: 'skills';
  knowledgeBaseId?: string | null;
}
export type ChatEvent =
  | { id: string; type: 'provider'; provider: ModelProvider }
  | { id: string; type: 'interview-retry'; attempt: number; limit: number }
  | { id: string; type: 'profile-preview'; preview: ProfilePreview; generation?: ProfileGeneration }
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'reasoning-summary'; text: string }
  | { id: string; type: 'search' }
  | { id: string; type: 'activity'; activity: ChatActivity }
  | { id: string; type: 'sources'; sources: ChatSource[] };
/** Received public content only; never a confirmable profile proposal. */
export interface ChatPartialResponse {
  answerText?: string;
  reasoningSummary?: string;
  profilePreview?: ProfilePreview;
  activity?: ChatActivity;
  activities?: ChatActivity[];
  sources?: ChatSource[];
}
export type ChatResult =
  | {
      ok: true;
      provider?: ModelProvider;
      usage: TokenUsage | null;
      sources: ChatSource[];
      localSources?: LocalChatSource[];
      warning?: string;
      rag?: {
        mode: 'local';
        hits: number;
        evidenceCount: number;
        omitted: number;
        contextBytes: number;
        retrievalMs: number;
      };
      profileChanges?: ProfileChanges;
      skillSourceIssues?: SkillSourceIssue[];
      answerText?: string;
      reasoningSummary?: string;
      activities?: ChatActivity[];
    }
  | { ok: false; error: ChatFailure; partial?: ChatPartialResponse };
export const emptyUsage = (): AppUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  requests: 0,
  updatedAt: null,
});
