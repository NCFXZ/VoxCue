import type { KnowledgeCall, KnowledgeResult, KnowledgeEvent } from './knowledge';
import type { RecordingCall, RecordingSegment } from './recordings';
import type { InterviewImage, InterviewImageCall } from './interviewImages';
import type { ScreenCapturePermission, ScreenCapturePermissionAction } from './screenCapture';
import type { PresentationCapabilities } from './presentation';
import type { UILanguage } from './uiLanguage';
import type {
  InterviewShortcutStatus,
  ShortcutSettingsCall,
  ShortcutSettingsResult,
  ShortcutSettingsState,
} from './shortcuts';
import type { UpdateCall, UpdateState } from './updates';
import type { ComponentCall, ComponentState } from './components';
import type { AuthSession, SignOutResult } from './auth';
import type { ApiConnections } from './apiConnections';
import type { AccountUsage } from './accountUsage';
import type { CloudAccountCall, CloudAccountResult } from './cloudAccount';
import type { CloudSyncCall, CloudSyncResult } from './cloudSync';
import type { AccountDataCall, AccountDataResult } from './accountData';
import type { TelemetrySignal } from './telemetry';
import type { AppUsage, ChatEvent, ChatFailure, ChatModel, ChatRequest, ChatResult } from './chat';
import type { InterviewTitleRequest, InterviewTitleEvent, HistoryExportRequest } from './history';
import type {
  RemoteConnectionCall,
  RemoteConnectionResult,
  RemoteConnectionState,
  RemoteInterviewSnapshot,
  RemoteCommand,
  RemoteCommandResult,
} from './remoteConnection';
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
  InterviewInputState,
} from './speech';

export type ServiceResult<T> = ({ ok: true } & T) | { ok: false; error: ChatFailure };
export interface InterviewCanvasLayout {
  revision: number;
  width: number;
  height: number;
}
export type InterviewShortcutCommand =
  | 'toggle-panels'
  | 'toggle-transcript'
  | 'toggle-microphone'
  | 'toggle-system-audio'
  | 'submit-input'
  | 'scroll-device-up'
  | 'scroll-device-down'
  | 'screenshot';
