import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { prepareModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { prepareQwenAudio } from './qwen-fixtures.mjs';

process.env.CUDA_CACHE_PATH = path.join(testRoot, 'cuda-cache');
await mkdir(process.env.CUDA_CACHE_PATH);
const [component, voice, option] = process.argv.slice(2);
assert.ok(component && voice, 'Use a temporary verified Qwen component and fixed public wave');
assert.ok(option === undefined || option === '--skip-dual');
if (option !== '--skip-dual') {
  const { corpus } = await prepareQwenAudio();
  const dual = spawnTestProcess(
    process.env.VOXCUE_PYTHON ?? 'python',
    [
      'test/scripts/qwen-dual-smoke.py',
      component,
      corpus.find((item) => item.id === 'sample4').continuous,
      corpus.find((item) => item.id === 'sample4').continuous,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  const dualTimer = setTimeout(() => dual.kill(), 300000);
  assert.equal(
    await new Promise((resolve, reject) => {
      dual.once('error', reject);
      dual.once('exit', resolve);
    }).finally(() => clearTimeout(dualTimer)),
    0,
  );
}
const models = await prepareModelFixtures();
const root = workspace.platformRoot;
const processFile = path.join(testRoot, 'speech-process.cjs');
await writeFile(
  processFile,
  `
const root=${JSON.stringify(root)};
const wave=require(root+'/node_modules/sherpa-onnx-node').readWave(${JSON.stringify(voice)},false);
const microphone=require(root+'/node_modules/sherpa-onnx-node').readWave(${JSON.stringify(path.join(models.speechFixtures, 'chinese.wav'))},false);
if(wave.sampleRate!==16000||microphone.sampleRate!==16000)throw Error('Synthetic input must be 16kHz');
const stats={created:0,started:0,stopped:0,packets:0};let voice=false,generation=0;
const port=process.parentPort,on=port.on.bind(port);
port.on=(name,listener)=>on(name,value=>{
 const m=value.data;
 if(name==='message'&&m.test){if(m.test==='voice'){voice=m.enabled;if(voice)generation++;}port.postMessage({id:m.id,value:stats});return;}
 listener(value);
});
const capture=require(root+'/dist-electron/windows/electron/speech/capture.js');
capture.devices=async()=>['system','microphone'].map(source=>({id:source,name:'Synthetic '+source,source,default:true}));
capture.WasapiCapture=class{
 constructor(_h,source,_d,audio){this.source=source;this.audio=audio;this.offset=0;this.voiceOffset=0;stats.created++;}
 async start(){stats.started++;this.timer=setInterval(()=>{
  const samples=new Float32Array(1600),offset=this.offset;this.offset+=1600;
  if(this.generation!==generation){this.generation=generation;this.voiceOffset=0;}
  const at=this.voiceOffset;this.voiceOffset+=1600;
  if(voice)for(let i=0;i<samples.length;i++){
   const mic=this.source==='microphone',position=at+i-(mic?6400:0);
   samples[i]=(mic&&position>=48000?0:(mic?microphone:wave).samples[position])||0;
  }
  stats.packets++;this.audio({samples,rate:16000,timestamp:1000+offset/16,flags:0});
 },100);}
 async stop(){if(this.timer){clearInterval(this.timer);this.timer=undefined;stats.stopped++;}}
};
require(root+'/dist-electron/windows/electron/speech/process.js');
`,
);
await mkdir(path.join(testRoot, 'profile'));
const main = path.join(testRoot, 'main.cjs');
await writeFile(
  main,
  `
const {app}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
app.setPath('userData',${JSON.stringify(path.join(testRoot, 'profile'))});
app.setPath('sessionData',${JSON.stringify(path.join(testRoot, 'profile'))});
const {SpeechHost}=require(${JSON.stringify(path.join(root, 'dist-electron/shared/electron/backend/speech/host.js'))});
globalThis.fetch=()=>{throw Error('No network during recognition');};require('node:net').Socket.prototype.connect=globalThis.fetch;
app.whenReady().then(async()=>{
 const events=[];
 const host=new SpeechHost(${JSON.stringify(models.speechModels)},'synthetic',e=>events.push(e),${JSON.stringify(processFile)},${JSON.stringify(component)});
 const options={sources:['system','microphone'],speechModel:'paraformer',inferenceDevice:'cpu'};
 const wait=async(predicate)=>{const until=Date.now()+120000;while(!predicate()){
  const error=events.find(e=>e.type==='status'&&e.status.state==='error');if(error)throw Error(JSON.stringify(error));
  if(Date.now()>until)throw Error('Streaming deadline exceeded');await new Promise(r=>setTimeout(r,25));
 }};
 try{
  assert.equal((await host.call({op:'start',options})).state,'running');
  for(const [model,device] of [['qwen','cuda'],['qwen','cpu'],['paraformer','cpu'],['qwen','cpu'],['qwen','cuda'],['paraformer','cpu']]){
   const onset=events.length;await host.send({test:'voice',enabled:true});await wait(()=>events.slice(onset).some(e=>e.type==='speech-start'));
   const before=await host.send({test:'stats'}),mark=events.length;
   const status=await host.call({op:'switch-recognizer',options:{...options,speechModel:model,inferenceDevice:device}});
   const after=await host.send({test:'stats'});
   assert.equal(status.speechModel,model);assert.equal(status.inferenceDevice,device);
   assert.equal(after.created,2);assert.equal(after.started,2);assert.equal(after.stopped,0,JSON.stringify(events.filter(e=>e.type==='status'||e.type==='metrics').slice(-5)));assert.ok(after.packets>before.packets);
   for(const source of options.sources)assert.ok(events.slice(mark).some(e=>e.type==='segment'&&e.segment.final&&e.segment.source===source),'Old '+source+' recognizer final lost');
   const next=events.length;
   await host.send({test:'voice',enabled:true});
   await wait(()=>options.sources.every(source=>events.slice(next).some(e=>e.type==='segment'&&e.segment.final&&e.segment.source===source&&(e.segment.speechModel||'paraformer')===model)));
   console.log('PASS Windows capture/AEC kept alive; old/new finals; '+model+' '+device);
  }
  await host.send({test:'voice',enabled:false});
  const config=${JSON.stringify(path.join(component, 'asr/config.json'))},hidden=config+'.hidden';
  await fs.rename(config,hidden);
  try{await assert.rejects(host.call({op:'switch-recognizer',options:{...options,speechModel:'qwen',inferenceDevice:'cpu'}}));}
  finally{await fs.rename(hidden,config);}
  assert.equal((await host.call({op:'status'})).speechModel,'paraformer');
  assert.equal((await host.send({test:'stats'})).stopped,0);
  const changing=host.call({op:'switch-recognizer',options:{...options,speechModel:'qwen',inferenceDevice:'cpu'}});
  const cancelled=assert.rejects(changing),at=Date.now(),paused=host.call({op:'pause'});
  await cancelled;assert.ok(Date.now()-at<3000);assert.equal((await paused).state,'paused');
  const finals=events.filter(e=>e.type==='segment'&&e.segment.final);
  assert.equal(new Set(finals.map(e=>e.segment.id)).size,finals.length);
  assert.equal((await host.send({test:'stats'})).stopped,2);
  const pid=host.child.pid;await host.close();assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  console.log('PASS Windows candidate failure/cancel, no duplicate finals, captures/utilityProcess exited');app.exit(0);
 }catch(error){console.error(error);console.error(JSON.stringify(events.filter(e=>e.type==='status'||e.type==='metrics').slice(-8)));await host.close().catch(()=>{});app.exit(1);}
});
`,
);
const child = spawnTestProcess(workspace.platformRequire('electron'), [main], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: 'inherit',
  windowsHide: true,
});
const timer = setTimeout(() => child.kill(), 600000);
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
}).finally(() => clearTimeout(timer));
assert.equal(code, 0);
