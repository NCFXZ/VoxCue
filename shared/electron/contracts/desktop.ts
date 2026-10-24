import type { KnowledgeCall, KnowledgeResult, KnowledgeStatus } from './knowledge';
import type { InterviewImage, InterviewImageCall } from './interviewImages';
import type { ScreenCapturePermission, ScreenCapturePermissionAction } from './screenCapture';
import type { PresentationCapabilities } from './presentation';
import type { UpdateCall, UpdateState } from './updates';
import type { ComponentCall, ComponentState } from './components';
import type { AuthSession, SignOutResult } from './auth';
import type { AccountUsage } from './accountUsage';
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
export interface GlassSurfacePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type GlassButtonAction = 'sidebar' | 'profile' | 'start';
export interface ScrollChromeState {
  area: GlassSurfacePlacement;
  title: GlassSurfacePlacement | null;
  titleText: string;
  composer: GlassSurfacePlacement | null;
  follow: GlassSurfacePlacement | null;
  followHovered: boolean;
  modal: GlassSurfacePlacement | null;
  modalRadius: number;
  topHeight: number;
  headerOpacity: number;
  titleOpacity: number;
  foregroundColor: string;
  /** Interview settings only: clip the header to its dialog's continuous contour. */
  headerRadius?: number;
}
export interface NativeMenuRequest {
  anchor: GlassSurfacePlacement;
  side: 'top' | 'bottom';
  align: 'start' | 'end';
  width: number;
  items: {
    label: string;
    separator: boolean;
    disabled: boolean;
    checked: boolean;
    symbol: string | null;
    symbolColor: string | null;
  }[];
}
export interface GlassButtonPlacement extends GlassSurfacePlacement {
  disabled: boolean;
  behindContent: boolean;
  foregroundColor: string;
  hovered: boolean;
  pressed: boolean;
}
export interface ContentControlPlacement extends GlassSurfacePlacement {
  id: number;
  kind:
    | 'button'
    | 'button-glass'
    | 'button-hover'
    | 'regular-overlay'
    | 'font-slider'
    | 'popup'
    | 'search'
    | 'switch'
    | 'button-background'
    | 'progress'
    | 'progress-bar';
  label: string;
  value: string;
  symbol: string | null;
  symbolColor: string | null;
  color: string;
  disabled: boolean;
  covered: boolean;
  overGlass: boolean;
  pressed: boolean;
  focused: boolean;
  checked: boolean;
  hovered: boolean;
  trailing: boolean;
  opacity: number;
}
export interface InterviewMaterialPlacement extends GlassSurfacePlacement {
  id: number;
  style:
    | 'clear'
    | 'regular'
    | 'regular-dark'
    | 'regular-interactive'
    | 'regular-follow-hover'
    | 'modal-exclusion'
    | 'preview-scene'
    | 'preview-login-scene';
  radius: number;
  round: boolean;
  dark: boolean;
  clip: GlassSurfacePlacement;
  fadeBottom: number;
  opacity: number;
}

// The complete renderer allowlist. No credentials, paths or arbitrary IPC access.
export interface DesktopAPI {
  readonly platform: 'macos' | 'windows' | 'unknown';
  readonly nativeWindowControls: boolean;
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
  /** Mac-only background port. Zero removes the effect; layout stays in shared React. */
  setSidebarGlass(
    width: number,
    toolbarHeight?: number,
    surfaceColor?: string,
    dark?: boolean,
  ): Promise<boolean>;
  setGlassButton(
    action: GlassButtonAction,
    placement: GlassButtonPlacement | null,
  ): Promise<boolean>;
  onGlassButton(callback: (action: GlassButtonAction) => void): () => void;
  setScrollChrome(state: ScrollChromeState | null): Promise<boolean>;
  setContentControls(controls: ContentControlPlacement[]): Promise<boolean>;
  setInterviewMaterials(materials: InterviewMaterialPlacement[]): Promise<boolean>;
  onContentSearch(callback: (id: number, value: string) => void): () => void;
  onContentToggle(callback: (id: number, checked: boolean) => void): () => void;
  onContentRange(callback: (id: number, value: number) => void): () => void;
  windowFocused(): Promise<boolean>;
  onWindowFocus(callback: (focused: boolean) => void): () => void;
  popUpNativeMenu(request: NativeMenuRequest): Promise<number | null>;
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
  'appearance:sidebar-glass': Invocation<DesktopAPI['setSidebarGlass']>;
  'appearance:glass-button': Invocation<DesktopAPI['setGlassButton']>;
  'appearance:scroll-chrome': Invocation<DesktopAPI['setScrollChrome']>;
  'appearance:content-controls': Invocation<DesktopAPI['setContentControls']>;
  'appearance:interview-materials': Invocation<DesktopAPI['setInterviewMaterials']>;
  'appearance:window-focus': Invocation<DesktopAPI['windowFocused']>;
  'appearance:native-menu': Invocation<DesktopAPI['popUpNativeMenu']>;
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
  'appearance:window-focus-changed': [focused: boolean];
  'updates:event': [state: UpdateState];
  'components:event': [state: ComponentState];
  'session:request-close': [id: string];
  'knowledge:event': [event: KnowledgeStatus];
  'history:title': [event: InterviewTitleEvent];
  'speech:event': [event: SpeechEvent];
  'dictation:event': [event: SpeechEvent];
  'appearance:accent-changed': [color: string | null];
  'appearance:glass-button-clicked': [action: GlassButtonAction];
  'appearance:content-search': [id: number, value: string];
  'appearance:content-toggle': [id: number, checked: boolean];
  'appearance:content-range': [id: number, value: number];
  'chat:event': [event: ChatEvent];
  'interview:request-end': [];
}
