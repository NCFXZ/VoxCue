import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { mkdir, writeFile, readFile, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { prepareSpeechFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';

const input = process.argv.slice(2);
const fixtureOption = input.find((value) => value.startsWith('--fixture='));
if (input.length !== 1 || (!fixtureOption && input[0] !== '--download'))
  throw Error('Use --download or --fixture=<owned live comparison fixture>');
const root = workspace.platformRoot;
const { ComponentService, componentPaths } = workspace.platformRequire(
  path.join(root, 'dist-electron/shared/electron/backend/components/service.js'),
);
const { packagesFor } = workspace.platformRequire(
  path.join(root, 'dist-electron/shared/electron/backend/components/catalog.js'),
);
const packages = packagesFor('darwin', 'arm64');
const releaseDesktop = holdDesktopAwake();
const desktopGuard = setInterval(() => {
  try { requireUnlockedDesktop(); }
  catch (error) {
    console.error(error.message);
    process.kill(process.pid, 'SIGTERM');
  }
}, 2000);
desktopGuard.unref();
let models = path.join(testRoot, 'models');
if (fixtureOption) {
  const fixture = JSON.parse(await readFile(fixtureOption.slice('--fixture='.length), 'utf8'));
  const owned = await realpath(fixture.root);
  const owner = JSON.parse(await readFile(path.join(owned, '.voxcue-test-owner.json'), 'utf8'));
  assert.ok(owned.startsWith(path.dirname(testRoot) + path.sep + 'voxcue-test-run-'));
  assert.equal(owner.kind, 'voxcue-test-run-');
  assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
  process.kill(owner.pid, 0);
  models = await realpath(fixture.models);
  assert.ok(models.startsWith(owned + path.sep));
}
let last = '';
const service = new ComponentService({
  root: models,
  packages,
  managed: true,
  fetch,
  emit(state) {
    const item = state.items.find((item) => ['downloading', 'verifying'].includes(item.phase));
    const progress = item
      ? `${item.id}: ${item.phase} ${Math.floor(item.received / 500000000) * 500} MB`
      : state.phase;
    if (progress !== last) {
      console.log(progress);
      last = progress;
    }
  },
});
async function run(file, args) {
  const child = spawnTestProcess(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
    process.stdout.write(data);
  });
  child.stderr.on('data', (data) => {
    output = (output + data).slice(-16000);
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, output);
}
try {
  for (const id of ['speech', 'qwen']) {
    await service.download(id);
    assert.equal(service.ready(id), true, service.state().error);
  }
  const paths = componentPaths(models, packages);
  console.log('Verified fixed public Paraformer and original Qwen/Aligner models.');
  const audio = await prepareSpeechFixtures();
  await run('/usr/bin/afconvert', [
    '-f',
    'WAVE',
    '-d',
    'LEI16@44100',
    '-c',
    '1',
    path.join(audio, 'english.wav'),
    path.join(testRoot, 'voice.wav'),
  ]);
  const processFile = path.join(testRoot, 'process.cjs');
  await writeFile(
    processFile,
    `
const root=${JSON.stringify(root)};
const wave=require(root+'/node_modules/sherpa-onnx-node').readWave(${JSON.stringify(path.join(testRoot, 'voice.wav'))},false);
const stats={created:0,started:0,stopped:0,packets:0};let voice=false;
const port=process.parentPort,on=port.on.bind(port);
port.on=(name,listener)=>on(name,value=>{
 const m=value.data;
 if(name==='message'&&m.test){
  if(m.test==='voice')voice=m.enabled;
  port.postMessage({id:m.id,value:stats});return;
 }
 listener(value);
});
const capture=require(root+'/dist-electron/macos/electron/speech/capture.js');
capture.devices=async()=>['system','microphone'].map(source=>({id:source,name:'Synthetic '+source,source,default:true}));
capture.CoreAudioCapture=class{
 constructor(_h,source,_d,audio){this.source=source;this.audio=audio;this.offset=0;stats.created++;}
 async start(){stats.started++;this.timer=setInterval(()=>{
  const samples=new Float32Array(4410),offset=this.offset;this.offset+=4410;
  if(voice&&this.source==='system')for(let i=0;i<samples.length;i++)samples[i]=wave.samples[(offset+i)%(wave.samples.length+88200)]||0;
  stats.packets++;this.audio({samples,rate:44100,timestamp:1000+offset/44.1,flags:0});
 },100);}
 async stop(){if(this.timer){clearInterval(this.timer);this.timer=undefined;stats.stopped++;}}
};
require(root+'/dist-electron/macos/electron/speech/process.js');
`,
  );
  await mkdir(path.join(testRoot, 'profile'));
  await writeFile(path.join(testRoot, 'package.json'), JSON.stringify({ main: 'main.cjs' }));
  await writeFile(
    path.join(testRoot, 'main.cjs'),
    `
const {app}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
app.setPath('userData',${JSON.stringify(path.join(testRoot, 'profile'))});
const {SpeechHost}=require(${JSON.stringify(path.join(root, 'dist-electron/shared/electron/backend/speech/host.js'))});
globalThis.fetch=()=>{throw Error('Recognition smoke forbids network');};require('node:net').Socket.prototype.connect=globalThis.fetch;
app.whenReady().then(async()=>{
 const events=[];
 const host=new SpeechHost(${JSON.stringify(paths.speechModels)},'synthetic',event=>events.push(event),${JSON.stringify(processFile)},${JSON.stringify(paths.qwenModels)},${JSON.stringify(path.join(root, 'native/bin/qwen/voxcue-qwen'))});
 const options={sources:['system','microphone'],speechModel:'paraformer',inferenceDevice:'cpu'};
 const wait=async(predicate)=>{const until=Date.now()+120000;while(!predicate()){
  const error=events.find(e=>e.type==='status'&&e.status.state==='error');if(error)throw Error(JSON.stringify(error));
  if(Date.now()>until)throw Error('Synthetic streaming deadline exceeded');await new Promise(r=>setTimeout(r,50));
 }};
 try{
  assert.equal((await host.call({op:'start',options})).state,'running');
  await host.send({test:'voice',enabled:true});
  for(const [model,device] of [['qwen','metal'],['paraformer','cpu'],['qwen','cpu'],['qwen','metal'],['paraformer','cpu'],['qwen','metal']]){
   const onset=events.length;
   await wait(()=>events.slice(onset).some(e=>e.type==='speech-start'));
   const before=await host.send({test:'stats'}),mark=events.length;
   const next={...options,speechModel:model,inferenceDevice:device};
   const at=Date.now(),status=await host.call({op:'switch-recognizer',options:next});
   const after=await host.send({test:'stats'});
   assert.equal(status.state,'running');assert.equal(status.inferenceDevice,device);
   assert.equal(after.created,2);assert.equal(after.started,2);assert.equal(after.stopped,0);
   assert.ok(after.packets>before.packets);
   assert.ok(events.slice(mark).some(e=>e.type==='segment'&&e.segment.final),'Old recognizer must finalize the speech preceding handoff');
   const newMark=events.length;
   await wait(()=>events.slice(newMark).some(e=>e.type==='segment'&&e.segment.final&&(e.segment.speechModel||'paraformer')===model));
   console.log('PASS: continuous capture/AEC, old final and new streaming final; '+model+' '+device+'; switch '+(Date.now()-at)+'ms');
  }
  await host.send({test:'voice',enabled:false});
  const config=${JSON.stringify(path.join(paths.qwenModels, 'asr/config.json'))},hidden=config+'.synthetic-hidden';
  await fs.rename(config,hidden);
  try{await assert.rejects(host.call({op:'switch-recognizer',options:{...options,speechModel:'qwen',inferenceDevice:'cpu'}}));}
  finally{await fs.rename(hidden,config);}
  assert.equal((await host.call({op:'status'})).state,'running');
  assert.equal((await host.send({test:'stats'})).stopped,0);
  console.log('PASS: failed candidate retains old Metal recognizer and capture.');
  const changing=host.call({op:'switch-recognizer',options:{...options,speechModel:'qwen',inferenceDevice:'cpu'}});
  const cancelled=assert.rejects(changing),at=Date.now();
  const paused=host.call({op:'pause'});
  await cancelled;assert.ok(Date.now()-at<3000,'Cancel cannot wait for loading');
  assert.equal((await paused).state,'paused');
  const finals=events.filter(e=>e.type==='segment'&&e.segment.final);
  assert.equal(new Set(finals.map(e=>e.segment.id)).size,finals.length,'Finals cannot duplicate at handoff');
  assert.equal((await host.send({test:'stats'})).stopped,2);
  const pid=host.child.pid;await host.close();assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  console.log('PASS: cancel during load, no duplicate final, captures and utilityProcess released.');app.exit(0);
 }catch(error){console.error(error);await host.close().catch(()=>{});app.exit(1);}
});
`,
  );
  await run(workspace.platformRequire('electron'), [testRoot, '--use-mock-keychain']);
  const releasedFiles = [
    path.join(paths.qwenModels, 'asr/model.safetensors'),
    path.join(paths.qwenModels, 'aligner/model.gguf'),
    path.join(paths.speechModels, 'encoder.int8.onnx'),
    path.join(paths.speechModels, 'decoder.int8.onnx'),
    path.join(root, 'native/bin/qwen/voxcue-qwen'),
    path.join(root, 'native/bin/qwen/python/bin/python3.12'),
  ];
  for (const file of releasedFiles) await access(file);
  const handles = spawnSync('/usr/sbin/lsof', ['-t', '--', ...releasedFiles], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(handles.error, undefined);
  assert.equal(handles.status, 1);
  assert.equal(handles.stdout.trim(), '');
  assert.equal(handles.stderr.trim(), '');
  console.log('PASS: original model files have no remaining process handles.');
} finally {
  service.dispose();
  clearInterval(desktopGuard);
  releaseDesktop();
}
