import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import {
  prepareSpeechFixtures,
  stageModelFixtures,
} from '../../../shared/test/scripts/model-fixtures.mjs';
import { probe } from './window-probe.mjs';

assert.equal(process.platform, 'win32');
assert.equal(
  probe('desktop').interactive,
  true,
  'Native verification requires the unlocked owner desktop',
);
const root = workspace.platformRoot;
const backend = path.join(root, 'dist-electron/shared/electron/backend');
const { packagesFor } = workspace.platformRequire(path.join(backend, 'components/catalog.js'));
const { componentLocation } = workspace.platformRequire(
  path.join(backend, 'components/service.js'),
);
const packages = packagesFor(process.platform, process.arch).filter((pkg) => pkg.id === 'speech');
assert.equal(packages.length, 1, 'Require the fixed Paraformer component catalog');
const staged = path.join(testRoot, 'speech-component');
// Missing or altered cached models fail here. This script never downloads models
// and never reads an installed user's component directory or credentials.
await stageModelFixtures(
  path.join(root, '.cache/test-components'),
  staged,
  packages,
  componentLocation,
);
const model = path.join(componentLocation(staged, packages[0]), 'files', packages[0].directory);
const fixtures = await prepareSpeechFixtures();
const processFile = path.join(testRoot, 'input-state-process.cjs');
const profile = path.join(testRoot, 'profile');
await mkdir(profile);
const config = { root, model, fixtures, processFile, profile };

const utilitySource = `
const config=${JSON.stringify(config)};
const path=require('node:path'),{createRequire}=require('node:module');
const requireApp=createRequire(path.join(config.root,'package.json'));
const sherpa=requireApp('sherpa-onnx-node');
const {SpeechController}=require(path.join(config.root,'dist-electron/shared/electron/backend/speech/controller.js'));
globalThis.fetch=()=>{throw Error('No network during recognition');};
require('node:net').Socket.prototype.connect=globalThis.fetch;
const sources=['microphone','system'];
const waves={microphone:sherpa.readWave(path.join(config.fixtures,'english.wav'),false),system:sherpa.readWave(path.join(config.fixtures,'chinese.wav'),false)};
for(const wave of Object.values(waves))if(wave.sampleRate!==16000||!wave.samples.length)throw Error('Require nonempty 16kHz public WAVs');
const stats={created:{microphone:0,system:0},started:{microphone:0,system:0},stopped:{microphone:0,system:0},packets:{microphone:0,system:0}};
const captures=new Map();let controller,offset=0,playback,playSequence=0;
const total=Math.max(...Object.values(waves).map(wave=>wave.samples.length))+32000;
const clock=()=>1000000+offset/16;
const snapshot=()=>({
 ...structuredClone(stats),pid:process.pid,worker:controller?.worker?.threadId,
 queued:controller?.pendingAudio.size??0,playback:playback?{id:playback.id,done:playback.offset>=total,startMs:playback.startMs}:null,
});
const timer=setInterval(()=>{
 for(const [source,audio] of captures){
  const samples=new Float32Array(1600),wave=waves[source];
  if(playback&&playback.offset<total)for(let i=0;i<samples.length;i++)samples[i]=wave.samples[playback.offset+i]||0;
  stats.packets[source]++;audio({samples,rate:16000,flags:0,timestamp:clock()});
 }
 offset+=1600;if(playback)playback.offset+=1600;
},100);
const adapter={
 drainBeforeRetire:true,
 preprocessorFile:path.join(config.root,'dist-electron/windows/electron/speech/echoCancellation.js'),
 devices:async()=>sources.map(source=>({id:source,name:'Verified public fixture',source,default:true})),
 create:(_helper,source,_device,audio)=>{
  stats.created[source]++;let started=false;
  return {
   async start(){if(started)throw Error('Capture restarted');started=true;stats.started[source]++;captures.set(source,audio);},
   async stop(){if(started){started=false;stats.stopped[source]++;captures.delete(source);}},
  };
 },
};
const port=process.parentPort;
port.on('message',async({data:message})=>{
 try{
  let value;
  if(message.init)controller=new SpeechController(message.model,'synthetic',event=>port.postMessage({event}),adapter);
  else if(message.test==='stats')value=snapshot();
  else if(message.test==='play'){
   const anchor=controller.anchors.get('microphone');
   playback={id:++playSequence,offset:0,startMs:anchor?anchor.wall+clock()-anchor.native:Date.now()};value=snapshot();
  }else if(message.close){clearInterval(timer);await controller.close();value=snapshot();}
  else value=await controller.call(message.call);
  port.postMessage({id:message.id,value});
 }catch(error){port.postMessage({id:message.id,error:error.message});}
});
process.on('SIGTERM',()=>{clearInterval(timer);void controller?.close().finally(()=>process.exit(0));});
`;

