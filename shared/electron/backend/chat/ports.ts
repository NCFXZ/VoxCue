import type { AppUsage, ChatEvent, ChatModel, ChatRequest, ChatResult } from '../../contracts/chat';
import type { AccountUsage } from '../../contracts/accountUsage';

export type ChatCompletion = Omit<Extract<ChatResult, { ok: true }>, 'ok'>;
export interface ChatRequestScope {
  stream(
    request: ChatRequest,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
  ): Promise<ChatCompletion>;
  dispose(): void;
}
// Native application code depends on this port, not a specific AI provider.
export interface AIChatService {
  /** Main-process-only options; never accepted from Renderer or sent to a provider. */
  beginRequest?(options?: { retrievalQuery?: string; references?: boolean }): ChatRequestScope;
  models(force?: boolean, signal?: AbortSignal): Promise<ChatModel[]>;
  accountUsage?(): Promise<AccountUsage | null>;
  usage(): Promise<AppUsage>;
  resetUsage(): Promise<AppUsage>;
  stream(
    request: ChatRequest,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
  ): Promise<ChatCompletion>;
}
