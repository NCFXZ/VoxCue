import type { KnowledgeCall, KnowledgeResult, KnowledgeStatus } from './knowledge';
import type { InterviewImage, InterviewImageCall } from './interviewImages';
import type { ScreenCapturePermission, ScreenCapturePermissionAction } from './screenCapture';
import type { PresentationCapabilities } from './presentation';
import type { UpdateCall, UpdateState } from './updates';
import type { ComponentCall, ComponentState } from './components';
import type { AuthSession, SignOutResult } from './auth';
import type { AccountUsage } from './accountUsage';
import type { CloudAccountCall, CloudAccountResult } from './cloudAccount';
import type { CloudSyncCall, CloudSyncResult } from './cloudSync';
import type { AccountDataCall, AccountDataResult } from './accountData';
import type { TelemetrySignal } from './telemetry';
import type { AppUsage, ChatEvent, ChatFailure, ChatModel, ChatRequest, ChatResult } from './chat';
import type { InterviewTitleRequest, InterviewTitleEvent, HistoryExportRequest } from './history';
import type {
  SpeechCall,
  SpeechOptions,
  SpeechStatus,
  SpeechEvent,
  SpeechHardware,
  InterviewAnswerRequest,
  InterviewScreenshot,
  InterviewScreenshotCall,
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
  telemetrySignal(signal: TelemetrySignal): Promise<void>;
  accountData(call: AccountDataCall): Promise<AccountDataResult>;
  cloudAccount(call: CloudAccountCall): Promise<CloudAccountResult>;
  setLocalMode(enabled: boolean): Promise<CloudAccountResult>;
  cloudSync(call: CloudSyncCall): Promise<CloudSyncResult>;
  readonly platform: 'macos' | 'windows' | 'unknown';
  readonly presentation: PresentationCapabilities;
  readonly screenCapturePermissionSupported: boolean;
  screenCapturePermission(action: ScreenCapturePermissionAction): Promise<ScreenCapturePermission>;
  updates(call: UpdateCall): Promise<UpdateState>;
  components(call: ComponentCall): Promise<ComponentState>;
  onComponentEvent(callback: (state: ComponentState) => void): () => void;
  onUpdateEvent(callback: (state: UpdateState) => void): () => void;
  knowledge(call: KnowledgeCall): Promise<KnowledgeResult>;
  onKnowledgeEvent(callback: (event: KnowledgeStatus) => void): () => void;
  speech(call: SpeechCall): Promise<SpeechStatus>;
  speechHardware(): Promise<SpeechHardware>;
  reconnectInterviewAudio(options?: SpeechOptions): Promise<SpeechStatus>;
  onSpeechEvent(callback: (event: SpeechEvent) => void): () => void;
  dictation(call: DictationCall): Promise<SpeechStatus>;
  onDictationEvent(callback: (event: SpeechEvent) => void): () => void;
  interviewModels(): Promise<ServiceResult<{ models: ChatModel[] }>>;
  updateInterviewModel(
    value: Pick<InterviewConfiguration, 'modelId' | 'effort'>,
  ): Promise<ServiceResult<{ modelId: string; effort: InterviewConfiguration['effort'] }>>;
  interviewAnswer(request: InterviewAnswerRequest): Promise<ChatResult>;
  interviewScreenshot(
    call: InterviewScreenshotCall,
  ): Promise<ServiceResult<{ screenshot?: InterviewScreenshot; images?: InterviewImage[] }>>;
  interviewImage(
    call: InterviewImageCall,
  ): Promise<ServiceResult<{ dataUrl?: string; canceled?: boolean }>>;
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
  chatAccountUsage(): Promise<ServiceResult<{ usage: AccountUsage | null }>>;
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
  moveInterviewWindow(change: { phase: 'start' | 'move' | 'end' }): Promise<void>;
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
  'telemetry:signal': Invocation<DesktopAPI['telemetrySignal']>;
  'account:data': Invocation<DesktopAPI['accountData']>;
  'cloud:account': Invocation<DesktopAPI['cloudAccount']>;
  'session:local-mode': Invocation<DesktopAPI['setLocalMode']>;
  'cloud:sync': Invocation<DesktopAPI['cloudSync']>;
  'updates:call': Invocation<DesktopAPI['updates']>;
  'components:call': Invocation<DesktopAPI['components']>;
  'session:state': Invocation<DesktopAPI['updateSessionState']>;
  'session:close-ready': Invocation<DesktopAPI['finishSessionClose']>;
  'knowledge:call': Invocation<DesktopAPI['knowledge']>;
  'history:generate-title': Invocation<DesktopAPI['generateInterviewTitle']>;
  'history:export': Invocation<DesktopAPI['exportHistory']>;
  'speech:call': Invocation<DesktopAPI['speech']>;
  'speech:hardware': Invocation<DesktopAPI['speechHardware']>;
  'interview:reconnect-audio': Invocation<DesktopAPI['reconnectInterviewAudio']>;
  'dictation:call': Invocation<DesktopAPI['dictation']>;
  'interview:models': Invocation<DesktopAPI['interviewModels']>;
  'interview:update-model': Invocation<DesktopAPI['updateInterviewModel']>;
  'interview:answer': Invocation<DesktopAPI['interviewAnswer']>;
  'interview:screenshot': Invocation<DesktopAPI['interviewScreenshot']>;
  'interview:image': Invocation<DesktopAPI['interviewImage']>;
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
  'chat:account-usage': Invocation<DesktopAPI['chatAccountUsage']>;
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
  'interview:move': Invocation<DesktopAPI['moveInterviewWindow']>;
}
export interface DesktopSendMap {
  'interview:confirm-end': [];
  'interview:mouse-passthrough': [ignore: boolean];
  'window:action': [action: WindowAction];
}
export interface DesktopEventMap {
  'updates:event': [state: UpdateState];
  'components:event': [state: ComponentState];
  'session:request-close': [id: string];
  'knowledge:event': [event: KnowledgeStatus];
  'history:title': [event: InterviewTitleEvent];
  'speech:event': [event: SpeechEvent];
  'dictation:event': [event: SpeechEvent];
  'appearance:accent-changed': [color: string | null];
  'chat:event': [event: ChatEvent];
  'interview:request-end': [];
}