const mainSource = `
const config=${JSON.stringify(config)};
const {app}=require('electron'),assert=require('node:assert/strict'),path=require('node:path');
app.setPath('userData',config.profile);
const {SpeechHost}=require(path.join(config.root,'dist-electron/shared/electron/backend/speech/host.js'));
const {questionSource}=require(path.join(config.root,'dist-electron/shared/electron/contracts/speechSettings.js'));
const {InterviewContext}=require(path.join(config.root,'dist-electron/shared/electron/application/interviewContext.js'));
globalThis.fetch=()=>{throw Error('No network during recognition');};
require('node:net').Socket.prototype.connect=globalThis.fetch;
const remote={inputMode:'remote',microphoneMuted:false};
const transcription={inputMode:'transcription',microphoneMuted:false};
const events=[];let host;
const finals=(mark,source)=>events.slice(mark).filter(event=>event.type==='segment'&&event.segment.final&&event.segment.source===source&&event.segment.text.trim());
const textEvents=(mark,source)=>events.slice(mark).filter(event=>event.type==='segment'&&event.segment.source===source&&event.segment.text.trim());
const wait=async(predicate)=>{
 const end=Date.now()+30000;
 while(!await predicate()){
  if(events.some(event=>event.type==='status'&&event.status.state==='error'))throw Error('Native speech service failed');
  if(Date.now()>end)throw Error('Public speech input phase did not meet its nonempty-result prerequisite');
  await new Promise(resolve=>setTimeout(resolve,50));
 }
};
const unchanged=(before,after)=>{
 assert.deepEqual(after.created,before.created,'Soft input change created a new capture');
 assert.deepEqual(after.started,before.started,'Soft input change restarted capture');
 assert.deepEqual(after.stopped,before.stopped,'Soft input change stopped capture');
 assert.equal(after.pid,before.pid,'Utility service restarted');
 assert.equal(after.worker,before.worker,'ASR model worker restarted');
};
const change=async(state)=>{
 const before=await host.send({test:'stats'});
 const result=await host.call({op:'set-input-state',state});
 assert.equal(result.state,'running');assert.deepEqual(result.inputState,state);
 unchanged(before,await host.send({test:'stats'}));
};
const play=async(required,forbidden)=>{
 const mark=events.length,stats=await host.send({test:'play'}),playId=stats.playback.id;
 await wait(async()=>{
  const current=await host.send({test:'stats'});
  return current.playback?.id===playId&&current.playback.done&&current.queued===0&&required.every(source=>finals(mark,source).length);
 });
 if(forbidden)assert.equal(textEvents(mark,forbidden).length,0,'Disabled source emitted text');
 const after=await host.send({test:'stats'});
 assert.ok(after.packets.microphone>stats.packets.microphone,'Synthetic microphone capture stopped producing packets');
 assert.ok(after.packets.system>stats.packets.system,'Synthetic system capture stopped producing packets');
 return {mark,startMs:stats.playback.startMs};
};
app.whenReady().then(async()=>{
 try{
  host=new SpeechHost(config.model,'synthetic',event=>events.push(event),config.processFile);
  const status=await host.call({op:'start',options:{sources:['microphone','system']},inputState:remote});
  assert.equal(status.state,'running');assert.deepEqual(status.inputState,remote);
  const initial=await host.send({test:'stats'});
  assert.deepEqual(initial.started,{microphone:1,system:1});
  const baseline=await play(['microphone','system']);
  const oldMicIds=new Set(textEvents(baseline.mark,'microphone').map(event=>event.segment.id));
  await change({...remote,microphoneMuted:true});
  await play(['system'],'microphone');
  await change(remote);
  const resumed=await play(['microphone','system']);
  for(const event of textEvents(resumed.mark,'microphone')){
   assert.ok(!oldMicIds.has(event.segment.id),'Unmute reused a pre-mute transcript');
   assert.ok(event.segment.startMs>=resumed.startMs-300,'Unmute joined old audio across its cache boundary');
  }
  await change(transcription);
  const microphoneOnly=await play(['microphone'],'system');
  assert.equal(questionSource(transcription.inputMode),'microphone');
  const context=new InterviewContext();
  for(const event of events.slice(microphoneOnly.mark))context.event(event,questionSource(transcription.inputMode));
  const prepared=context.prepare('synthetic-question','本场问题');
  const timeline=JSON.parse(prepared.turns[0].content.split('\\n').slice(1).join('\\n')).timeline;
  assert.ok(timeline.some(row=>row.kind==='interviewer'),'Microphone finals did not enter question context');
  assert.ok(!timeline.some(row=>row.kind==='interviewee'),'Microphone questions became personal-answer facts');
  await change(remote);
  await play(['microphone','system']);
  const last=await host.send({test:'stats'});
  unchanged(initial,last);
  const metrics=events.filter(event=>event.type==='metrics');
  assert.ok(metrics.length,'Require real processed audio metrics');
  assert.ok(metrics.every(event=>event.maxQueueMs<=2000),'Paraformer exceeded the bounded queue');
  const closed=await host.send({close:true});
  assert.deepEqual(closed.stopped,{microphone:1,system:1});
  const pid=host.child.pid;await host.close();
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  console.log('PASS real Paraformer raw inputs: both nonempty prerequisites; soft mute/unmute; continuous system; runtime mode; new mic IDs; same captures/model; orderly release');
  app.exit(0);
 }catch(error){
  console.error(error.stack||error.message);
  await host?.send({close:true}).catch(()=>{});await host?.close().catch(()=>{});app.exit(1);
 }
});
`;
new Script(utilitySource, { filename: processFile });
new Script(mainSource, { filename: 'input-state-main.cjs' });
await writeFile(processFile, utilitySource);
const main = path.join(testRoot, 'main.cjs');
await writeFile(main, mainSource);
assert.equal(probe('desktop').interactive, true, 'Owner desktop locked before native launch');
const child = spawnTestProcess(workspace.platformRequire('electron'), [main], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: 'inherit',
  windowsHide: true,
});
let desktopFailure;
const guard = setInterval(() => {
  try {
    assert.equal(
      probe('desktop').interactive,
      true,
      'Owner desktop locked during native verification',
    );
  } catch (error) {
    desktopFailure = error;
    child.kill();
  }
}, 3000);
const deadline = setTimeout(() => child.kill(), 180000);
try {
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (desktopFailure) throw desktopFailure;
  assert.equal(code, 0, 'Real input-state pipeline failed');
} finally {
  clearInterval(guard);
  clearTimeout(deadline);
  if (child.exitCode === null && child.signalCode === null) child.kill();
}
