import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';

assert.equal(process.platform, 'win32');
process.env.ELECTRON_BUILDER_CACHE = path.resolve('.cache/electron-builder');
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const sharp = require('sharp');
const ts = require('typescript');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
const sevenZip = await getPath7za();
const { version } = JSON.parse(await readFile('../shared/package.json', 'utf8'));
assert.match(version, /^\d+\.\d+\.\d+$/);
const [major, minor, patch] = version.split('.').map(Number);
const packageVersion = `${major + 1}.${minor}.${patch}.0`;
const artifact = path.resolve(`release/store/VoxCue-Store-${version}-x64.appx`);

async function seven(args, limit = 32 * 1024 * 1024) {
  const child = spawnTestProcess(sevenZip, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const chunks = [];
  let bytes = 0;
  let error = '';
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > limit) child.kill();
    else chunks.push(chunk);
  });
  child.stderr.on('data', (chunk) => (error += chunk));
  const timer = setTimeout(() => child.kill(), 180000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  assert.ok(bytes <= limit, 'Bounded Store artifact read exceeded');
  assert.equal(code, 0, error);
  return Buffer.concat(chunks);
}

await seven(['t', '-bd', artifact]);
const listing = (await seven(['l', '-slt', artifact])).toString('utf8');
const paths = [...listing.matchAll(/^Path = (.+)\r?$/gm)]
  .map((match) => match[1].trim().replaceAll('\\', '/'))
  .filter((name) => name !== artifact.replaceAll('\\', '/'));
assert.equal(new Set(paths).size, paths.length, 'Duplicate APPX entries');
for (const name of paths)
  assert.ok(!/^(?:\/|[A-Za-z]:)|(?:^|\/)\.\.(?:\/|$)/.test(name), 'Unsafe APPX entry: ' + name);
const entries = new Set(paths);
async function entry(name, limit) {
  assert.ok(entries.has(name), 'Missing APPX entry: ' + name);
  return seven(['e', '-so', '-bd', artifact, name], limit);
}
const manifest = (await entry('AppxManifest.xml', 1024 * 1024)).toString('utf8');
const element = (name) => {
  const match = manifest.match(new RegExp(`<(?:(?:\\w+):)?${name}\\b[^>]*>`, 'i'));
  assert.ok(match, 'Missing manifest element: ' + name);
  return match[0];
};
const attribute = (node, name) => {
  const match = node.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, 'i'));
  assert.ok(match, 'Missing manifest attribute: ' + name);
  return match[2];
};
const identity = element('Identity');
assert.equal(attribute(identity, 'Name'), 'NCFX.VoxCue');
assert.equal(attribute(identity, 'Publisher'), 'CN=CC9C4962-FFC8-44D9-A2C0-B446CBFD375A');
assert.equal(attribute(identity, 'Version'), packageVersion);
assert.equal(attribute(identity, 'ProcessorArchitecture'), 'x64');
assert.match(manifest, /<PublisherDisplayName>F\. Zhu<\/PublisherDisplayName>/);
const application = element('Application');
assert.equal(attribute(application, 'Executable').replaceAll('\\', '/'), 'app/VoxCue.exe');
assert.equal(attribute(application, 'EntryPoint'), 'Windows.FullTrustApplication');
assert.equal(attribute(application, 'Id'), 'NCFX.VoxCue');
assert.equal(attribute(element('TargetDeviceFamily'), 'Name'), 'Windows.Desktop');
assert.match(manifest, /<rescap:Capability\s+Name="runFullTrust"\s*\/>/);
const languages = [...manifest.matchAll(/<Resource\s+Language="([^"]+)"\s*\/>/g)]
  .map((match) => match[1].toLowerCase())
  .sort();
assert.deepEqual(languages, ['en-us', 'zh-cn']);
for (const name of ['Square44x44Logo', 'Square150x150Logo'])
  assert.ok(entries.has(attribute(element('VisualElements'), name).replaceAll('\\', '/')));

const icons = [
  ['StoreLogo', 50, 50],
  ['Square44x44Logo', 44, 44],
  ['Square150x150Logo', 150, 150],
  ['Wide310x150Logo', 310, 150],
];
for (const size of [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256])
  for (const variant of ['', '_altform-unplated', '_altform-lightunplated'])
    icons.push([`Square44x44Logo.targetsize-${size}${variant}`, size, size]);
for (const [name, width, height] of icons) {
  const image = sharp(await entry(`assets/${name}.png`, 1024 * 1024));
  const metadata = await image.metadata();
  assert.equal(metadata.width, width, name);
  assert.equal(metadata.height, height, name);
  assert.equal(metadata.hasAlpha, true, name + ' retains transparency');
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = false;
  let visible = false;
  for (let index = 3; index < data.length; index += info.channels) {
    transparent ||= data[index] === 0;
    visible ||= data[index] > 0;
  }
  assert.ok(transparent && visible, name + ' is nonblank with an unplated background');
}
assert.ok(
  !paths.some((name) => /(?:^|\/)app-update\.yml$/i.test(name)),
  'Store must not ship an NSIS feed',
);
for (const name of [
  'app/VoxCue.exe',
  'app/resources/native/VoxCue.Audio.exe',
  'app/resources/native/VoxCue.Screenshot.exe',
  'app/resources/voxcue-components.json',
])
  assert.ok(entries.has(name), name);
assert.deepEqual(
  JSON.parse((await entry('app/resources/voxcue-components.json')).toString('utf8')),
  {
    schemaVersion: 1,
  },
);

