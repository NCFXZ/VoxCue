import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const component = process.argv[2];
if (!component || !path.isAbsolute(component))
  throw Error('Pass an isolated verified Qwen component');
async function run(file, args) {
  const child = spawnTestProcess(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  assert.equal(
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    }),
    0,
    output,
  );
  return output;
}
const wave = path.join(testRoot, 'voice.wav');
await run('/usr/bin/say', [
  '-r',
  '165',
  '-o',
  path.join(testRoot, 'voice.aiff'),
  'The team improved the project.',
]);
await run('/usr/bin/afconvert', [
  '-f',
  'WAVE',
  '-d',
  'LEI16@44100',
  '-c',
  '1',
  path.join(testRoot, 'voice.aiff'),
  wave,
]);
const root = workspace.platformRoot;
const processFile = path.join(testRoot, 'process.cjs');
await writeFile(
  processFile,
  `
const root=${JSON.stringify(root)};
const sherpa=require(root+'/node_modules/sherpa-onnx-node');
const wave=sherpa.readWave(${JSON.stringify(wave)},false);
const capture=require(root+'/dist-electron/macos/electron/speech/capture.js');
const clock=require(root+'/native/bin/VoxCue.AudioClock.node');
capture.devices=async()=>['system','microphone'].map(source=>({id:source,name:'Synthetic '+source,source,default:true}));
capture.CoreAudioCapture=class {
 constructor(_helper,source,_device,audio){this.source=source;this.audio=audio;this.offset=0;}
 async start(){const origin=clock();this.timer=setInterval(()=>{
  const samples=new Float32Array(441);const start=this.offset;this.offset+=samples.length;
  if(this.source==='system')for(let i=0;i<samples.length;i++)samples[i]=wave.samples[start+i]||0;
  this.audio({samples,rate:44100,timestamp:origin+start/44.1,flags:0});
 },10);}
 async stop(){clearInterval(this.timer);}
};
require(root+'/dist-electron/macos/electron/speech/process.js');
`,
);
await mkdir(path.join(testRoot, 'profile'));
const entry = path.join(testRoot, 'main.cjs');
await writeFile(path.join(testRoot, 'package.json'), JSON.stringify({ main: 'main.cjs' }));
await writeFile(
  entry,
  `
const {app}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(testRoot, 'profile'))});
const assert=require('node:assert/strict');
const {SpeechHost}=require(${JSON.stringify(path.join(root, 'dist-electron/shared/electron/backend/speech/host.js'))});
const deny=()=>{throw Error('Worker smoke forbids network');};globalThis.fetch=deny;
require('node:net').Socket.prototype.connect=deny;
app.whenReady().then(async()=>{
 const events=[];
 const host=new SpeechHost('unused',${JSON.stringify(path.join(root, 'native/bin/synthetic-capture'))},event=>events.push(event),${JSON.stringify(processFile)},${JSON.stringify(component)},${JSON.stringify(path.join(root, 'native/bin/qwen/voxcue-qwen'))});
 try{
  const status=await host.call({op:'start',options:{sources:['system','microphone'],speechModel:'qwen',inferenceDevice:'metal'},inputState:{inputMode:'remote',microphoneMuted:false}});
  assert.equal(status.state,'running');assert.equal(status.chunkMs,500);assert.match(status.model,/对齐 CPU/);
  const pid=host.child.pid;
  const deadline=Date.now()+120000;
  while(!events.some(e=>e.type==='segment'&&e.segment.final&&e.segment.reason==='silence')&&Date.now()<deadline){
   const error=events.find(e=>e.type==='status'&&e.status.state==='error');if(error)throw Error(JSON.stringify(error));
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(events.some(e=>e.type==='speech-start'&&e.source==='system'));
  assert.ok(events.some(e=>e.type==='segment'&&e.segment.source==='system'&&e.segment.final&&e.segment.reason==='silence'));
  const final=events.find(e=>e.type==='segment' && e.segment.final && e.segment.reason==='silence').segment;
  assert.ok(final.endMs-final.silenceStartMs>=500 && final.endMs-final.silenceStartMs<532);
  assert.ok(!events.some(e=>e.type==='segment'&&e.segment.source==='microphone'&&e.segment.text));
  await host.call({op:'stop'});await host.close();
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  console.log('PASS: production Mac utilityProcess/controller/Worker/AEC/resampler/Qwen Metal, 44.1kHz synthetic capture, 500ms silence final and real process close.');
  app.exit(0);
 }catch(error){console.error(error);await host.close().catch(()=>{});app.exit(1);}
});
`,
);
console.log(await run(workspace.platformRequire('electron'), [testRoot, '--use-mock-keychain']));
