import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { readFile, writeFile, access, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { prepareModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';

if (
  process.argv.slice(2).some((arg) => !['--packaged', '--runtime-bundle'].includes(arg)) ||
  process.argv.length > 3
)
  throw Error('Use no option, --runtime-bundle or --packaged');
let executable = workspace.platformRequire('electron');
let runtime = workspace.platformRoot;
if (process.argv.includes('--runtime-bundle')) {
  // Focused ASAR layout, without copying unrelated document/RAG/UI dependencies.
  // The audio code, JS/WASM, native resampler and unpack rules are production ones.
  const input = path.join(testRoot, 'audio-runtime');
  await mkdir(input);
  await writeFile(
    path.join(input, 'package.json'),
    '{"name":"voxcue-audio-layout","version":"0.0.0"}',
  );
  for (const file of [
    'shared/electron/backend/speech/worker.js',
    'shared/electron/backend/speech/engine.js',
    'shared/electron/backend/speech/qwen.js',
    'shared/electron/backend/speech/buffer.js',
    'shared/electron/backend/speech/models.js',
    'windows/electron/speech/echoCancellation.js',
  ]) {
    const destination = path.join(input, 'dist-electron', file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(runtime, 'dist-electron', file), destination);
  }
  for (const name of ['@ennuicastr/webrtcaec3.js', 'sherpa-onnx-node', 'sherpa-onnx-win-x64']) {
    const source = path.dirname(workspace.platformRequire.resolve(name + '/package.json'));
    const destination = path.join(input, 'node_modules', name);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
  const { createPackageWithOptions } = await import(
    pathToFileURL(workspace.platformRequire.resolve('@electron/asar')).href
  );
  const archive = path.join(testRoot, 'app.asar');
  await createPackageWithOptions(input, archive, {
    unpackDir:
      '{node_modules,dist-electron/shared/electron/backend/speech,dist-electron/windows/electron/speech}',
  });
  runtime = archive + '.unpacked';
}
if (process.argv.includes('--packaged')) {
  // Production portable layout in the owned temporary root. No installer or release.
  const output = path.join(testRoot, 'platform-layout-aec');
  const child = spawnTestProcess(
    process.execPath,
    ['scripts/package-portable.mjs', '--test-output=' + output],
    { stdio: 'inherit' },
  );
  assert.equal(
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    }),
    0,
  );
  const app = path.join(output, 'VoxCue-win32-x64');
  executable = path.join(app, 'VoxCue.exe');
  runtime = path.join(app, 'resources/app.asar.unpacked');
  if (!process.env.VOXCUE_TEST_SPEECH_MODELS)
    process.env.VOXCUE_TEST_SPEECH_MODELS = (await prepareModelFixtures()).speechModels;
}
if (process.argv.length > 2) {
  const pkg = path.join(runtime, 'node_modules/@ennuicastr/webrtcaec3.js');
  const manifest = JSON.parse(await readFile(path.join(pkg, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.3.0');
  assert.match(await readFile(path.join(pkg, 'license.js'), 'utf8'), /The WebRTC project authors/);
  await access(path.join(pkg, 'dist/webrtcaec3-0.3.0.wasm'));
  for (const file of ['sherpa-onnx.node', 'onnxruntime.dll', 'sherpa-onnx-c-api.dll'])
    await access(path.join(runtime, 'node_modules/sherpa-onnx-win-x64', file));
}
const entry = path.join(testRoot, 'echo-runtime.cjs');
await writeFile(
  entry,
  `
const assert = require('node:assert/strict');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const runtime = process.argv[2];
const deny = () => {throw Error('Audio smoke forbids network');};
globalThis.fetch = deny;
for (const name of ['node:http','node:https']) {
  const transport = require(name);
  transport.request = transport.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
require('node:module').syncBuiltinESMExports();
(async () => {
  const worker = new Worker(\
    'const {parentPort,workerData}=require("node:worker_threads");' +
    'globalThis.fetch=()=>{throw Error("No network");};' +
    'require("node:net").Socket.prototype.connect=globalThis.fetch;' +
    'require.cache[workerData.engine]={exports:{SpeechEngine:class {' +
    'audioMs=0;inferenceMs=0;constructor(_d,emit){this.emit=emit;}' +
    'feed(source,samples,rate,timestamp){this.emit({source,samples,rate,timestamp});}' +
    'discontinuity(){}flush(){}}}};' +
    'require(workerData.entry);',
    {eval:true,workerData:{
      engine:path.join(runtime,'dist-electron/shared/electron/backend/speech/engine.js'),
      entry:path.join(runtime,'dist-electron/shared/electron/backend/speech/worker.js')
    }});
  const events = [];
  let listener;
  const timeout = setTimeout(()=>{console.error('Audio worker timeout');process.exit(1);},10000);
  worker.on('message', m => {if(m.event)events.push(m.event);if(m.error)throw Error(m.error);listener?.(m);});
  worker.on('error', error=>{throw error;});
  const send = (m, key, value=true) => new Promise(resolve=>{listener=reply=>{if(reply[key]===value){listener=undefined;resolve();}};worker.postMessage(m);});
  try {
    await send({op:'init',directory:'synthetic-not-read',preprocessorFile:path.join(runtime,'dist-electron/windows/electron/speech/echoCancellation.js')},'ready');
    await send({op:'prepare',sources:['system','microphone'],id:1},'prepared',1);
    await send({op:'audio',source:'system',samples:new Float32Array(960),rate:48000,timestamp:1000,captureClock:0,sequence:2,ms:20},'ack',2);
    const samples=Float32Array.from({length:967},(_,i)=>Math.sin(i/9)*0.1);
    await send({op:'audio',source:'microphone',samples,rate:48000,timestamp:1000,captureClock:0,sequence:3,ms:20},'ack',3);
    await send({op:'flush',id:4,reason:'stop'},'flushed',4);
    const output=Float32Array.from(events.filter(e=>e.source==='microphone').flatMap(e=>Array.from(e.samples)));
    assert.deepEqual(output,samples);
    const before=events.length;
    await send({op:'prepare',sources:['system','microphone'],id:5},'prepared',5);
    await send({op:'audio',source:'system',samples:new Float32Array(960),rate:48000,timestamp:2000,captureClock:1000,sequence:6,ms:20},'ack',6);
    await send({op:'audio',source:'microphone',samples:new Float32Array(883).fill(0.1),rate:44100,timestamp:2000,captureClock:1000,sequence:7,ms:20},'ack',7);
    await send({op:'flush',id:8,reason:'stop'},'flushed',8);
    const resampled=events.slice(before).filter(e=>e.source==='microphone').flatMap(e=>Array.from(e.samples));
    assert.ok(Math.abs(resampled.length-Math.ceil(883*48000/44100))<=1);
    assert.ok(resampled.every(Number.isFinite));
    console.log(JSON.stringify({status:'passed',realElectronWorker:true,localWasm:true,tailSamples:output.length,resamplerOutputSamples:resampled.length,network:false,hardwareCapture:false}));
  } finally {clearTimeout(timeout);await worker.terminate();}
  if (process.env.VOXCUE_TEST_SPEECH_MODELS) {
    const real = new Worker('globalThis.fetch=()=>{throw Error("No network");};require("node:net").Socket.prototype.connect=globalThis.fetch;require(require("node:worker_threads").workerData.entry);', {
      eval:true, workerData:{entry:path.join(runtime,'dist-electron/shared/electron/backend/speech/worker.js')}
    });
    try {
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('Real AEC/ONNX worker timeout')),30000);
        real.once('error',reject);
        real.on('message',m=>{
          if(m.error){clearTimeout(timeout);reject(Error(m.error));}
          if(m.ready) real.postMessage({op:'prepare',sources:['system','microphone'],id:10});
          if(m.prepared===10) real.postMessage({op:'audio',source:'system',samples:new Float32Array(4800),rate:48000,timestamp:1000,captureClock:10,sequence:11,ms:100});
          if(m.ack===11) real.postMessage({op:'audio',source:'microphone',samples:new Float32Array(4410),rate:44100,timestamp:1000,captureClock:10,sequence:12,ms:100});
          // Missing QPC must retain the 48k ASR input rate after resampling.
          if(m.ack===12) real.postMessage({op:'audio',source:'microphone',samples:new Float32Array(4410),rate:44100,timestamp:1100,sequence:13,ms:100});
          if(m.ack===13) {assert.ok(m.audioMs>=200);real.postMessage({op:'flush',id:14,reason:'stop'});}
          if(m.flushed===14){clearTimeout(timeout);resolve();}
        });
        real.postMessage({op:'init',directory:process.env.VOXCUE_TEST_SPEECH_MODELS,preprocessorFile:path.join(runtime,'dist-electron/windows/electron/speech/echoCancellation.js')});
      });
      console.log('PASS actual AEC WASM + Paraformer/VAD/ONNX in Electron Worker, 44.1kHz and invalid QPC, flush and exit');
    } finally {await real.terminate();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
`,
);
const child = spawnTestProcess(executable, [entry, runtime], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: path.join(runtime, 'node_modules') },
});
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
assert.equal(code, 0, 'Real Electron audio worker must exit successfully');