const archive = path.join(testRoot, 'store-app.asar');
await writeFile(archive, await entry('app/resources/app.asar', 64 * 1024 * 1024));
const archived = asar
  .listPackage(archive)
  .map((name) => name.replaceAll('\\', '/').replace(/^\//, ''));
const allPaths = [...paths, ...archived];
assert.ok(
  !allPaths.some((name) =>
    /(?:^|\/)(?:dist-electron\/macos|Sparkle)(?:\/|$)|\.(?:dylib|so(?:\.\d+)*|icns)$|\.framework\//i.test(
      name,
    ),
  ),
  'Foreign platform files',
);
assert.ok(
  !allPaths.some((name) => /\.(?:onnx|safetensors|gguf)$/i.test(name)),
  'Model weights stay external',
);
assert.ok(
  !allPaths.some((name) =>
    /(?:^|\/)(?:ed25519\.key|auth\.json|credentials\.json|\.env)$|\.(?:pem|keychain-db)$/i.test(
      name,
    ),
  ),
  'Credential files must not be packaged',
);
assert.ok(
  !archived.some((name) =>
    /^(?:test|scripts|src|electron|server|local-models|\.git|\.tools)\//.test(name),
  ),
  'Test or development entry in application archive',
);
assert.ok(
  !paths.some((name) =>
    /^app\/resources\/app\.asar\.unpacked\/node_modules\/mammoth\/test\//.test(name),
  ),
  'Word test fixtures reserve APPX package paths',
);
const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert.equal(packagedManifest.version, version, 'Application version remains the shared version');
assert.equal(packagedManifest.main, 'dist-electron/shared/electron/main.js');
// Window policy imports pure contracts deliberately kept outside the ASAR.
for (const name of ['interviewLayout', 'presentation', 'uiLanguage', 'uiMessages']) {
  const relative = `dist-electron/shared/electron/contracts/${name}.js`;
  const file = path.join(archive + '.unpacked', relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await entry('app/resources/app.asar.unpacked/' + relative));
}
const source = (name) => asar.extractFile(archive, path.normalize(name)).toString('utf8');
const loaded = new Map();
function loadArchived(name) {
  if (loaded.has(name)) return loaded.get(name);
  const module = { exports: {} };
  loaded.set(name, module.exports);
  runInNewContext(source(name), {
    exports: module.exports,
    module,
    require: (request) => {
      assert.ok(request.startsWith('.'), 'Window policy must use only pure packaged modules');
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(name), request + '.js'),
      );
      assert.ok(!resolved.startsWith('../'));
      return loadArchived(resolved);
    },
  });
  return module.exports;
}
const windowPolicy = loadArchived('dist-electron/shared/electron/window.js');
for (const role of ['login', 'main', 'interview']) {
  const options = windowPolicy.windowOptions(
    role,
    { id: 'win32', mainWindowOptions: {} },
    { icon: 'owned.ico', preload: 'owned-preload.js' },
  );
  assert.equal(options.webPreferences.contextIsolation, true, role);
  assert.equal(options.webPreferences.sandbox, true, role);
  assert.equal(options.webPreferences.nodeIntegration, false, role);
}
let desktop;
const preloadImports = [];
runInNewContext(source('dist-electron/shared/electron/preload.js'), {
  exports: {},
  process: { argv: [], platform: 'win32' },
  require: (name) => {
    preloadImports.push(name);
    assert.equal(name, 'electron', 'Sandbox preload runtime imports only Electron');
    return {
      contextBridge: {
        exposeInMainWorld: (name, api) => {
          assert.equal(name, 'desktop');
          desktop = api;
        },
      },
      ipcRenderer: { invoke() {}, send() {}, on() {}, removeListener() {} },
    };
  },
});
assert.deepEqual(preloadImports, ['electron']);
for (const name of ['invoke', 'send', 'require', 'readFile', 'exec', 'ipcRenderer'])
  assert.equal(desktop[name], undefined, 'No raw renderer capability: ' + name);

// Evaluate the actual packaged demo IPC callback with a packaged app and an
// otherwise enabled synthetic profile. No application or credential runtime starts.
const main = ts.createSourceFile(
  'main.js',
  source(packagedManifest.main),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
let callback;
let electronBinding;
function calledName(expression) {
  if (ts.isParenthesizedExpression(expression)) return calledName(expression.expression);
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.CommaToken
  )
    return calledName(expression.right);
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return ts.isIdentifier(expression) ? expression.text : undefined;
}
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isCallExpression(node.initializer) &&
    node.initializer.expression.getText(main) === 'require' &&
    node.initializer.arguments[0]?.text === 'electron'
  )
    electronBinding = node.name.text;
  if (
    ts.isCallExpression(node) &&
    calledName(node.expression) === 'handleDesktop' &&
    node.arguments[0]?.text === 'auth:demo'
  ) {
    assert.equal(callback, undefined, 'Only one production demo entry');
    callback = node.arguments[1].getText(main);
  }
  ts.forEachChild(node, visit);
}
visit(main);
assert.ok(callback && electronBinding, 'Packaged demo guard is testable');
const demo = runInNewContext('(' + callback + ')', {
  [electronBinding]: { app: { isPackaged: true } },
  process: { env: { COPILOT_TEST_USER_DATA: testRoot } },
  requireLogin() {},
});
assert.throws(
  () => demo({}),
  /测试入口不可用/,
  'Formal Store package refuses the test login entry',
);
const hash = createHash('sha256');
for await (const chunk of createReadStream(artifact)) hash.update(chunk);
console.log(
  JSON.stringify({
    status: 'passed',
    version,
    packageVersion,
    sha256: hash.digest('hex'),
    iconCount: icons.length,
    storeIdentity: true,
    noNsisFeed: true,
    sandboxPolicy: true,
    packagedDemoDenied: true,
    installed: false,
  }),
);
