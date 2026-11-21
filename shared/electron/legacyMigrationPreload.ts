import { ipcRenderer } from 'electron';

// Only the two hidden upgrade windows receive this preload. Neither has a desktop API.
ipcRenderer.once('voxcue:legacy-migration-port', (event, owner: string) => {
  if (event.ports.length === 1 && typeof owner === 'string')
    window.postMessage({ type: 'voxcue:legacy-migration-port', owner }, '*', event.ports);
});
