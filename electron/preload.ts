import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopAPI,
  DesktopInvokeMap,
  DesktopSendMap,
  DesktopEventMap,
} from './contracts/desktop';

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
  generateInterviewTitle: (request) => invoke('history:generate-title', request),
  onInterviewTitle: (callback) => subscribe('history:title', callback),
  exportHistory: (request) => invoke('history:export', request),
  speech: (call) => invoke('speech:call', call),
  onSpeechEvent: (callback) => subscribe('speech:event', callback),
  dictation: (call) => invoke('dictation:call', call),
  onDictationEvent: (callback) => subscribe('dictation:event', callback),
  interviewModels: () => invoke('interview:models'),
  interviewAnswer: (request) => invoke('interview:answer', request),
  interviewCancel: (id) => invoke('interview:cancel', id),
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
  openMicrophoneSettings: () => invoke('interview:microphone-settings'),
  interviewState: () => invoke('interview:state'),
  allowCapture: (allowed) => invoke('interview:capture', allowed),
  togglePin: () => invoke('interview:pin'),
  toggleInterviewCollapse: () => invoke('interview:collapse'),
  resizeInterview: (direction) => invoke('interview:resize', direction),
  confirmInterviewEnd: () => send('interview:confirm-end'),
  onInterviewEndRequested: (callback) => subscribe('interview:request-end', callback),
  windowAction: (action) => {
    if (['minimize', 'maximize', 'close'].includes(action)) send('window:action', action);
  },
};
contextBridge.exposeInMainWorld('desktop', desktop);
