import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkMacUpdateCache } from './update-cache-checks.mjs';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { installFeed } = require(
  path.join(workspace.platformRoot, 'dist-electron/macos/electron/updates/install-feed.js'),
);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicText = publicKey.export({ format: 'jwk' }).x;
const publicBase64 = Buffer.from(publicText, 'base64url').toString('base64');
const { macUpdatePayload } = require(
  path.join(workspace.platformRoot, 'dist-electron/macos/electron/updates/manifest.js'),
);
await checkMacUpdateCache(publicBase64, privateKey, macUpdatePayload);
// Sparkle may outlive its original Electron parent. Keep its resources outside
// the generic test-root reaper until their open files and mappings are released.
const nativeRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'voxcue-updater-native-')),
);
const privateFile = path.join(nativeRoot, 'fixture-key');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', env: process.env, ...options });
  if (result.error || result.status)
    throw result.error ?? Error(`${command}: ${result.stderr || result.stdout}`);
  return result.stdout;
};
// Sparkle/Launch Services may write outside the child's Foundation home. Only
// this run's unpredictable bundle identity grants cleanup authority; old domains
// and dead parent PIDs do not prove ownership or that their helpers have exited.
const bundleId = `com.voxcue.updater-fixture.p${process.pid}.${randomBytes(8).toString('hex')}`;
const nativePaths = [
  path.join(os.homedir(), 'Library/Caches', bundleId),
  path.join(os.homedir(), 'Library/Preferences', bundleId + '.plist'),
];
fs.writeFileSync(
  path.join(nativeRoot, '.owner.json'),
  JSON.stringify({ kind: 'voxcue-updater-native', pid: process.pid, bundleId }),
  { mode: 0o600 },
);
function nativeResourceStat(file) {
  if (fs.realpathSync(path.dirname(file)) !== path.dirname(file))
    throw Error('Redirected fixture resource parent');
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT' && file !== nativeRoot) return;
    throw error;
  }
  if (stat.isSymbolicLink() || stat.uid !== process.getuid())
    throw Error('Redirected or unowned fixture resource');
  if (!stat.isDirectory() && !stat.isFile()) throw Error('Unknown fixture resource type');
  return stat;
}
function waitForNativeProcesses() {
  const deadline = Date.now() + 15000;
  let empty = false;
  for (;;) {
    let active = false;
    for (const file of [nativeRoot, ...nativePaths]) {
      const stat = nativeResourceStat(file);
      if (!stat) continue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Error('Native update resource query timed out');
      // Query only owned paths, including mapped executables/libraries. macOS
      // ps comm can truncate paths even with -ww; never inspect user argv.
      const occupied = spawnSync(
        '/usr/sbin/lsof',
        ['-Fpn', ...(stat.isDirectory() ? ['+D', file] : ['--', file])],
        { encoding: 'utf8', timeout: Math.min(5000, remaining), maxBuffer: 8 * 1024 * 1024 },
      );
      if (occupied.error || occupied.signal || ![0, 1].includes(occupied.status) || occupied.stderr)
        throw Error('Cannot verify native update resource occupancy');
      if (occupied.stdout) {
        const fields = occupied.stdout.trimEnd().split('\n');
        if (
          !fields.some((field) => /^p[1-9]\d*$/.test(field)) ||
          !fields.some((field) => field.startsWith('n')) ||
          fields.some(
            (field) =>
              !/^(?:p[1-9]\d*|f.+|n.+)$/.test(field) ||
              (field.startsWith('n') &&
                field.slice(1) !== file &&
                !(stat.isDirectory() && field.slice(1).startsWith(file + path.sep))),
          )
        )
          throw Error('Unknown native update resource query output');
        // +D may exit 1 while still reporting occupied entries. Any PID/file
        // records therefore retain the resources regardless of that status.
        active = true;
        break;
      }
      if (occupied.status !== 1) throw Error('Unknown empty native update resource query');
    }
    if (!active && empty) return;
    empty = !active;
    if (Date.now() >= deadline)
      throw Error(
        'Native update processes still active; retaining owned resources at ' + nativeRoot,
      );
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}
function clearNativeDomain() {
  // Validate every path before defaults or filesystem mutations. Never follow
  // redirected parents, links or objects owned by another UID.
  for (const file of nativePaths) nativeResourceStat(file);
  const deleted = spawnSync('/usr/bin/defaults', ['delete', bundleId], { stdio: 'ignore' });
  if (deleted.error) throw deleted.error;
  for (const file of nativePaths) fs.rmSync(file, { recursive: true, force: true });
}
process.once('exit', () => {
  try {
    waitForNativeProcesses();
    const owner = JSON.parse(fs.readFileSync(path.join(nativeRoot, '.owner.json'), 'utf8'));
    const stat = fs.lstatSync(nativeRoot);
    if (
      fs.realpathSync(nativeRoot) !== nativeRoot ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      owner.kind !== 'voxcue-updater-native' ||
      owner.pid !== process.pid ||
      owner.bundleId !== bundleId
    )
      throw Error('Native update resource ownership changed');
    clearNativeDomain();
    fs.rmSync(nativeRoot, { recursive: true, force: true });
  } catch (error) {
    console.error('Native update cleanup stopped:', error.message);
    process.exitCode = 1;
  }
});
await writeFile(
  privateFile,
  Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64'),
  { mode: 0o600 },
);
const tools = path.join(workspace.platformRoot, '.tools/sparkle/2.10.0');
async function bundle(destination, version, main) {
  await cp(
    path.join(workspace.platformRoot, 'node_modules/electron/dist/Electron.app'),
    destination,
    { recursive: true, verbatimSymlinks: true },
  );
  const contents = path.join(destination, 'Contents');
  await cp(
    path.join(tools, 'Sparkle.framework'),
    path.join(contents, 'Frameworks/Sparkle.framework'),
    { recursive: true, verbatimSymlinks: true },
  );
  await mkdir(path.join(contents, 'Resources/native'), { recursive: true });
  await cp(
    path.join(workspace.platformRoot, 'native/bin/VoxCue.Updater.node'),
    path.join(contents, 'Resources/native/VoxCue.Updater.node'),
  );
  await mkdir(path.join(contents, 'Resources/app'), { recursive: true });
  await writeFile(
    path.join(contents, 'Resources/app/package.json'),
    JSON.stringify({ name: 'voxcue-updater-fixture', version, main: 'main.cjs' }),
  );
  await writeFile(path.join(contents, 'Resources/app/main.cjs'), main);
  await rm(path.join(contents, 'Resources/default_app.asar'), { force: true });
  const plist = path.join(contents, 'Info.plist');
  run('/usr/bin/python3', [
    '-c',
    'import plistlib,sys; p=sys.argv[1]; d=plistlib.load(open(p,"rb")); d.update(CFBundleIdentifier=sys.argv[4],CFBundleName="VoxCueUpdaterFixture",CFBundleVersion=sys.argv[2],CFBundleShortVersionString=sys.argv[2],SUPublicEDKey=sys.argv[3],SUEnableAutomaticChecks=False,SUAutomaticallyUpdate=False,SUEnableSystemProfiling=False,NSAppTransportSecurity={"NSAllowsLocalNetworking":True}); plistlib.dump(d,open(p,"wb"))',
    plist,
    version,
    publicBase64,
    bundleId,
  ]);
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', destination]);
}
const marker = path.join(nativeRoot, 'relaunched.json');
const profile = path.join(nativeRoot, 'profile');
const home = path.join(nativeRoot, 'foundation-home');
await mkdir(home);
const bootstrap = `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});`;
const target = path.join(nativeRoot, 'new/VoxCue.app');
await bundle(
  target,
  '0.2.2',
  bootstrap +
    `app.whenReady().then(()=>{require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({version:app.getVersion(),path:app.getAppPath(),pid:process.pid}));app.quit();});`,
);
const zip = path.join(nativeRoot, 'update.zip');
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', target, zip]);
const signature = run(path.join(tools, 'bin/sign_update'), [
  '--ed-key-file',
  privateFile,
  '-p',
  zip,
]).trim();
assert.match(signature, /^[A-Za-z0-9+/]{86}==$/);
const bytes = await readFile(zip);
const update = {
  version: '0.2.2',
  minimumSystemVersion: '14.2',
  size: bytes.length,
  url: 'VoxCue-0.2.2-arm64.zip',
  sha512: createHash('sha512').update(bytes).digest('base64'),
  edSignature: signature,
};
for (const mode of ['invalid-signature', 'cancel', 'install']) {
  await rm(marker, { force: true });
  const offered =
    mode === 'invalid-signature'
      ? { ...update, edSignature: Buffer.alloc(64).toString('base64') }
      : update;
  const feed = await installFeed(zip, offered);
  const old = path.join(nativeRoot, mode, 'VoxCue.app');
  await bundle(
    old,
    '0.2.1',
    bootstrap +
      `app.whenReady().then(()=>{const native=require('../native/VoxCue.Updater.node');native.begin(${JSON.stringify(feed.url)},event=>{console.log('UPDATE_EVENT '+JSON.stringify(event));if(event.type==='ready'){${mode === 'cancel' ? 'native.cancel();app.quit();' : 'native.commit();'}}if(event.type==='quit')app.quit();if(event.type==='error')app.quit();});});`,
  );
  let output = '';
  const child = spawnTestProcess(path.join(old, 'Contents/MacOS/Electron'), [], {
    env: { ...process.env, CFFIXED_USER_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => {
    output += data;
    process.stdout.write(data);
  });
  child.stderr.on('data', (data) => {
    output += data;
    process.stderr.write(data);
  });
  try {
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 90000;
      const timer = setInterval(async () => {
        try {
          if (mode !== 'install') {
            if (child.exitCode === null) {
              if (Date.now() > deadline) throw Error('Native rejection/cancel timed out');
              return;
            }
            assert.equal(
              await readFile(marker).then(
                () => true,
                () => false,
              ),
              false,
            );
            const version = run('/usr/libexec/PlistBuddy', [
              '-c',
              'Print :CFBundleVersion',
              path.join(old, 'Contents/Info.plist'),
            ]).trim();
            assert.equal(version, '0.2.1');
            assert.match(output, mode === 'cancel' ? /"type":"ready"/ : /"type":"error"/);
            assert.doesNotMatch(output, /"type":"quit"/);
          } else {
            const value = JSON.parse(await readFile(marker, 'utf8'));
            assert.equal(value.version, '0.2.2');
            assert.equal(value.path, path.join(old, 'Contents/Resources/app'));
            assert.match(output, /"type":"ready"/);
            assert.match(output, /"type":"quit"/);
          }
          clearInterval(timer);
          resolve();
        } catch (error) {
          if (
            error.code === 'ENOENT' &&
            Date.now() <= deadline &&
            !output.includes('"type":"error"')
          )
            return;
          clearInterval(timer);
          reject(
            Error('Native update ' + mode + ': ' + error.message + '\n' + output.slice(-6000)),
          );
        }
      }, 250);
    });
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', old]);
    console.log('PASS: real Sparkle ' + mode + ' with temporary signed app bundles.');
  } finally {
    feed.close();
    if (child.exitCode === null) child.kill();
    waitForNativeProcesses();
  }
}
