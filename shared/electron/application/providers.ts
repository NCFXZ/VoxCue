import type { AIChatService } from '../backend/chat/ports';
import type { ChatEvent, ChatRequest } from '../contracts/chat';

/** Select once per request; model IDs never determine the authentication route. */
export class SelectedChatService implements AIChatService {
  constructor(private selected: () => AIChatService) {}
  models(force?: boolean) {
    return this.selected().models(force);
  }
  usage() {
    return this.selected().usage();
  }
  accountUsage() {
    return this.selected().accountUsage?.() ?? Promise.resolve(null);
  }
  resetUsage() {
    return this.selected().resetUsage();
  }
  stream(request: ChatRequest, emit: (event: ChatEvent) => void, signal: AbortSignal) {
    return this.selected().stream(request, emit, signal);
  }
}
