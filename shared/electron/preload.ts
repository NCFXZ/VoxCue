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
  liquidGlass: presentationFlags.liquidGlass === true,
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
  platform:
    process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'unknown',
  nativeWindowControls: process.platform === 'darwin',
  presentation,
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
  onDictationEvent: (callback) => subscribe('dictation:event', callback),
  interviewModels: () => invoke('interview:models'),
  updateInterviewModel: (value) => invoke('interview:update-model', value),
  interviewAnswer: (request) => invoke('interview:answer', request),
  interviewScreenshot: (call) => invoke('interview:screenshot', call),
  interviewCancel: (id) => invoke('interview:cancel', id),
  setNativeTheme: (theme) => invoke('appearance:theme', theme),
  setSidebarGlass: (width, toolbarHeight = 0, surfaceColor = '#ffffff', dark = false) =>
    invoke('appearance:sidebar-glass', width, toolbarHeight, surfaceColor, dark),
  setGlassButton: (action, placement) => invoke('appearance:glass-button', action, placement),
  onGlassButton: (callback) => subscribe('appearance:glass-button-clicked', callback),
  setScrollChrome: (state) => invoke('appearance:scroll-chrome', state),
  setContentControls: (controls) => invoke('appearance:content-controls', controls),
  setInterviewMaterials: (materials) => invoke('appearance:interview-materials', materials),
  onContentSearch: (callback) => subscribe('appearance:content-search', callback),
  onContentToggle: (callback) => subscribe('appearance:content-toggle', callback),
  onContentRange: (callback) => subscribe('appearance:content-range', callback),
  windowFocused: () => invoke('appearance:window-focus'),
  onWindowFocus: (callback) => subscribe('appearance:window-focus-changed', callback),
  popUpNativeMenu: (request) => invoke('appearance:native-menu', request),
  systemAccent: () => invoke('appearance:accent'),
  onSystemAccent: (callback) => subscribe('appearance:accent-changed', callback),
  authSession: () => invoke('auth:session'),
  signInWithChatGPT: () => invoke('auth:sign-in'),
  cancelSignIn: () => invoke('auth:cancel'),
  enterDemo: () => invoke('auth:demo'),
  signOut: () => invoke('auth:sign-out'),
  chatModels: (force = false) => invoke('chat:models', force),
  chatUsage: () => invoke('chat:usage'),
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
  allowCapture: (allowed) => invoke('interview:capture', allowed),
  togglePin: () => invoke('interview:pin'),
  toggleInterviewCollapse: () => invoke('interview:collapse'),
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
