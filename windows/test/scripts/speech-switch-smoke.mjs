import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import {
  prepareModelFixtures,
  prepareSpeechFixtures,
  stageModelFixtures,
} from '../../../shared/test/scripts/model-fixtures.mjs';
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
const root = workspace.platformRoot;
async function prepareSwitchModels(cache) {
  if (!cache) return prepareModelFixtures();
  const compiled = path.join(root, 'dist-electron/shared/electron/backend/components');
  const { packagesFor } = workspace.platformRequire(path.join(compiled, 'catalog.js'));
  const { componentLocation } = workspace.platformRequire(path.join(compiled, 'service.js'));
  const speech = packagesFor(process.platform, process.arch).find((pkg) => pkg.id === 'speech');
  assert.ok(speech, 'Require the fixed Paraformer component catalog');
  const staged = path.join(testRoot, 'switch-models');
  await stageModelFixtures(path.resolve(cache), staged, [speech], componentLocation);
  return {
    speechModels: path.join(componentLocation(staged, speech), 'files', speech.directory),
    speechFixtures: await prepareSpeechFixtures(),
  };
}
const models = await prepareSwitchModels(process.env.VOXCUE_TEST_COMPONENT_CACHE);
const processFile = path.join(testRoot, 'speech-process.cjs');
await writeFile(
  processFile,
  `
const root=${JSON.stringify(root)};
const wave=require(root+'/node_modules/sherpa-onnx-node').readWave(${JSON.stringify(voice)},false);
const microphone=require(root+'/node_modules/sherpa-onnx-node').readWave(${JSON.stringify(path.join(models.speechFixtures, 'chinese.wav'))},false);
if(wave.sampleRate!==16000||microphone.sampleRate!==16000)throw Error('Synthetic input must be 16kHz');
const stats={created:0,started:0,stopped:0,packets:0,expedited:[]};let voice=false,generation=0;
const port=process.parentPort,on=port.on.bind(port);
port.on=(name,listener)=>on(name,value=>{
 const m=value.data;
 if(name==='message'&&m.test){if(m.test==='voice'){voice=m.enabled;if(voice)generation++;}port.postMessage({id:m.id,value:stats});return;}
 listener(value);
});
const capture=require(root+'/dist-electron/windows/electron/speech/capture.js');
// Observe the real controller's decision and its combined unacknowledged PCM at
// that instant. The fixture never requests an expedited switch or edits its queue.
const { SpeechController } = require(root+'/dist-electron/shared/electron/backend/speech/controller.js');
const expedite = SpeechController.prototype.expediteBackloggedSwitch;
SpeechController.prototype.expediteBackloggedSwitch = function() {
 const change = this.switching;
 const wasExpedited = change?.expedited;
 const queueMs = this.queued;
 expedite.call(this);
 if (!wasExpedited && change?.expedited) stats.expedited.push({ queueMs });
};
capture.devices=async()=>['system','microphone'].map(source=>({id:source,name:'Synthetic '+source,source,default:true}));
capture.WasapiCapture=class{
 constructor(_h,source,_d,audio){this.source=source;this.audio=audio;this.offset=0;this.voiceOffset=0;stats.created++;}
 async start(){stats.started++;const captureStart=Number(process.hrtime.bigint())/1e6;this.timer=setInterval(()=>{
  const samples=new Float32Array(1600),offset=this.offset;this.offset+=1600;
  if(this.generation!==generation){this.generation=generation;this.voiceOffset=0;}
  const at=this.voiceOffset;this.voiceOffset+=1600;
  if(voice)for(let i=0;i<samples.length;i++){
   const mic=this.source==='microphone',position=at+i-(mic?6400:0);
   samples[i]=(mic&&position>=48000?0:(mic?microphone:wave).samples[position])||0;
  }
  stats.packets++;this.audio({samples,rate:16000,timestamp:captureStart+offset/16,flags:0});
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
 const events=[];let previousModel='paraformer',previousDevice='cpu';
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
   const switched=events.length;
   const after=await host.send({test:'stats'});
   assert.equal(status.speechModel,model);assert.equal(status.inferenceDevice,device);
   assert.equal(after.created,2);assert.equal(after.started,2);assert.equal(after.stopped,0,JSON.stringify(events.filter(e=>e.type==='status'||e.type==='metrics').slice(-5)));assert.ok(after.packets>before.packets);
   const handoff = events.slice(mark, switched);
   const gaps = handoff.filter(event => event.type === 'gap');
   const expedited = after.expedited.slice(before.expedited.length);
   const oldSegments = events.slice(onset, switched).filter(event => event.type === 'segment').map(event => event.segment);
   if (expedited.length) {
    assert.equal(expedited.length, 1);
    assert.equal(previousModel, 'qwen');
    if (model === 'paraformer') assert.ok(expedited[0].queueMs >= 4000);
    else {
     assert.equal(previousDevice, 'cpu');
     assert.equal(device, 'cuda');
     assert.ok(expedited[0].queueMs >= 24000);
    }
    assert.deepEqual(gaps.map(event => event.source).sort(), [...options.sources].sort());
    assert.ok(gaps.every(event => event.message === '转写积压，已切换到所选语音配置。未完成片段不会自动用于回答。'));
   } else {
    assert.equal(gaps.length, 0, JSON.stringify(gaps));
    for (const source of options.sources) {
     const lane = oldSegments.filter(segment => segment.source === source && (segment.speechModel || 'paraformer') === previousModel);
     const finalIds = new Set(lane.filter(segment => segment.final && segment.text).map(segment => segment.id));
     const finishedAtHandoff = handoff.some(event => event.type === 'segment' && event.segment.final && finalIds.has(event.segment.id));
     const unfinished = lane.filter(segment => !segment.final && !finalIds.has(segment.id)).map(segment => segment.id);
     if (!finishedAtHandoff) {
      const timeline = events.slice(onset, switched).flatMap((event, index) => {
       if (event.type === 'speech-start') return [[index + onset - mark, event.source, 'start']];
       if (event.type !== 'segment') return [];
       const segment = event.segment;
       return [[index + onset - mark, segment.source, segment.id, segment.final ? 'final' : 'partial', segment.speechModel || 'paraformer']];
      });
      assert.fail('Old '+source+' recognizer final lost during handoff: '+JSON.stringify(timeline));
     }
     assert.deepEqual(unfinished, [], 'Retired '+source+' recognizer left partial segments unfinished');
    }
   }
   const next=events.length;
   await host.send({test:'voice',enabled:true});
   await wait(()=>options.sources.every(source=>events.slice(next).some(e=>e.type==='segment'&&e.segment.final&&e.segment.text&&e.segment.source===source&&(e.segment.speechModel||'paraformer')===model)));
   const oldIds = new Set(oldSegments.map(segment => segment.id));
   assert.ok(events.slice(switched).every(event => event.type !== 'segment' || !oldIds.has(event.segment.id)), 'Retired recognizer emitted a stale segment');
   const result = expedited.length ? 'both backlog gaps at '+expedited[0].queueMs+'ms' : 'both old finals';
   console.log('PASS Windows capture/AEC kept alive; '+result+' and both new finals; '+model+' '+device);
   previousModel=model;previousDevice=device;
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
