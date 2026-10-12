import { contextBridge, ipcRenderer } from 'electron';
import type { ChatRequest, ChatEvent } from './contracts/chat';
contextBridge.exposeInMainWorld('desktop', {
  authSession: () => ipcRenderer.invoke('auth:session'),
  signInWithChatGPT: () => ipcRenderer.invoke('auth:sign-in'),
  cancelSignIn: () => ipcRenderer.invoke('auth:cancel'),
  enterDemo: () => ipcRenderer.invoke('auth:demo'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  chatModels: (force = false) => ipcRenderer.invoke('chat:models', force),
  chatUsage: () => ipcRenderer.invoke('chat:usage'),
  chatSend: (request: ChatRequest) => ipcRenderer.invoke('chat:send', request),
  chatCancel: (id: string) => ipcRenderer.invoke('chat:cancel', id),
  chatOpenLink: (url: string) => ipcRenderer.invoke('chat:open-link', url),
  onChatEvent: (callback: (event: ChatEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: ChatEvent) => callback(value);
    ipcRenderer.on('chat:event', listener);
    return () => ipcRenderer.removeListener('chat:event', listener);
  },
  openInterview: () => ipcRenderer.invoke('interview:open'),
  interviewState: () => ipcRenderer.invoke('interview:state'),
  allowCapture: (allowed: boolean) => ipcRenderer.invoke('interview:capture', allowed),
  togglePin: () => ipcRenderer.invoke('interview:pin'),
  windowAction: (action: 'minimize' | 'maximize' | 'close') => {
    if (['minimize', 'maximize', 'close'].includes(action))
      ipcRenderer.send('window:action', action);
  },
});
