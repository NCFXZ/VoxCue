import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Load production code and SDKs from the final ASAR, with executables resolved
// by the production selectors into that package's physical unpacked tree.
export async function checkPackageRuntimes(packageRoot) {
  assert.equal(process.platform, 'win32');
  const archive = path.join(packageRoot, 'resources/app.asar');
  const directory = path.join(testRoot, 'packaged-runtimes');
  await mkdir(directory);
  const fixture = path.join(testRoot, 'packaged-runtimes.cjs');
  await writeFile(
    fixture,
    `
const {app}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const load=require('node:module').createRequire(${JSON.stringify(archive)}+'/package.json');
app.setAppPath(${JSON.stringify(archive)});
app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async()=>{
 const directory=${JSON.stringify(directory)};
 const env={...process.env};
 for(const key of Object.keys(env))if(/^(?:COPILOT_|GITHUB_|GH_|CODEX_|OPENAI_|AZURE_OPENAI_|OTEL_)/i.test(key))delete env[key];
 Object.assign(env,{GH_CONFIG_DIR:path.join(directory,'gh-unused'),XDG_CONFIG_HOME:directory,XDG_CACHE_HOME:directory,XDG_STATE_HOME:directory,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:''});
 const {CopilotClient}=load('@github/copilot-sdk');
 const {copilotRuntimeConnection}=load('./dist-electron/shared/electron/backend/copilot/runtime.js');
 const client=new CopilotClient({connection:copilotRuntimeConnection(),mode:'empty',baseDirectory:path.join(directory,'copilot'),workingDirectory:directory,env,useLoggedInUser:false,enableRemoteSessions:false,logLevel:'none'});
 let timer;
 try{
  await Promise.race([(async()=>{await client.start();assert.equal((await client.ping('packaged-runtime')).message,'pong: packaged-runtime');})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Packaged Copilot handshake timed out')),20000);})]);
  console.log('PASS: final Windows ASAR Copilot stdio handshake and ping; no account/session/credential access');
 }finally{clearTimeout(timer);assert.equal((await client.stop()).length,0);}
 const {CodexUsageRuntime,codexUsageExecutable}=load('./dist-electron/shared/electron/backend/chat/codexUsage.js');
 assert.ok(codexUsageExecutable().startsWith(${JSON.stringify(path.join(packageRoot, 'resources/app.asar.unpacked'))}+path.sep));
 const sockets=new Set();
 const proxy=require('node:net').createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));socket.resume();});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const proxyUrl='http://127.0.0.1:'+proxy.address().port;
 const launch=(binary,args,options)=>require('node:child_process').spawn(binary,args.map(v=>v==='cli_auth_credentials_store="keyring"'?'cli_auth_credentials_store="file"':v),{...options,env:{...options.env,...env,HTTP_PROXY:proxyUrl,HTTPS_PROXY:proxyUrl,ALL_PROXY:proxyUrl}});
 const home=path.join(directory,'codex');
 const runtime=new CodexUsageRuntime(home,launch);
 try{
  assert.equal(await runtime.account(),null);await runtime.stop();
  const part=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const token=part({alg:'none'})+'.'+part({sub:'synthetic',email:'synthetic@example.test',exp:Math.floor(Date.now()/1000)+3600,'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-workspace',chatgpt_plan_type:'plus'}})+'.synthetic';
  await fs.writeFile(path.join(home,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{id_token:token,access_token:token,refresh_token:'synthetic-refresh',account_id:'synthetic-workspace'},last_refresh:new Date().toISOString()}));
  const started=performance.now();
  let accessTimer;
  try{
   const access=await Promise.race([runtime.access(),new Promise((_,reject)=>{accessTimer=setTimeout(()=>reject(Error('Packaged valid session waited for remote renewal')),5000);})]);
   assert.equal(access.token,token);
  }finally{clearTimeout(accessTimer);}
  console.log('PASS: final Windows ASAR Codex valid fabricated token returned in '+Math.round(performance.now()-started)+'ms with remote traffic stalled; isolated file store, no real OAuth');
 }finally{await runtime.stop();for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));}
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
      windowsHide: true,
    },
  );
  const timer = setTimeout(() => child.kill(), 60000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, 'Final Windows package runtime checks failed');
}