export interface InterviewShortcutsState extends InterviewShortcutStatus {
  open: boolean;
  rendererRevision: number;
  deviceConnected: boolean;
}
export interface InterviewWindowState {
  visible: boolean;
  inputState?: InterviewInputState;
  rendererRevision: number;
  protected: boolean;
  pinned: boolean;
  supported: boolean;
  collapsed: boolean;
  transcriptVisible: boolean;
  layout?: InterviewCanvasLayout;
  configuration: InterviewConfiguration;
}
export type WindowAction = 'minimize' | 'maximize' | 'close';
// The complete renderer allowlist. No credentials, paths or arbitrary IPC access.
export interface DesktopAPI {
  apiConnections: ApiConnections;
  shortcutSettings(call: ShortcutSettingsCall): Promise<ShortcutSettingsResult>;
  onShortcutSettings(callback: (state: ShortcutSettingsState) => void): () => void;
  remoteConnection(call: RemoteConnectionCall): Promise<RemoteConnectionResult>;
  onRemoteConnection(callback: (state: RemoteConnectionState) => void): () => void;
  waitForRemoteInterviewSlot(): Promise<void>;
  publishRemoteInterview(snapshot: RemoteInterviewSnapshot): Promise<void>;
  onRemoteCommand(callback: (command: RemoteCommand) => void): () => void;
  finishRemoteCommand(result: RemoteCommandResult): Promise<void>;
  telemetrySignal(signal: TelemetrySignal): Promise<void>;
  accountData(call: AccountDataCall): Promise<AccountDataResult>;
  cloudAccount(call: CloudAccountCall): Promise<CloudAccountResult>;
  setLocalMode(enabled: boolean): Promise<CloudAccountResult>;
  openUserAgreement(language: UILanguage): Promise<void>;
  setLocalImportRevision(revision: string | null): Promise<void>;
  cloudSync(call: CloudSyncCall): Promise<CloudSyncResult>;
  onCloudSyncAvailable(callback: () => void): () => void;
  readonly platform: 'macos' | 'windows' | 'unknown';
  readonly presentation: PresentationCapabilities;
  readonly systemLanguage: UILanguage;
  readonly initialLanguage?: UILanguage;
  readonly screenCapturePermissionSupported: boolean;
  screenCapturePermission(action: ScreenCapturePermissionAction): Promise<ScreenCapturePermission>;
  updates(call: UpdateCall): Promise<UpdateState>;
  components(call: ComponentCall): Promise<ComponentState>;
  onComponentEvent(callback: (state: ComponentState) => void): () => void;
  onUpdateEvent(callback: (state: UpdateState) => void): () => void;
  knowledge(call: KnowledgeCall): Promise<KnowledgeResult>;
  onKnowledgeEvent(callback: (event: KnowledgeEvent) => void): () => void;
  speech(call: SpeechCall): Promise<SpeechStatus>;
  speechHardware(): Promise<SpeechHardware>;
  reconnectInterviewAudio(options?: SpeechOptions): Promise<SpeechStatus>;
  controlInterviewSpeechSwitch(id: number, action: 'now' | 'cancel'): Promise<void>;
  setInterviewInput(state: InterviewInputState): Promise<SpeechStatus>;
  onSpeechEvent(callback: (event: SpeechEvent) => void): () => void;
  dictation(call: DictationCall): Promise<SpeechStatus>;
  onDictationEvent(callback: (event: SpeechEvent) => void): () => void;
  interviewModels(force?: boolean): Promise<ServiceResult<{ models: ChatModel[] }>>;
  interviewAccountUsage(): Promise<ServiceResult<{ usage: AccountUsage | null }>>;
  updateInterviewModel(
    value: Pick<InterviewConfiguration, 'modelId' | 'effort'>,
  ): Promise<ServiceResult<{ modelId: string; effort: InterviewConfiguration['effort'] }>>;
  interviewAnswer(request: InterviewAnswerRequest): Promise<ChatResult>;
  interviewScreenshot(
    call: InterviewScreenshotCall,
  ): Promise<ServiceResult<{ screenshot?: InterviewScreenshot; images?: InterviewImage[] }>>;
  interviewImage(
    call: InterviewImageCall,
  ): Promise<ServiceResult<{ dataUrl?: string; canceled?: boolean; hash?: string; bytes?: Uint8Array<ArrayBuffer> }>>;
  interviewCancel(id: string): Promise<void>;
  setNativeTheme(theme: 'system' | 'light' | 'dark'): Promise<void>;
  setUILanguage(language: UILanguage): Promise<void>;
  systemAccent(): Promise<string | null>;
  onSystemAccent(callback: (color: string | null) => void): () => void;
  authSession(service?: AuthSession['mode'] | 'startup'): Promise<AuthSession | null>;
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
  setInterviewRecording(recordId: string, enabled: boolean): Promise<boolean>;
  recordings(call: RecordingCall): Promise<RecordingSegment[]>;
  pendingRecordingRemovals(): Promise<string[]>;
  openInterview(configuration: InterviewConfiguration, approvedDeviceRevision?: number): Promise<void>;
  checkInterviewAccess(configuration: InterviewConfiguration): Promise<InterviewAccessReport>;
  openMicrophoneSettings(source?: AudioSource): Promise<void>;
  interviewState(): Promise<InterviewWindowState>;
  onInterviewLayout(callback: (layout: InterviewCanvasLayout) => void): () => void;
  onInterviewShortcut(callback: (command: InterviewShortcutCommand) => void): () => void;
  interviewShortcutsState(): Promise<InterviewShortcutsState>;
  setInterviewShortcutsOpen(open: boolean): Promise<boolean>;
  onInterviewShortcutsOpen(callback: (open: boolean) => void): () => void;
  onInterviewShortcutsState(callback: (state: InterviewShortcutsState) => void): () => void;
  interviewRendererReady(rendererRevision: number): Promise<void>;
  allowCapture(allowed: boolean): Promise<boolean>;
  togglePin(): Promise<boolean>;
  toggleInterviewCollapse(): Promise<boolean>;
  setInterviewSettingsOpen(open: boolean): Promise<void>;
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
  'shortcuts:settings': Invocation<DesktopAPI['shortcutSettings']>;
  'remote:connection': Invocation<DesktopAPI['remoteConnection']>;
  'remote:ready': Invocation<DesktopAPI['waitForRemoteInterviewSlot']>;
  'remote:publish': Invocation<DesktopAPI['publishRemoteInterview']>;
  'remote:complete': Invocation<DesktopAPI['finishRemoteCommand']>;
  'telemetry:signal': Invocation<DesktopAPI['telemetrySignal']>;
  'account:data': Invocation<DesktopAPI['accountData']>;
  'cloud:account': Invocation<DesktopAPI['cloudAccount']>;
  'session:local-mode': Invocation<DesktopAPI['setLocalMode']>;
  'session:open-user-agreement': Invocation<DesktopAPI['openUserAgreement']>;
  'session:local-import-revision': Invocation<DesktopAPI['setLocalImportRevision']>;
  'cloud:sync': Invocation<DesktopAPI['cloudSync']>;
  'updates:call': Invocation<DesktopAPI['updates']>;
  'components:call': Invocation<DesktopAPI['components']>;
  'session:state': Invocation<DesktopAPI['updateSessionState']>;
  'session:close-ready': Invocation<DesktopAPI['finishSessionClose']>;
  'knowledge:call': Invocation<DesktopAPI['knowledge']>;
  'history:generate-title': Invocation<DesktopAPI['generateInterviewTitle']>;
  'history:export': Invocation<DesktopAPI['exportHistory']>;
  'history:recordings': Invocation<DesktopAPI['recordings']>;
  'history:pending-recording-removals': Invocation<DesktopAPI['pendingRecordingRemovals']>;
  'interview:recording': Invocation<DesktopAPI['setInterviewRecording']>;
  'speech:call': Invocation<DesktopAPI['speech']>;
  'speech:hardware': Invocation<DesktopAPI['speechHardware']>;
  'interview:reconnect-audio': Invocation<DesktopAPI['reconnectInterviewAudio']>;
  'interview:control-speech-switch': Invocation<DesktopAPI['controlInterviewSpeechSwitch']>;
  'interview:input': Invocation<DesktopAPI['setInterviewInput']>;
  'dictation:call': Invocation<DesktopAPI['dictation']>;
  'interview:models': Invocation<DesktopAPI['interviewModels']>;
  'interview:account-usage': Invocation<DesktopAPI['interviewAccountUsage']>;
  'interview:update-model': Invocation<DesktopAPI['updateInterviewModel']>;
  'interview:answer': Invocation<DesktopAPI['interviewAnswer']>;
  'interview:screenshot': Invocation<DesktopAPI['interviewScreenshot']>;
  'interview:image': Invocation<DesktopAPI['interviewImage']>;
  'interview:cancel': Invocation<DesktopAPI['interviewCancel']>;
  'appearance:theme': Invocation<DesktopAPI['setNativeTheme']>;
  'appearance:language': Invocation<DesktopAPI['setUILanguage']>;
  'appearance:accent': Invocation<DesktopAPI['systemAccent']>;
  'auth:session': Invocation<DesktopAPI['authSession']>;
  'api-keys:list': Invocation<ApiConnections['list']>;
  'api-keys:configure': Invocation<ApiConnections['configure']>;
  'api-keys:control': Invocation<ApiConnections['control']>;
  'api-keys:remove': Invocation<ApiConnections['remove']>;
  'api-keys:balance': Invocation<ApiConnections['balance']>;
  'api-keys:open': Invocation<ApiConnections['open']>;
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
  'interview:shortcuts-state': Invocation<DesktopAPI['interviewShortcutsState']>;
  'interview:shortcuts-open': Invocation<DesktopAPI['setInterviewShortcutsOpen']>;
  'interview:renderer-ready': Invocation<DesktopAPI['interviewRendererReady']>;
  'interview:capture': Invocation<DesktopAPI['allowCapture']>;
  'interview:pin': Invocation<DesktopAPI['togglePin']>;
  'interview:collapse': Invocation<DesktopAPI['toggleInterviewCollapse']>;
  'interview:settings': Invocation<DesktopAPI['setInterviewSettingsOpen']>;
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
  'cloud:sync-available': [];
  'api-keys:tab': [requestId: string, backwards: boolean];
  'shortcuts:settings': [state: ShortcutSettingsState];
  'remote:state': [state: RemoteConnectionState];
  'remote:command': [command: RemoteCommand];
  'interview:layout': [layout: InterviewCanvasLayout];
  'interview:shortcut': [command: InterviewShortcutCommand];
  'interview:shortcuts-open': [open: boolean];
  'interview:shortcuts-state': [state: InterviewShortcutsState];
  'updates:event': [state: UpdateState];
  'components:event': [state: ComponentState];
  'session:request-close': [id: string];
  'knowledge:event': [event: KnowledgeEvent];
  'history:title': [event: InterviewTitleEvent];
  'speech:event': [event: SpeechEvent];
  'dictation:event': [event: SpeechEvent];
  'appearance:accent-changed': [color: string | null];
  'chat:event': [event: ChatEvent];
  'interview:request-end': [];
}
