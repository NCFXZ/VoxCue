export interface ChatModel {
  id: string;
  label: string;
  description: string;
}
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
export interface ChatRequest {
  id: string;
  modelId: string;
  webSearch: boolean;
  instructions: string;
  turns: ChatTurn[];
}
export type ChatEvent =
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'search' }
  | { id: string; type: 'sources'; sources: ChatSource[] };
export type ChatResult =
  | { ok: true; usage: TokenUsage | null; sources: ChatSource[]; warning?: string }
  | { ok: false; error: ChatFailure };
export const emptyUsage = (): AppUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  requests: 0,
  updatedAt: null,
});
