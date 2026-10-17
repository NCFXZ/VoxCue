import type { KnowledgeCall, KnowledgeResult, KnowledgeStatus } from './knowledge';
import type { ScreenCapturePermission, ScreenCapturePermissionAction } from './screenCapture';
import type { PresentationCapabilities } from './presentation';
import type { UpdateCall, UpdateState } from './updates';
import type { AuthSession, SignOutResult } from './auth';
import type { AppUsage, ChatEvent, ChatFailure, ChatModel, ChatRequest, ChatResult } from './chat';
import type { InterviewTitleRequest, InterviewTitleEvent, HistoryExportRequest } from './history';
import type {
  SpeechCall,
  SpeechStatus,
  SpeechEvent,
  InterviewAnswerRequest,
  InterviewConfiguration,
  DictationCall,
  AudioSource,
  InterviewAccessReport,
} from './speech';

export type ServiceResult<T> = ({ ok: true } & T) | { ok: false; error: ChatFailure };
export interface InterviewWindowState {
  protected: boolean;
  pinned: boolean;
  supported: boolean;
  collapsed: boolean;
  transcriptVisible: boolean;
  configuration: InterviewConfiguration;
}
export type WindowAction = 'minimize' | 'maximize' | 'close';

// The complete renderer allowlist. No credentials, paths or arbitrary IPC access.
export interface DesktopAPI {
  readonly platform: 'macos' | 'windows' | 'unknown';
  readonly nativeWindowControls: boolean;
  readonly presentation: PresentationCapabilities;
  readonly screenCapturePermissionSupported: boolean;
  screenCapturePermission(action: ScreenCapturePermissionAction): Promise<ScreenCapturePermission>;
  updates(call: UpdateCall): Promise<UpdateState>;
  onUpdateEvent(callback: (state: UpdateState) => void): () => void;
  knowledge(call: KnowledgeCall): Promise<KnowledgeResult>;
  onKnowledgeEvent(callback: (event: KnowledgeStatus) => void): () => void;
  speech(call: SpeechCall): Promise<SpeechStatus>;
  onSpeechEvent(callback: (event: SpeechEvent) => void): () => void;
  dictation(call: DictationCall): Promise<SpeechStatus>;
  onDictationEvent(callback: (event: SpeechEvent) => void): () => void;
  interviewModels(): Promise<ServiceResult<{ models: ChatModel[] }>>;
  interviewAnswer(request: InterviewAnswerRequest): Promise<ChatResult>;
  interviewCancel(id: string): Promise<void>;
  setNativeTheme(theme: 'system' | 'light' | 'dark'): Promise<void>;
  systemAccent(): Promise<string | null>;
  onSystemAccent(callback: (color: string | null) => void): () => void;
  authSession(): Promise<AuthSession | null>;
  signInWithChatGPT(): Promise<AuthSession>;
  signInWithCopilot(): Promise<AuthSession>;
  cancelSignIn(): Promise<void>;
  enterDemo(): Promise<AuthSession>;
  signOut(): Promise<SignOutResult>;
  chatModels(force?: boolean): Promise<ServiceResult<{ models: ChatModel[] }>>;
  chatUsage(): Promise<ServiceResult<{ usage: AppUsage }>>;
  chatResetUsage(): Promise<ServiceResult<{ usage: AppUsage }>>;
  chatSend(request: ChatRequest): Promise<ChatResult>;
  chatCancel(id: string): Promise<void>;
  chatOpenLink(url: string): Promise<void>;
  onChatEvent(callback: (event: ChatEvent) => void): () => void;
  windowAction(action: WindowAction): void;
  updateSessionState(hasContent: boolean): Promise<void>;
  onSessionCloseRequested(callback: (id: string) => void): () => void;
  finishSessionClose(id: string, saved: boolean): Promise<void>;
  generateInterviewTitle(request: InterviewTitleRequest): Promise<void>;
  onInterviewTitle(callback: (event: InterviewTitleEvent) => void): () => void;
  exportHistory(request: HistoryExportRequest): Promise<boolean>;
  openInterview(configuration: InterviewConfiguration): Promise<void>;
  checkInterviewAccess(configuration: InterviewConfiguration): Promise<InterviewAccessReport>;
  openMicrophoneSettings(source?: AudioSource): Promise<void>;
  interviewState(): Promise<InterviewWindowState>;
  allowCapture(allowed: boolean): Promise<boolean>;
  togglePin(): Promise<boolean>;
  toggleInterviewCollapse(): Promise<boolean>;
  setInterviewTranscriptVisible(visible: boolean): Promise<boolean>;
  setInterviewMousePassthrough(ignore: boolean): void;
  resizeInterview(
    change: -1 | 1 | { phase: 'start'; edge: 'left' | 'right' } | { phase: 'move' | 'end' },
  ): Promise<void>;
  confirmInterviewEnd(): void;
  onInterviewEndRequested(callback: () => void): () => void;
}

