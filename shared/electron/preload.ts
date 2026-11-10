import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopAPI,
  DesktopInvokeMap,
  DesktopSendMap,
  DesktopEventMap,
} from './contracts/desktop';

// This is display metadata from BrowserWindow, not permission to call native APIs.
const presentationArgument = process.argv.find((value) =>
  value.startsWith('--voxcue-presentation='),
);
let presentationFlags: Record<string, unknown> = {};
try {
  const parsed: unknown = JSON.parse(
    presentationArgument?.slice('--voxcue-presentation='.length) ?? '{}',
  );
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    presentationFlags = parsed as Record<string, unknown>;
} catch {
  /* Missing metadata leaves platform effects pending. */
}
const presentation = Object.freeze({
  frostedTransparency: presentationFlags.frostedTransparency === true,
  nativeTheme: presentationFlags.nativeTheme === true,
  screenCapturePermission: presentationFlags.screenCapturePermission === true,
  interviewMousePassthrough: presentationFlags.interviewMousePassthrough === true,
  interviewIconVisibility: presentationFlags.interviewIconVisibility === true,
});

// Keep all project imports type-only: sandboxed preload cannot require local modules.
function invoke<K extends keyof DesktopInvokeMap>(
  channel: K,
  ...args: DesktopInvokeMap[K]['args']
): Promise<DesktopInvokeMap[K]['result']> {
  return ipcRenderer.invoke(channel, ...args);
}
function send<K extends keyof DesktopSendMap>(channel: K, ...args: DesktopSendMap[K]) {
  ipcRenderer.send(channel, ...args);
}
function subscribe<K extends keyof DesktopEventMap>(
  channel: K,
  callback: (...args: DesktopEventMap[K]) => void,
) {
  const listener = (_event: Electron.IpcRendererEvent, ...args: DesktopEventMap[K]) =>
    callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
const desktop: DesktopAPI = {
  shortcutSettings: (call) => invoke('shortcuts:settings', call),
  onShortcutSettings: (callback) => subscribe('shortcuts:settings', callback),
  remoteConnection: (call) => invoke('remote:connection', call),
  onRemoteConnection: (callback) => subscribe('remote:state', callback),
  publishRemoteInterview: (snapshot) => invoke('remote:publish', snapshot),
  onRemoteCommand: (callback) => subscribe('remote:command', callback),
  finishRemoteCommand: (result) => invoke('remote:complete', result),
  telemetrySignal: (signal) => invoke('telemetry:signal', signal),
  accountData: (call) => invoke('account:data', call),
  cloudAccount: (call) => invoke('cloud:account', call),
  setLocalMode: (enabled) => invoke('session:local-mode', enabled),
  cloudSync: (call) => invoke('cloud:sync', call),
  platform:
    process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'unknown',
  presentation,
  systemLanguage: process.argv.includes('--voxcue-system-language=zh-CN') ? 'zh-CN' : 'en',
  screenCapturePermissionSupported: presentation.screenCapturePermission,
  screenCapturePermission: (action) => invoke('interview:screen-permission', action),
  updates: (call) => invoke('updates:call', call),
  components: (call) => invoke('components:call', call),
  onComponentEvent: (callback) => subscribe('components:event', callback),
  onUpdateEvent: (callback) => subscribe('updates:event', callback),
  updateSessionState: (hasContent) => invoke('session:state', hasContent),
  onSessionCloseRequested: (callback) => subscribe('session:request-close', callback),
  finishSessionClose: (id, saved) => invoke('session:close-ready', id, saved),
  knowledge: (call) => invoke('knowledge:call', call),
  onKnowledgeEvent: (callback) => subscribe('knowledge:event', callback),
  generateInterviewTitle: (request) => invoke('history:generate-title', request),
  onInterviewTitle: (callback) => subscribe('history:title', callback),
  exportHistory: (request) => invoke('history:export', request),
  speech: (call) => invoke('speech:call', call),
  speechHardware: () => invoke('speech:hardware'),
  onSpeechEvent: (callback) => subscribe('speech:event', callback),
  dictation: (call) => invoke('dictation:call', call),
  reconnectInterviewAudio: (options) => invoke('interview:reconnect-audio', options),
  setInterviewInput: (state) => invoke('interview:input', state),
  onDictationEvent: (callback) => subscribe('dictation:event', callback),
  interviewModels: () => invoke('interview:models'),
  interviewAccountUsage: () => invoke('interview:account-usage'),
  updateInterviewModel: (value) => invoke('interview:update-model', value),
  interviewAnswer: (request) => invoke('interview:answer', request),
  interviewScreenshot: (call) => invoke('interview:screenshot', call),
  interviewImage: (call) => invoke('interview:image', call),
  interviewCancel: (id) => invoke('interview:cancel', id),
  setNativeTheme: (theme) => invoke('appearance:theme', theme),
  setUILanguage: (language) => invoke('appearance:language', language),
  systemAccent: () => invoke('appearance:accent'),
  onSystemAccent: (callback) => subscribe('appearance:accent-changed', callback),
  authSession: () => invoke('auth:session'),
  signInWithChatGPT: () => invoke('auth:sign-in'),
  signInWithCopilot: () => invoke('auth:copilot-sign-in'),
  cancelSignIn: () => invoke('auth:cancel'),
  enterDemo: () => invoke('auth:demo'),
  signOut: () => invoke('auth:sign-out'),
  chatModels: (force = false) => invoke('chat:models', force),
  chatUsage: () => invoke('chat:usage'),
  chatAccountUsage: () => invoke('chat:account-usage'),
  chatResetUsage: () => invoke('chat:usage-reset'),
  chatSend: (request) => invoke('chat:send', request),
  chatCancel: (id) => invoke('chat:cancel', id),
  chatOpenLink: (url) => invoke('chat:open-link', url),
  onChatEvent: (callback) => subscribe('chat:event', callback),
  openInterview: (configuration) => invoke('interview:open', configuration),
  checkInterviewAccess: (configuration) => invoke('interview:check-access', configuration),
  openMicrophoneSettings: (source) =>
    source === undefined
      ? invoke('interview:microphone-settings')
      : invoke('interview:microphone-settings', source),
  interviewState: () => invoke('interview:state'),
  onInterviewLayout: (callback) => subscribe('interview:layout', callback),
  onInterviewShortcut: (callback) => subscribe('interview:shortcut', callback),
  interviewShortcutsState: () => invoke('interview:shortcuts-state'),
  setInterviewShortcutsOpen: (open) => invoke('interview:shortcuts-open', open),
  onInterviewShortcutsOpen: (callback) => subscribe('interview:shortcuts-open', callback),
  onInterviewShortcutsState: (callback) => subscribe('interview:shortcuts-state', callback),
  interviewRendererReady: (revision) => invoke('interview:renderer-ready', revision),
  allowCapture: (allowed) => invoke('interview:capture', allowed),
  togglePin: () => invoke('interview:pin'),
  toggleInterviewCollapse: () => invoke('interview:collapse'),
  setInterviewSettingsOpen: (open) => invoke('interview:settings', open),
  setInterviewTranscriptVisible: (visible) => invoke('interview:transcript', visible),
  setInterviewMousePassthrough: (ignore) => {
    if (typeof ignore === 'boolean') send('interview:mouse-passthrough', ignore);
  },
  moveInterviewWindow: (change) => invoke('interview:move', change),
  resizeInterview: (direction) => invoke('interview:resize', direction),
  confirmInterviewEnd: () => send('interview:confirm-end'),
  onInterviewEndRequested: (callback) => subscribe('interview:request-end', callback),
  windowAction: (action) => {
    if (['minimize', 'maximize', 'close'].includes(action)) send('window:action', action);
  },
};
contextBridge.exposeInMainWorld('desktop', desktop);
