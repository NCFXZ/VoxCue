import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('desktop', {
  authSession: () => ipcRenderer.invoke('auth:session'),
  signInWithChatGPT: () => ipcRenderer.invoke('auth:sign-in'),
  cancelSignIn: () => ipcRenderer.invoke('auth:cancel'),
  enterDemo: () => ipcRenderer.invoke('auth:demo'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  openInterview: () => ipcRenderer.invoke('interview:open'),
  interviewState: () => ipcRenderer.invoke('interview:state'),
  allowCapture: (allowed: boolean) => ipcRenderer.invoke('interview:capture', allowed),
  togglePin: () => ipcRenderer.invoke('interview:pin'),
  windowAction: (action: 'minimize' | 'maximize' | 'close') => {
    if (['minimize', 'maximize', 'close'].includes(action))
      ipcRenderer.send('window:action', action);
  },
});
