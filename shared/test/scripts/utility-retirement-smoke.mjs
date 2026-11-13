import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import workspace from '../../scripts/workspace.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const utility = path.join(testRoot, 'loud-utility.cjs');
await writeFile(
  utility,
  `
const port=process.parentPort;
let held;
const flood=stream=>new Promise((resolve,reject)=>{
 let n=0;const block=Buffer.alloc(65536,120);
 function next(){while(n++<128)if(!stream.write(block)){stream.once('drain',next);return;}resolve();}
 stream.once('error',reject);next();
});
port.on('message',async({data:m})=>{
 if(m.init){await Promise.all([flood(process.stdout),flood(process.stderr)]);port.postMessage({id:m.id});}
 else if(m.late){if(held)port.postMessage({id:held,value:{state:'late'},event:{type:'late'}});}
 else if(m.call?.op==='start')held=m.id;
 else port.postMessage({id:m.id,value:m.call?{state:'idle'}:[]});
});
`,
);
const entry = path.join(testRoot, 'utility-retirement.cjs');
await writeFile(
  entry,
  `
const {app,utilityProcess}=require('electron'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
const base=${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend'))};
const {SpeechHost}=require(base+'/speech/host.js'),{KnowledgeHost}=require(base+'/knowledge/host.js');
const fixture=${JSON.stringify(utility)};
app.whenReady().then(async()=>{
 const events=[],speech=new SpeechHost('synthetic-not-read','synthetic',e=>events.push(e),fixture);
 let originalKill;
 try{
  assert.equal((await speech.call({op:'status'})).state,'idle');
  const old=speech.child,pid=old.pid;originalKill=old.kill.bind(old);
  const pending=speech.call({op:'start'}).then(()=>{throw Error('Held call unexpectedly resolved');},e=>e);
  while(!speech.pending.size)await new Promise(setImmediate);
  old.kill=()=>false;
  speech.stop();
  const blocked=speech.call({op:'status'}).then(()=>{throw Error('Unretired utility was replaced');},e=>e);
  old.postMessage({late:true});
  const errors=await Promise.all([pending,blocked]);
  assert.ok(errors.every(e=>/尚未退出/.test(e.message)));
  assert.equal(events.some(e=>e.type==='late'),false);
  assert.doesNotThrow(()=>process.kill(pid,0));
  const retired=new Promise(resolve=>old.once('exit',resolve));originalKill();await retired;
  assert.equal((await speech.call({op:'status'})).state,'idle');
  assert.notEqual(speech.child.pid,pid);
  await speech.close();
  const fork=utilityProcess.fork;
  utilityProcess.fork=(file,args,options)=>{
   assert.equal(file,require('node:path').join(base,'knowledge','process.js'));
   return fork.call(utilityProcess,fixture,args,options);
  };
  const knowledge=new KnowledgeHost(${JSON.stringify(path.join(testRoot, 'knowledge'))},'synthetic-not-read');
  try{await knowledge.initialize();assert.deepEqual(await knowledge.listDocuments(),[]);await knowledge.close();}
  finally{utilityProcess.fork=fork;await knowledge.close().catch(()=>{});}
  console.log('PASS: real Electron speech/knowledge utility drains 8 MiB per output pipe; kill=false retains the fence, late IPC is ignored, pending calls settle within the existing 10s budget and only real exit permits manual restart.');
  app.exit(0);
 }catch(error){if(originalKill)originalKill();await speech.close().catch(()=>{});console.error(error);app.exit(1);}
});
`,
);
const child = spawnTestProcess(
  workspace.platformRequire('electron'),
  [await offlineElectronEntry(entry)],
  {
    cwd: workspace.platformRoot,
    env: {
      ...process.env,
      COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    stdio: 'inherit',
  },
);
const timer = setTimeout(() => child.kill('SIGTERM'), 45000);
try {
  assert.equal(
    await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    }),
    0,
  );
} finally {
  clearTimeout(timer);
}
