import type { AppUsage, ChatEvent, ChatModel, ChatRequest, ChatResult } from '../../contracts/chat';

export type ChatCompletion = Omit<Extract<ChatResult, { ok: true }>, 'ok'>;
export interface LocalToolCall {
  name: string;
  namespace?: string;
  arguments: string;
  call_id: string;
}
export interface LocalTools {
  definitions: Record<string, unknown>[];
  execute(call: LocalToolCall, signal: AbortSignal): Promise<string>;
}

// Native application code depends on this port, not a specific AI provider.
export interface AIChatService {
  readonly functionCallingStatus?: { supported: boolean | null; reason: string };
  models(force?: boolean): Promise<ChatModel[]>;
  usage(): Promise<AppUsage>;
  resetUsage(): Promise<AppUsage>;
  stream(
    request: ChatRequest,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
  ): Promise<ChatCompletion>;
  streamWithTools?(
    request: ChatRequest,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
    tools: LocalTools,
  ): Promise<ChatCompletion>;
}
