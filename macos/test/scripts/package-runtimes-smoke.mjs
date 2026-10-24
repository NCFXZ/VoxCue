import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const version = workspace.platformRequire(
  path.join(workspace.platformRoot, 'package.json'),
).version;
const directory = path.join(testRoot, 'archive');
await mkdir(directory);
const extracted = spawnSync(
  '/usr/bin/ditto',
  [
    '-x',
    '-k',
    path.join(workspace.platformRoot, 'release', version, `VoxCue-${version}-arm64.zip`),
    directory,
  ],
  { encoding: 'utf8' },
);
assert.equal(extracted.status, 0, extracted.stderr);
const archive = path.join(directory, 'VoxCue.app/Contents/Resources/app.asar');
const fixture = path.join(testRoot, 'packaged-runtimes.cjs');
await writeFile(
  fixture,
  `
const {app}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const load=require('node:module').createRequire(${JSON.stringify(archive)}+'/package.json');
app.setAppPath(${JSON.stringify(archive)});
app.setPath('userData',${JSON.stringify(path.join(testRoot, 'profile'))});
app.whenReady().then(async()=>{
 const directory=${JSON.stringify(path.join(testRoot, 'runtimes'))};await fs.mkdir(directory,{recursive:true});
 const {CopilotClient}=load('@github/copilot-sdk');
 const {copilotRuntimeConnection}=load('./dist-electron/shared/electron/backend/copilot/runtime.js');
 assert.equal(JSON.parse(await fs.readFile(path.join(app.getAppPath(),'node_modules/@github/copilot-sdk/package.json'),'utf8')).version,'1.0.21');
 const env={...process.env};for(const key of Object.keys(env))if(/^(?:COPILOT_|GITHUB_|GH_|OTEL_)/i.test(key))delete env[key];
 Object.assign(env,{GH_CONFIG_DIR:path.join(directory,'gh-unused'),CFFIXED_USER_HOME:directory,XDG_CONFIG_HOME:directory,XDG_CACHE_HOME:directory,XDG_STATE_HOME:directory,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:''});
 const client=new CopilotClient({connection:copilotRuntimeConnection(),mode:'empty',baseDirectory:path.join(directory,'copilot'),workingDirectory:directory,env,useLoggedInUser:false,enableRemoteSessions:false,logLevel:'none'});
 let timer;try{
  await Promise.race([(async()=>{await client.start();assert.equal((await client.ping('packaged-runtime')).message,'pong: packaged-runtime');})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Packaged Copilot handshake timed out')),20000);})]);
  console.log('PASS: final ASAR Copilot SDK and bundled subprocess handshake, no account/session/credential access');
 }finally{clearTimeout(timer);assert.equal((await client.stop()).length,0);}
 const {CodexUsageRuntime}=load('./dist-electron/shared/electron/backend/chat/codexUsage.js');
 const launch=(binary,args,options)=>require('node:child_process').spawn('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny network*)',binary,...args.map(v=>v==='cli_auth_credentials_store="keyring"'?'cli_auth_credentials_store="file"':v)],{...options,env:{...options.env,...env}});
 const runtime=new CodexUsageRuntime(path.join(directory,'codex'),launch,${JSON.stringify(version)});
 try{assert.equal(await runtime.account(),null);console.log('PASS: final ASAR fixed Codex subprocess account RPC, isolated empty file fixture and denied network');}finally{await runtime.stop();}
 app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
`,
);
const child = spawnTestProcess(
  workspace.platformRequire('electron'),
  [await offlineElectronEntry(fixture)],
  {
    cwd: workspace.platformRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'inherit',
  },
);
const timer = setTimeout(() => child.kill('SIGTERM'), 60000);
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
}).finally(() => clearTimeout(timer));
assert.equal(code, 0, 'Final package runtime checks failed');