type Invocation<F extends (...args: never[]) => unknown> = {
  args: Parameters<F>;
  result: Awaited<ReturnType<F>>;
};
// Channel types stay erased in the sandboxed, unbundled CommonJS preload.
// Importing runtime constants there would require a forbidden local require().
export interface DesktopInvokeMap {
  'updates:call': Invocation<DesktopAPI['updates']>;
  'session:state': Invocation<DesktopAPI['updateSessionState']>;
  'session:close-ready': Invocation<DesktopAPI['finishSessionClose']>;
  'knowledge:call': Invocation<DesktopAPI['knowledge']>;
  'history:generate-title': Invocation<DesktopAPI['generateInterviewTitle']>;
  'history:export': Invocation<DesktopAPI['exportHistory']>;
  'speech:call': Invocation<DesktopAPI['speech']>;
  'dictation:call': Invocation<DesktopAPI['dictation']>;
  'interview:models': Invocation<DesktopAPI['interviewModels']>;
  'interview:answer': Invocation<DesktopAPI['interviewAnswer']>;
  'interview:cancel': Invocation<DesktopAPI['interviewCancel']>;
  'appearance:theme': Invocation<DesktopAPI['setNativeTheme']>;
  'appearance:accent': Invocation<DesktopAPI['systemAccent']>;
  'auth:session': Invocation<DesktopAPI['authSession']>;
  'auth:sign-in': Invocation<DesktopAPI['signInWithChatGPT']>;
  'auth:copilot-sign-in': Invocation<DesktopAPI['signInWithCopilot']>;
  'auth:cancel': Invocation<DesktopAPI['cancelSignIn']>;
  'auth:demo': Invocation<DesktopAPI['enterDemo']>;
  'auth:sign-out': Invocation<DesktopAPI['signOut']>;
  'chat:models': Invocation<DesktopAPI['chatModels']>;
  'chat:usage': Invocation<DesktopAPI['chatUsage']>;
  'chat:usage-reset': Invocation<DesktopAPI['chatResetUsage']>;
  'chat:send': Invocation<DesktopAPI['chatSend']>;
  'chat:cancel': Invocation<DesktopAPI['chatCancel']>;
  'chat:open-link': Invocation<DesktopAPI['chatOpenLink']>;
  'interview:open': Invocation<DesktopAPI['openInterview']>;
  'interview:check-access': Invocation<DesktopAPI['checkInterviewAccess']>;
  'interview:screen-permission': Invocation<DesktopAPI['screenCapturePermission']>;
  'interview:microphone-settings': Invocation<DesktopAPI['openMicrophoneSettings']>;
  'interview:state': Invocation<DesktopAPI['interviewState']>;
  'interview:capture': Invocation<DesktopAPI['allowCapture']>;
  'interview:pin': Invocation<DesktopAPI['togglePin']>;
  'interview:collapse': Invocation<DesktopAPI['toggleInterviewCollapse']>;
  'interview:transcript': Invocation<DesktopAPI['setInterviewTranscriptVisible']>;
  'interview:resize': Invocation<DesktopAPI['resizeInterview']>;
}
export interface DesktopSendMap {
  'interview:confirm-end': [];
  'interview:mouse-passthrough': [ignore: boolean];
  'window:action': [action: WindowAction];
}
export interface DesktopEventMap {
  'updates:event': [state: UpdateState];
  'session:request-close': [id: string];
  'knowledge:event': [event: KnowledgeStatus];
  'history:title': [event: InterviewTitleEvent];
  'speech:event': [event: SpeechEvent];
  'dictation:event': [event: SpeechEvent];
  'appearance:accent-changed': [color: string | null];
  'chat:event': [event: ChatEvent];
  'interview:request-end': [];
}
