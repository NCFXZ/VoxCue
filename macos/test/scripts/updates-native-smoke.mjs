import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
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
const privateFile = path.join(testRoot, 'fixture-key');
await writeFile(
  privateFile,
  Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64'),
  { mode: 0o600 },
);
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', env: process.env, ...options });
  if (result.error || result.status)
    throw result.error ?? Error(`${command}: ${result.stderr || result.stdout}`);
  return result.stdout;
};
// Sparkle/Launch Services may create a preferences domain outside the child's
// Foundation home. Use a unique test-only domain and remove it even on signals.
const domainPattern = /^com\.voxcue\.updater-fixture\.p(\d+)\.[a-f0-9]{16}$/;
function clearNativeDomain(domain) {
  if (!domainPattern.test(domain) && domain !== 'com.voxcue.updater-fixture')
    throw Error('Invalid fixture domain');
  spawnSync('/usr/bin/defaults', ['delete', domain], { stdio: 'ignore' });
  for (const relative of ['Library/Caches/' + domain, 'Library/Preferences/' + domain + '.plist']) {
    const file = path.join(os.homedir(), relative);
    if (!fs.existsSync(file)) continue;
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('Redirected fixture domain');
    fs.rmSync(file, { recursive: true, force: true });
  }
}
for (const relative of ['Library/Caches', 'Library/Preferences']) {
  const parent = path.join(os.homedir(), relative);
  for (const name of fs.readdirSync(parent)) {
    const domain = name.replace(/\.plist$/, '');
    const match = domainPattern.exec(domain);
    if (!match) continue;
    try {
      process.kill(Number(match[1]), 0);
    } catch (error) {
      if (error.code === 'ESRCH') clearNativeDomain(domain);
    }
  }
}
const bundleId = `com.voxcue.updater-fixture.p${process.pid}.${randomBytes(8).toString('hex')}`;
process.once('exit', () => {
  clearNativeDomain(bundleId);
  clearNativeDomain('com.voxcue.updater-fixture');
});
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
const marker = path.join(testRoot, 'relaunched.json');
const profile = path.join(testRoot, 'profile');
const home = path.join(testRoot, 'foundation-home');
await mkdir(home);
const bootstrap = `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});`;
const target = path.join(testRoot, 'new/VoxCue.app');
await bundle(
  target,
  '0.2.2',
  bootstrap +
    `app.whenReady().then(()=>{require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({version:app.getVersion(),path:app.getAppPath(),pid:process.pid}));app.quit();});`,
);
const zip = path.join(testRoot, 'update.zip');
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
  const old = path.join(testRoot, mode, 'VoxCue.app');
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
  }
}
