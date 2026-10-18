// Compile-only assertions; no runtime desktop access or native module loading.
import type { DesktopAPI, DesktopInvokeMap } from '../../../shared/electron/contracts/desktop';
import type { AIChatService } from '../../../shared/electron/backend/chat/ports';
import type { ChatGPTService } from '../../../shared/electron/backend/chat/service';
import type { PersonalInfo, ProfileChanges } from '../../../shared/electron/contracts/profile';
import type {
  ChatModel,
  ChatResult,
  ModelProvider,
  ChatPartialResponse,
} from '../../../shared/electron/contracts/chat';

declare const failedPreview: ChatPartialResponse;
// @ts-expect-error Received failure content cannot contain a confirmable proposal.
void failedPreview.profileChanges;
// @ts-expect-error Private reasoning remains outside the failure snapshot.
void failedPreview.encrypted_content;

const modelProvider: ModelProvider = { id: 'other', name: 'Other', dataRecipient: 'Other Company' };
const providerModel: ChatModel = {
  id: 'other-model',
  label: 'Other Model',
  description: '',
  provider: modelProvider,
};
const providerReply: ChatResult = { ok: true, provider: modelProvider, usage: null, sources: [] };
void [providerModel, providerReply];

declare const desktop: DesktopAPI;
const runningPlatform: 'macos' | 'windows' | 'unknown' = desktop.platform;
void runningPlatform;
const frostedEffectReady: boolean = desktop.presentation.frostedTransparency;
void frostedEffectReady;
// @ts-expect-error Native presentation availability is read-only metadata.
desktop.presentation.nativeTheme = true;
// @ts-expect-error The renderer cannot replace the native capability descriptor.
desktop.presentation = {};
// @ts-expect-error Platform metadata is read-only in the renderer.
desktop.platform = 'windows';
desktop.setNativeTheme('dark');
desktop.setNativeTheme('light');
desktop.setNativeTheme('system');
// @ts-expect-error Only fixed theme preferences are accepted, never native commands or paths.
desktop.setNativeTheme({ appearance: 'dark', path: '/private' });
// @ts-expect-error Native appearance does not expose arbitrary material names.
desktop.setNativeTheme('sidebar');
// @ts-expect-error Theme changes accept exactly one fixed preference.
desktop.setNativeTheme('dark', 'light');
desktop.screenCapturePermission('check');
desktop.screenCapturePermission('request');
desktop.screenCapturePermission('open-settings');
// @ts-expect-error Permission requests never accept arbitrary URLs, paths or commands.
desktop.screenCapturePermission({ url: 'https://example.com' });
// @ts-expect-error Only the three fixed permission actions are exposed.
desktop.screenCapturePermission('grant');
desktop.interviewAnswer({ id: 'screen', modelId: 'model', screenshot: 'only' });
desktop.interviewAnswer({
  id: 'attach',
  modelId: 'model',
  question: '解释题目',
  screenshot: 'attach',
});
// @ts-expect-error Screenshot-only requests cannot include draft or transcript text.
desktop.interviewAnswer({ id: 'screen', modelId: 'model', question: 'draft', screenshot: 'only' });
// @ts-expect-error Only a controlled capture mode is accepted, never file paths or image bytes.
desktop.interviewAnswer({ id: 'screen', modelId: 'model', screenshot: { path: 'C:/private.png' } });
desktop.moveInterviewWindow({ phase: 'start' });
desktop.moveInterviewWindow({ phase: 'move' });
desktop.moveInterviewWindow({ phase: 'end' });
// @ts-expect-error Window movement reads the native cursor; renderer coordinates are not accepted.
desktop.moveInterviewWindow({ phase: 'move', x: 10, y: 20 });
// @ts-expect-error No arbitrary native actions or target windows.
desktop.moveInterviewWindow({ phase: 'move', target: 'main' });
// @ts-expect-error Only three fixed gesture phases are supported.
desktop.moveInterviewWindow({ phase: 'execute' });
desktop.setInterviewTranscriptVisible(false);
desktop.setInterviewMousePassthrough(true);
// @ts-expect-error Mouse passthrough only accepts a boolean, never native window options.
desktop.setInterviewMousePassthrough({ forward: true });
// @ts-expect-error Mouse passthrough cannot target another window.
desktop.setInterviewMousePassthrough(true, 'main');
// @ts-expect-error Transcript layout only accepts a boolean, never dimensions or paths.
desktop.setInterviewTranscriptVisible({ width: 1200 });
desktop.interviewState().then((state) => {
  const visible: boolean = state.transcriptVisible;
  void visible;
});
desktop.onChatEvent((event) => {
  if (event.type === 'activity') {
    const publicUrl: string | undefined = event.activity.url;
    if (event.activity.kind === 'reasoning') {
      const publicSummary: string | undefined = event.activity.detail;
      void publicSummary;
    }
    void publicUrl;
    // @ts-expect-error Progress does not expose raw reasoning or tool arguments.
    void event.activity.encrypted_content;
  }
});
desktop.updates({ op: 'check' });
desktop.updates({ op: 'install' });
desktop.updates({ op: 'set-auto-download', enabled: false });
// @ts-expect-error Auto-download preferences only accept a boolean.
desktop.updates({ op: 'set-auto-download', enabled: 'yes' });
desktop.onUpdateEvent((state) => {
  const revision: number = state.revision;
  void revision;
});
// @ts-expect-error Update requests never accept a URL, path or GitHub token.
desktop.updates({ op: 'check', url: 'https://example.com', token: 'secret' });
// @ts-expect-error Only fixed update operations are exposed.
desktop.updates({ op: 'execute' });
const provider: AIChatService = null! as ChatGPTService;
const frontend: Window['desktop'] = desktop;
const cancel: DesktopInvokeMap['chat:cancel']['args'] = ['request-id'];
void [provider, frontend, cancel];
const personalInfo: PersonalInfo = {
  name: '',
  background: '',
  jobDescription: '',
  customInstructions: '自然口语，先给结论。',
  skills: [],
};
const profileChanges: ProfileChanges = { customInstructions: '', skills: [] };
// @ts-expect-error Instructions are a single document rather than a list.
const invalidInstructions: ProfileChanges = { customInstructions: [] };
// @ts-expect-error Knowledge selection is controlled only by the user.
const invalidSelection: ProfileChanges = { knowledgeBaseId: 'other' };
// @ts-expect-error The removed role cannot be proposed as a new editable field.
const removedRole: ProfileChanges = { role: 'developer' };
void [personalInfo, profileChanges, invalidInstructions, invalidSelection, removedRole];
desktop.speech({ op: 'start', options: { sources: ['system'] } });
desktop.dictation({ op: 'start' });
desktop.updateSessionState(true);
desktop.finishSessionClose('request-id', true);
// @ts-expect-error Close acknowledgement is a boolean, never content or files.
desktop.finishSessionClose('request-id', { content: 'private' });
// @ts-expect-error Only a boolean session marker is accepted, never content or a path.
desktop.updateSessionState({ text: 'private', path: 'C:/private' });
// @ts-expect-error Native paths cannot be supplied by the Renderer.
desktop.speech({ op: 'start', options: { sources: ['system'], executable: 'C:/asr.exe' } });
desktop.onSpeechEvent((event) => {
  if (event.type === 'gap') {
    const source: 'microphone' | 'system' = event.source;
    const message: string = event.message;
    void [source, message];
  }
});
desktop.interviewAnswer({
  id: 'max-effort',
  question: 'why',
  modelId: 'test',
  effort: 'max',
});
desktop.interviewAnswer({
  id: 'invalid-effort',
  question: 'why',
  modelId: 'test',
  // @ts-expect-error Ultra is not a Responses API reasoning.effort value.
  effort: 'ultra',
});
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

// @ts-expect-error Knowledge requests cannot issue SQL or filesystem commands.
desktop.knowledge({ op: 'sql', query: 'DROP TABLE documents' });
desktop.knowledge({
  op: 'import',
  requestId: 'x',
  documentId: 'd',
  baseId: 'b',
  name: 'x.pdf',
  // @ts-expect-error Paths never enter the renderer bridge.
  path: 'C:/private',
});
