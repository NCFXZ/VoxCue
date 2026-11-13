import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.platform !== 'darwin') throw Error('Credential language bootstrap is Mac-only');
const directory = await mkdtemp(path.join(testRoot, 'language-bootstrap-'));
let app;
async function launch(profile, preferred, holdLanguage, testCredentials = false) {
  const fixture = path.join(directory, 'bootstrap.cjs');
  await writeFile(fixture, `
const {app, BrowserWindow, ipcMain}=require('electron');
const {EventEmitter}=require('node:events');
const root=process.cwd();
const state=globalThis.languageBootstrap={
  seen:[], forwarded:[], shown:[], native:[], unhandled:[], statusCalls:0,
  busyResults:0, active:false, cloudReleased:false, cryptoOutcome:null,
  holdLanguage:${JSON.stringify(holdLanguage)}, pendingLanguage:[]
};
process.on('unhandledRejection',error=>state.unhandled.push(String(error?.message??error)));
let releaseCloud;
const cloudGate=new Promise(resolve=>{releaseCloud=resolve;});
state.releaseCloud=()=>{state.cloudReleased=true;releaseCloud();};
app.on('browser-window-created',(_event,win)=>win.on('show',()=>state.shown.push(win.webContents.getURL())));
const register=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>register(channel,(event,...args)=>{
  if(channel!=='appearance:language')return handler(event,...args);
  state.seen.push(args[0]);
  const apply=()=>{const result=handler(event,...args);state.forwarded.push(args[0]);return result;};
  if(!state.holdLanguage)return apply();
  return new Promise((resolve,reject)=>state.pendingLanguage.push({apply,resolve,reject}));
});
state.releaseLanguage=()=>{
  state.holdLanguage=false;
  for(const pending of state.pendingLanguage.splice(0))
    Promise.resolve().then(pending.apply).then(pending.resolve,pending.reject);
};
const credentialFile=root+'/dist-electron/macos/electron/credentials.js';
// The ordinary UI wrapper installs safeStorage; this narrow case exercises the
// real JS queue against the fixed synthetic protocol below instead.
delete require.cache[require.resolve(credentialFile)];
const credentials=require(credentialFile);
const createCredentials=credentials.createCredentialEncryption;
const cp=require('node:child_process'),spawn=cp.spawn;
let fakeExecutable;
cp.spawn=(file,...args)=>{
  if(file!==fakeExecutable)return spawn(file,...args);
  // Fixed in-memory native protocol only. No helper process, Keychain or password.
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  child.stdin=new EventEmitter();child.kill=()=>true;
  child.stdin.end=raw=>{
    const request=JSON.parse(raw);state.native.push(request);
    const reply=request.operation==='probe'?{state:'ready'}:{data:request.data};
    setImmediate(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify(reply)));child.emit('close',0);});
  };
  return child;
};
credentials.createCredentialEncryption=(file,confirm,language)=>{
  fakeExecutable=file;
  const crypto=createCredentials(file,confirm,language);state.crypto=crypto;
  if(${JSON.stringify(testCredentials)})
    void crypto.encrypt('Synthetic bootstrap credential').then(
      ()=>{state.cryptoOutcome='resolved';},()=>{state.cryptoOutcome='rejected';});
  return crypto;
};
const {CloudAccountClient}=require(root+'/dist-electron/shared/electron/backend/cloud/client.js');
const user={id:'a0000000-0000-4000-8000-000000000001',email:'synthetic@example.test',createdAt:1};
const snapshot=()=>({configured:true,verified:state.cloudReleased,user:state.cloudReleased?user:null});
CloudAccountClient.prototype.snapshot=snapshot;
CloudAccountClient.prototype.call=async function(input){
  if(input.action!=='status')throw Error('Unexpected synthetic account action');
  state.statusCalls++;
  if(state.active){state.busyResults++;return {ok:false,state:snapshot(),error:'Synthetic busy'};}
  state.active=true;
  try{await cloudGate;return {ok:true,state:snapshot()};}finally{state.active=false;}
};
require(root+'/dist-electron/shared/electron/main.js');
`);
  const entry = await offlineElectronEntry(fixture, { preferredLanguages: [preferred] });
  app = await electron.launch({
    args: [entry],
    env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
  });
  const page = await app.firstWindow();
  await waitForAsync(app, () => globalThis.languageBootstrap.seen.length > 0);
  return page;
}
async function stop() {
  if (app) await closeUiApp(app);
  app = undefined;
}
try {
  for (const [preferred, saved] of [['zh-CN', 'en'], ['en-GB', 'zh-CN']]) {
    const profile = path.join(directory, 'profile-' + saved);
    let page = await launch(profile, preferred, false);
    await page.evaluate((language) => {
      localStorage.setItem('voxcue-language-v1', language);
      dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
    }, saved);
    await waitForAsync(app, (_electron, expected) =>
      globalThis.languageBootstrap.forwarded.at(-1) === expected, saved);
    await stop();

    page = await launch(profile, preferred, true, true);
    assert.equal(await app.evaluate(() => globalThis.languageBootstrap.seen[0]), saved);
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => ({
      shown: globalThis.languageBootstrap.shown,
      native: globalThis.languageBootstrap.native,
      visible: BrowserWindow.getAllWindows().some((win) => win.isVisible()),
    })), { shown: [], native: [], visible: false });
    await app.evaluate(({ app }) => app.emit('second-instance', {}, [], ''));
    assert.equal(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) => win.isVisible())), false);
    await app.evaluate(() => globalThis.languageBootstrap.releaseLanguage());
    await waitForAsync(app, () => globalThis.languageBootstrap.cryptoOutcome === 'resolved');
    await waitForAsync(app, () => globalThis.languageBootstrap.statusCalls === 1);
    assert.deepEqual(await app.evaluate(() => ({
      languages: [...new Set(globalThis.languageBootstrap.native.map((request) => request.language))],
      busy: globalThis.languageBootstrap.busyResults,
      shown: globalThis.languageBootstrap.shown,
    })), { languages: [saved], busy: 0, shown: [] });
    const mainCreated = app.waitForEvent('window');
    await app.evaluate(() => globalThis.languageBootstrap.releaseCloud());
    const main = await mainCreated;
    await main.locator('.interview-start-trigger').waitFor();
    await waitForAsync(app, ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return windows.length === 1 && windows[0].isVisible();
    });
    assert.equal(await main.evaluate(() => document.documentElement.lang), saved);
    assert.deepEqual(await app.evaluate(() => ({
      loginShown: globalThis.languageBootstrap.shown.some((url) => url.endsWith('#login')),
      busy: globalThis.languageBootstrap.busyResults,
      unhandled: globalThis.languageBootstrap.unhandled,
    })), { loginShown: false, busy: 0, unhandled: [] });
    await stop();
    console.log('Bootstrap cross-language restore:', preferred, '->', saved);
  }

  for (const failure of ['timeout', 'renderer']) {
    const page = await launch(path.join(directory, failure), 'en-GB', true, true);
    if (failure === 'renderer')
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    await waitForAsync(app, () => globalThis.languageBootstrap.cryptoOutcome === 'rejected',
      undefined, { timeout: 15000 });
    assert.deepEqual(await app.evaluate(() => ({
      native: globalThis.languageBootstrap.native,
      statusCalls: globalThis.languageBootstrap.statusCalls,
    })), { native: [], statusCalls: 0 });
    if (failure === 'renderer') {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
      await waitForAsync(app, () => globalThis.languageBootstrap.seen.length >= 2);
    }
    await app.evaluate(() => globalThis.languageBootstrap.releaseLanguage());
    await waitForAsync(app, () => globalThis.languageBootstrap.forwarded.length > 0);
    assert.equal(await app.evaluate(async () => {
      try {
        await globalThis.languageBootstrap.crypto.encrypt('Synthetic late credential');
        return false;
      } catch { return true; }
    }), true);
    assert.deepEqual(await app.evaluate(() => ({
      native: globalThis.languageBootstrap.native,
      unhandled: globalThis.languageBootstrap.unhandled,
    })), { native: [], unhandled: [] });
    await stop();
    console.log('Bootstrap failure fence:', failure);
  }
  console.log('PASS: persisted cross-language startup, hidden login, shared restore status, second-instance, actual language timeout and renderer-failure fences. Synthetic protocol only; no Keychain access.');
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
