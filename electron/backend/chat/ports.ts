import type { AppUsage, ChatEvent, ChatModel, ChatRequest, ChatResult } from '../../contracts/chat';

export type ChatCompletion = Omit<Extract<ChatResult, { ok: true }>, 'ok'>;

// Native application code depends on this port, not a specific AI provider.
export interface AIChatService {
  models(force?: boolean): Promise<ChatModel[]>;
  usage(): Promise<AppUsage>;
  resetUsage(): Promise<AppUsage>;
  stream(
    request: ChatRequest,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
  ): Promise<ChatCompletion>;
}
