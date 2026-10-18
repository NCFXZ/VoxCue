import { testRoot } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Install before application imports so isolated desktop checks cannot contact
// real services during startup. Renderer HTTP(S)/WebSocket requests are blocked
// as well as Electron net and Node transports. Local file assets still load.
export async function offlineElectronEntry() {
  const entry = path.join(testRoot, 'offline-electron-entry.cjs');
  await writeFile(
    entry,
    `
const { app, net } = require('electron');
const deny = () => { throw Error('Offline desktop regression forbids network access'); };
globalThis.fetch = deny;
net.fetch = deny;
net.request = deny;
for (const name of ['node:http', 'node:https']) {
  const transport = require(name);
  transport.request = deny;
  transport.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
require('node:module').syncBuiltinESMExports();
app.on('session-created', session => session.webRequest.onBeforeRequest(
  { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
  (_details, callback) => callback({ cancel: true }),
));
app.setAppPath(${JSON.stringify(workspace.platformRoot)});
require(${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/shared/electron/main.js'))});
`,
  );
  return entry;
}
