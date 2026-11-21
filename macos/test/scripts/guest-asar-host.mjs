import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { testRoot, trackTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { requireGuestIsolation } from './guest-isolation.mjs';
import { verifyLocalApp } from '../../scripts/development-signing.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { requireUnlockedDesktop } from './desktop-session.mjs';
import assert from 'node:assert/strict';

/** The final ASAR/renderer/native closure in a known development host, in the VM only.
 * The untouched product executable is tested separately, without an inspector.
 */
export async function launchGuestAsar(bundle, { env = process.env, upgradeAccounts = false } = {}) {
  const guest = await requireGuestIsolation();
  const pin = workspace.platformRequire(
    path.join(workspace.platformRoot, 'local-signing-public.json'),
  );
  verifyLocalApp(bundle, pin, 'com.voxcue.app');
  const resources = path.join(bundle, 'Contents/Resources');
  const archive = path.join(resources, 'app.asar');
  const profile = env.COPILOT_TEST_USER_DATA;
  if (!profile?.startsWith(testRoot + path.sep))
    throw Error('Guest ASAR requires this test run’s owned profile');
  const entry = path.join(testRoot, 'guest-asar-entry-' + Date.now() + '.cjs');
  await writeFile(
    entry,
    `
const {app,safeStorage}=require('electron');
const {net}=require('electron');
const path=require('node:path');
const root=${JSON.stringify(archive)},profile=${JSON.stringify(profile)};
require('node:fs').mkdirSync(profile,{recursive:true,mode:0o700});
app.setAppPath(root); app.setName('VoxCue');
// Match the ordinary offline UI fixture's explicit synthetic language port.
app.getPreferredSystemLanguages=()=>['zh-CN'];
app.setPath('appData',path.dirname(profile)); app.setPath('userData',profile); app.setPath('sessionData',profile);
// Keep the production runtime policy; the appData parent itself is guest-owned.
Object.defineProperty(app,'isPackaged',{value:true});
Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)}});
app.getVersion=()=>require(root+'/package.json').version;
app.commandLine.appendSwitch('use-mock-keychain');
const allowed=input=>{try{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);return url.protocol==='http:'&&['127.0.0.1',${JSON.stringify(guest.syntheticIPv4)}].includes(url.hostname);}catch{return false;}};
for(const [owner,key] of [[globalThis,'fetch'],[net,'fetch'],[net,'request']]){
 const original=owner[key].bind(owner);owner[key]=(input,...args)=>{
  if(!allowed(input))throw Error('Guest GUI transport permits only its owned synthetic peers');
  return original(input,...args);
 };
}
const cp=require('node:child_process'),spawn=cp.spawn;
cp.spawn=(file,...args)=>{
 if(['VoxCue','VoxCue.Credentials','codex','copilot-runtime'].includes(path.basename(String(file))))throw Error('Ordinary GUI fixtures forbid credential-owning subprocesses');
 return spawn(file,...args);
};
require(root+'/dist-electron/macos/electron/credentials.js').createCredentialEncryption=()=>({
 encrypt:async value=>safeStorage.encryptString(value),decrypt:async value=>safeStorage.decryptString(value)
});
const fixturePlatform=require(root+'/dist-electron/macos/electron/platform.js').macos;
fixturePlatform.promptApiKey=fixturePlatform.controlApiKey=fixturePlatform.createRemoteTls=undefined;
${upgradeAccounts ? 'require(' + JSON.stringify(path.join(workspace.sharedRoot, 'test/fixtures/install-primary-account.cjs')) +
  ')(root,{secondAccount:true});' : ''}
const {CodexUsageRuntime}=require(root+'/dist-electron/shared/electron/backend/chat/codexUsage.js');
CodexUsageRuntime.prototype.account=async()=>null;
CodexUsageRuntime.prototype.limits=async()=>({});
for(const [file,name] of [['auth/service','ChatGPTAuthService'],['copilot/auth','CopilotAuthService']])
 require(root+'/dist-electron/shared/electron/backend/'+file+'.js')[name].prototype.session=async()=>null;
// No test profile flag reaches packaged main; all three paths are already fixed.
delete process.env.COPILOT_TEST_USER_DATA;
require(root+'/dist-electron/shared/electron/main.js');
`,
  );
  requireUnlockedDesktop();
  const executable = path.join(
    workspace.platformRoot,
    '.tools/electron-dev/Electron.app/Contents/MacOS/Electron',
  );
  verifyLocalApp(path.resolve(executable, '../../..'), pin, 'com.voxcue.development', {
    strict: false,
  });
  const app = await workspace.platformRequire('playwright')._electron.launch({
    executablePath: executable,
    args: [entry],
    env: { ...env, ELECTRON_RUN_AS_NODE: undefined, VITE_DEV_SERVER_URL: '' },
  });
  trackTestProcess(app.process());
  const paths = await app.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
  }));
  try {
    assert.deepEqual(paths, { userData: profile, sessionData: profile });
  } catch (error) {
    await app.close();
    throw error;
  }
  const timer = setInterval(() => {
    try {
      requireUnlockedDesktop();
    } catch {
      app.process().kill('SIGTERM');
    }
  }, 2000);
  timer.unref();
  app.process().once('exit', () => clearInterval(timer));
  return app;
}

/** Inspector use is restricted to an unchanged historical release inside the VM. */
export async function launchLegacyGuestProduct(bundle, env, version = '1.1.1') {
  await requireGuestIsolation();
  if (version !== '1.1.1') throw Error('Only the protected 1.1.1 migration baseline is accepted');
  const asar = await import(workspace.platformRequire.resolve('@electron/asar'));
  const metadata = JSON.parse(
    asar.extractFile(path.join(bundle, 'Contents/Resources/app.asar'), 'package.json').toString(),
  );
  if (metadata.version !== version || !env.COPILOT_TEST_USER_DATA?.startsWith(testRoot + path.sep))
    throw Error('Historical package/profile does not match the guest migration fixture');
  const pin = workspace.platformRequire(
    path.join(workspace.platformRoot, 'local-signing-public.json'),
  );
  verifyLocalApp(bundle, pin, 'com.voxcue.app');
  requireUnlockedDesktop();
  const app = await workspace.platformRequire('playwright')._electron.launch({
    executablePath: path.join(bundle, 'Contents/MacOS/VoxCue'),
    args: ['--use-mock-keychain'],
    env: { ...env, ELECTRON_RUN_AS_NODE: undefined },
  });
  trackTestProcess(app.process());
  const paths = await app.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
  }));
  if (
    paths.userData !== env.COPILOT_TEST_USER_DATA ||
    paths.sessionData !== env.COPILOT_TEST_USER_DATA
  ) {
    await app.close();
    throw Error('Historical package did not select the owned synthetic migration profile');
  }
  await app.evaluate(() => {
    const cp = process.getBuiltinModule('child_process'), spawn = cp.spawn;
    cp.spawn = (file, ...args) => {
      if (String(file).split('/').pop() === 'VoxCue' || /(?:VoxCue\.Credentials|\/codex|\/copilot-runtime)$/.test(String(file)))
        throw Error('Ordinary migration GUI forbids credential-owning subprocesses');
      return spawn(file, ...args);
    };
  });
  const page = await app.firstWindow();
  await page.waitForURL('**/index.html#login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('voxcue-language-v1', 'zh-CN'));
  return app;
}
