// Compile-only assertions; no runtime desktop access or native module loading.
import type { DesktopAPI, DesktopInvokeMap } from '../electron/contracts/desktop';
import type { AIChatService } from '../electron/backend/chat/ports';
import type { ChatGPTService } from '../electron/backend/chat/service';

declare const desktop: DesktopAPI;
const provider: AIChatService = null! as ChatGPTService;
const frontend: Window['desktop'] = desktop;
const cancel: DesktopInvokeMap['chat:cancel']['args'] = ['request-id'];
void [provider, frontend, cancel];
// @ts-expect-error The removed indexing API must not remain in the bridge.
desktop.retrieval({ op: 'sql', query: 'DROP TABLE documents' });
// @ts-expect-error No arbitrary window or Node command is exposed.
desktop.windowAction('devtools');
// @ts-expect-error Request IDs retain their public string type.
const invalid: DesktopInvokeMap['chat:cancel']['args'] = [12];
void [invalid];
desktop.interviewAnswer({
  id: 'q',
  question: 'why',
  modelId: 'test',
  // @ts-expect-error Interview effort uses the same public model effort whitelist.
  effort: 'invented',
});

// @ts-expect-error Privacy settings entry accepts no URL or shell command.
desktop.openMicrophoneSettings('https://example.com');
desktop.interviewAnswer({
  id: 'q',
  question: 'why',
  modelId: 'test',
  // @ts-expect-error Removed configuration fields cannot re-enter answer requests.
  knowledgeBaseId: 'job-other',
});
