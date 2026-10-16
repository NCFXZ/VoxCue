import type { AIChatService, LocalTools } from '../backend/chat/ports';
import type { ChatEvent, ChatRequest } from '../contracts/chat';

/** Select once per request; model IDs never determine the authentication route. */
export class SelectedChatService implements AIChatService {
  constructor(private selected: () => AIChatService) {}
  get functionCallingStatus() {
    return (
      this.selected().functionCallingStatus ?? {
        supported: null,
        reason: '当前服务尚未验证本地工具。',
      }
    );
  }
  models(force?: boolean) {
    return this.selected().models(force);
  }
  usage() {
    return this.selected().usage();
  }
  resetUsage() {
    return this.selected().resetUsage();
  }
  stream(request: ChatRequest, emit: (event: ChatEvent) => void, signal: AbortSignal) {
    return this.selected().stream(request, emit, signal);
  }
  streamWithTools(
    request: ChatRequest,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
    tools: LocalTools,
  ) {
    const provider = this.selected();
    if (!provider.streamWithTools) throw Error('当前服务不支持本地工具，请选择自动查找资料。');
    return provider.streamWithTools(request, emit, signal, tools);
  }
}
