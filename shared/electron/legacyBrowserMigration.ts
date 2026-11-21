import { BrowserWindow, MessageChannelMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCloudProfileOwner } from './accountProfilePaths';
import { profilePartition } from './window';
import { abortable } from './backend/cancellable';

type UpgradePaths = { indexFile: string; devServerUrl?: string };
export function migrateLegacyBrowser(owner: string, paths: UpgradePaths, signal?: AbortSignal) {
  return useLegacyStorage('migrate', owner, paths, signal);
}
export function eraseClaimedLegacyBrowser(owner: string, paths: UpgradePaths) {
  return useLegacyStorage('erase', owner, paths);
}

/** The upgrade claim has already fixed the recipient before either storage partition is opened. */
async function useLegacyStorage(
  operation: 'migrate' | 'erase',
  owner: string,
  paths: UpgradePaths,
  signal?: AbortSignal,
) {
  if (owner !== 'local' && !isCloudProfileOwner(owner)) throw Error('账号资料归属无效。');
  signal?.throwIfAborted();
  const windows: BrowserWindow[] = [];
  const failure = new AbortController();
  const timeout = setTimeout(() => failure.abort(), 10 * 60_000).unref();
  const lifetime = signal ? AbortSignal.any([signal, failure.signal]) : failure.signal;
  const close = () => {
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
  };
  lifetime.addEventListener('abort', close, { once: true });
  async function open(role: 'source' | 'target' | 'erase') {
    lifetime.throwIfAborted();
    const url = new URL(paths.devServerUrl ?? pathToFileURL(paths.indexFile).href);
    url.hash = 'legacy-upgrade-' + role;
    const win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        ...(role === 'target' && { partition: profilePartition(owner) }),
        ...(role !== 'erase' && { preload: path.join(__dirname, 'legacyMigrationPreload.js') }),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: false,
        webviewTag: false,
        backgroundThrottling: false,
      },
    });
    windows.push(win);
    const contents = win.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.once('render-process-gone', () => failure.abort());
    win.once('closed', () => failure.abort());
    await abortable(win.loadURL(url.href), lifetime);
    if (contents.getURL() !== url.href) throw Error('旧版资料迁移页面无效。');
    return contents;
  }
  try {
    if (operation === 'erase') {
      const source = await open('erase');
      lifetime.throwIfAborted();
      // The only argument is the main-verified claimant's local identifier or account UUID.
      const finished = await abortable(
        source.executeJavaScript(
          'window.voxcueLegacyErase.then(erase => erase(' + JSON.stringify(owner) + '))',
        ),
        lifetime,
      );
      lifetime.throwIfAborted();
      if (finished !== true) throw Error('旧版资料清理未完成。');
      return;
    }
    const [source, target] = await Promise.all([open('source'), open('target')]);
    lifetime.throwIfAborted();
    const channel = new MessageChannelMain();
    source.postMessage('voxcue:legacy-migration-port', owner, [channel.port1]);
    target.postMessage('voxcue:legacy-migration-port', owner, [channel.port2]);
    const finished = await abortable(
      Promise.all(
        [source, target].map((contents) =>
          contents.executeJavaScript('window.voxcueLegacyMigration'),
        ),
      ),
      lifetime,
    );
    lifetime.throwIfAborted();
    if (finished.some((result) => result !== true)) throw Error('旧版资料迁移未完成。');
  } finally {
    clearTimeout(timeout);
    lifetime.removeEventListener('abort', close);
    close();
  }
}
