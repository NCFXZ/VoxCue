import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('desktop', {
  openInterview: () => ipcRenderer.invoke('interview:open'),
  interviewState: () => ipcRenderer.invoke('interview:state'),
  allowCapture: (allowed: boolean) => ipcRenderer.invoke('interview:capture', allowed),
  togglePin: () => ipcRenderer.invoke('interview:pin'),
  windowAction: (action: 'minimize' | 'maximize' | 'close') => {
    if (['minimize', 'maximize', 'close'].includes(action))
      ipcRenderer.send('window:action', action);
  },
});
