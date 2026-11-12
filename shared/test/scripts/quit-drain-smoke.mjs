import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, spawnTestProcess, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

if (process.platform === 'win32') {
  const { probe } = await import('../../../windows/test/scripts/window-probe.mjs');
  assert.equal(probe('desktop').interactive, true, 'Unlocked owner console required');
} else {
  const desktop = await import(
    pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/desktop-session.mjs')).href
  );
  desktop.requireUnlockedDesktop();
}

const module = path.join(workspace.platformRoot, 'dist-electron/shared/electron/window.js');
for (const delayed of [false, true]) {
  const fixture = path.join(testRoot, 'quit-drain-main.cjs');
  await writeFile(
    fixture,
    `
const assert=require('node:assert/strict');
const {app}=require('electron');
const {guardQuitDrain}=require(${JSON.stringify(module)});
app.disableHardwareAcceleration();
let complete=false, drains=0, attempts=0;
guardQuitDrain(app,async()=>{
  drains++;
  if(${delayed})await new Promise(resolve=>setTimeout(resolve,50));
  complete=true;
});
app.on('will-quit',()=>attempts++);
app.on('quit',()=>{
  assert.equal(complete,true);assert.equal(drains,1);
  assert.ok(attempts>=${delayed ? 3 : 2});
  console.log(JSON.stringify({realElectronQuit:true,delayed:${delayed},drains,attempts}));
});
app.whenReady().then(()=>{
  app.quit();
  if(${delayed})setTimeout(()=>app.quit(),10);
});
`,
  );
  const env = { ...process.env, COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnTestProcess(
    workspace.platformRequire('electron'),
    [await offlineElectronEntry(fixture)],
    { cwd: workspace.platformRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
  const timer = setTimeout(() => child.kill(), 10000);
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, 'Electron must finish quitting without a forced teardown');
}

// Exercise the real product assembly, not only the standalone drain helper.
const appData = path.join(testRoot, 'quit-sdk-app-data');
const profile = path.join(appData, 'VoxCue');
const outcome = path.join(testRoot, 'quit-sdk-state.json');
const fixture = path.join(testRoot, 'quit-sdk-main.cjs');
await mkdir(profile, { recursive: true });
await writeFile(
  fixture,
  `
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=${JSON.stringify(workspace.platformRoot)};
const base=path.join(root,'dist-electron/shared/electron');
app.setPath('appData',${JSON.stringify(appData)});
app.setPath('userData',${JSON.stringify(profile)});
app.setPath('sessionData',${JSON.stringify(profile)});
// Keep ordinary paths isolated before disabling the launcher's demo/auth flag.
delete process.env.COPILOT_TEST_USER_DATA;
for(const [module,name] of [
  ['backend/auth/service.js','ChatGPTAuthService'],
  ['backend/copilot/auth.js','CopilotAuthService'],
])require(path.join(base,module))[name].prototype.session=async()=>null;
const state={codex:{calls:0,settled:false},copilot:{calls:0,settled:false},repeatedQuit:false};
let repeatScheduled=false;
for(const [module,name,key,delay] of [
  ['backend/chat/codexUsage.js','CodexUsageRuntime','codex',600],
  ['backend/copilot/runtime.js','CopilotRuntime','copilot',1100],
]){
  const Runtime=require(path.join(base,module))[name];
  const pending=new WeakMap();
  Runtime.prototype.stop=function(){
    state[key].calls++;
    if(!pending.has(this))pending.set(this,new Promise(resolve=>setTimeout(()=>{
      state[key].settled=true;resolve();
    },delay)));
    if(!repeatScheduled){
      repeatScheduled=true;
      setTimeout(()=>{state.repeatedQuit=true;app.quit();},20);
    }
    return pending.get(this);
  };
}
app.on('quit',(_event,exitCode)=>fs.writeFileSync(${JSON.stringify(outcome)},JSON.stringify({
  ...state,exitCode,fixtureEnabled:!!process.env.COPILOT_TEST_USER_DATA,
  appData:app.getPath('appData'),userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),
})));
require(path.join(base,'main.js'));
`,
);
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: profile,
  VOXCUE_ACCOUNT_API: '',
  VITE_DEV_SERVER_URL: '',
};
delete env.ELECTRON_RUN_AS_NODE;
const product = await electron.launch({
  args: [await offlineElectronEntry(fixture)],
  env,
});
const child = product.process();
let timer;
try {
  const login = await product.firstWindow();
  login.setDefaultTimeout(20000);
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  assert.equal(await login.evaluate(() => window.desktop.authSession()), null);
  const exited = new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  let timedOut = false;
  timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 20000);
  // Return from inspector evaluation before requesting an actual product quit.
  await product.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 20);
  });
  const code = await exited;
  assert.equal(timedOut, false, 'Product quit must finish within its original drain budget');
  assert.equal(code, 0, 'Product main must exit naturally');
  const result = JSON.parse(await readFile(outcome, 'utf8'));
  assert.deepEqual(
    result,
    {
      codex: { calls: 1, settled: true },
      copilot: { calls: 1, settled: true },
      repeatedQuit: true,
      exitCode: 0,
      fixtureEnabled: false,
      appData,
      userData: profile,
      sessionData: profile,
    },
    'Real product quit must wait for both SDK stops; repeated quit cannot bypass the drain',
  );
  console.log('PASS real product quit waits for both synthetic SDK stops and repeated quit');
} finally {
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) child.kill();
}
