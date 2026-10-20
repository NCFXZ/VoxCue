import { testRoot } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Defaults stay fully offline. Native fixtures may declare one owned loopback
// port or fixed public component downloads, before their application imports.
export async function offlineElectronEntry(
  fixture,
  { loopbackPort, componentDownloads = false } = {},
) {
  if (fixture && !path.resolve(fixture).startsWith(testRoot + path.sep))
    throw Error('Offline fixture entry must belong to this temporary test run');
  if (
    (loopbackPort !== undefined &&
      (!Number.isInteger(loopbackPort) || loopbackPort < 1 || loopbackPort > 65535)) ||
    typeof componentDownloads !== 'boolean' ||
    (!fixture && (loopbackPort !== undefined || componentDownloads))
  )
    throw Error('Network fixtures require an owned entry and an explicit transport');
  const packages = componentDownloads
    ? workspace
        .platformRequire(
          path.join(
            workspace.platformRoot,
            'dist-electron/shared/electron/backend/components/catalog.js',
          ),
        )
        .packagesFor(process.platform, process.arch)
    : [];
  const modelUrls = packages
    .flatMap((pkg) => pkg.parts ?? [pkg])
    .map(
      (pkg) =>
        'https://github.com/NCFXZ/VoxCue-releases/releases/download/' + pkg.tag + '/' + pkg.asset,
    );
  const entry = path.join(testRoot, 'offline-electron-entry.cjs');
  await writeFile(
    entry,
    [
      "const { app, net } = require('electron');",
      'const loopbackPort = ' + JSON.stringify(loopbackPort ?? null) + ';',
      'const modelUrls = new Set(' + JSON.stringify(modelUrls) + ');',
      "const deny = () => { throw Error('Offline desktop regression forbids network access'); };",
      'function allowed(input) {',
      '  try {',
      "    const value = typeof input === 'string' || input instanceof URL ? input :",
      "      input?.url ?? ((input.protocol ?? 'http:') + '//' + (input.hostname ?? input.host) + ':' + (input.port ?? 80) + (input.path ?? '/'));",
      '    const url = new URL(value);',
      '    if (url.username || url.password) return false;',
      "    if (loopbackPort && url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port || 80) === loopbackPort) return true;",
      '    if (modelUrls.has(url.href)) return true;',
      "    return modelUrls.size > 0 && url.protocol === 'https:' && url.hostname === 'release-assets.githubusercontent.com' &&",
      "      url.pathname.startsWith('/github-production-release-asset/') &&",
      "      /attachment;\\s*filename=VoxCue-Models-(?:Speech|RAG)-1\\.0\\.0\\.zip/.test(url.searchParams.get('response-content-disposition') ?? '');",
      '  } catch { return false; }',
      '}',
      "for (const [owner, key] of [[globalThis, 'fetch'], [net, 'fetch'], [net, 'request']]) {",
      '  const original = owner[key].bind(owner);',
      '  owner[key] = (input, ...args) => allowed(input) ? original(input, ...args) : deny();',
      '}',
      "for (const name of ['node:http', 'node:https']) {",
      '  const transport = require(name);',
      "  for (const key of ['request', 'get']) {",
      '    const original = transport[key];',
      '    transport[key] = function(input, ...args) { return allowed(input) ? original.call(this, input, ...args) : deny(); };',
      '  }',
      '}',
      "const socket = require('node:net').Socket.prototype;",
      'const connect = socket.connect;',
      'socket.connect = function(...args) {',
      '  const options = Array.isArray(args[0]) ? args[0][0] : args[0];',
      "  const host = typeof options === 'object' ? options.host : args[1];",
      "  const port = typeof options === 'object' ? options.port : options;",
      "  if (!loopbackPort || host !== '127.0.0.1' || Number(port) !== loopbackPort || options?.path) return deny();",
      '  return connect.apply(this, args);',
      '};',
      "require('node:tls').connect = deny;",
      "require('node:module').syncBuiltinESMExports();",
      "app.on('session-created', session => session.webRequest.onBeforeRequest(",
      "  { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },",
      '  (details, callback) => callback({ cancel: !allowed(details.url) }),',
      '));',
      'app.setAppPath(' + JSON.stringify(workspace.platformRoot) + ');',
      'require(' +
        JSON.stringify(
          fixture ?? path.join(workspace.platformRoot, 'dist-electron/shared/electron/main.js'),
        ) +
        ');',
    ].join('\n'),
  );
  return entry;
}
