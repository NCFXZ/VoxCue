import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { readFile, writeFile, access, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.argv.includes('--packaged'))
  throw Error('Use the disposable guest package runner for the final ASAR audio closure.');
if (
  process.argv.slice(2).some((arg) => arg !== '--runtime-bundle') ||
  process.argv.length > 3
)
  throw Error('Use no option or --runtime-bundle');
const executable = workspace.platformRequire('electron');
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
    'shared/electron/backend/speech',
    'shared/electron/backend/cancellable.js',
    'shared/electron/contracts',
    'macos/electron/speech',
  ]) {
    const destination = path.join(input, 'dist-electron', file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(runtime, 'dist-electron', file), destination, { recursive: true });
  }
  for (const name of [
    '@ennuicastr/webrtcaec3.js',
    'sherpa-onnx-node',
    'sherpa-onnx-darwin-arm64',
  ]) {
    const source = path.dirname(workspace.platformRequire.resolve(name + '/package.json'));
    const destination = path.join(input, 'node_modules', name);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
  const { createPackageWithOptions } = await import(
    workspace.platformRequire.resolve('@electron/asar')
  );
  const archive = path.join(testRoot, 'app.asar');
  await createPackageWithOptions(input, archive, {
    unpackDir:
      '{node_modules,dist-electron}',
  });
  runtime = archive + '.unpacked';
}
if (process.argv.length > 2) {
  const pkg = path.join(runtime, 'node_modules/@ennuicastr/webrtcaec3.js');
  const manifest = JSON.parse(await readFile(path.join(pkg, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.3.0');
  assert.match(await readFile(path.join(pkg, 'license.js'), 'utf8'), /The WebRTC project authors/);
  await access(path.join(pkg, 'dist/webrtcaec3-0.3.0.wasm'));
}
// Exercise production controller, Worker transport, AEC and resampler together.
// Substitute only the capture device and inference so no model or hardware is needed.
async function runAudio() {
  const assert = require('node:assert/strict');
  const path = require('node:path');
  const threads = require('node:worker_threads');
  const runtime = process.argv[2];
  const deny = () => { throw Error('Audio smoke forbids network'); };
  globalThis.fetch = deny;
  for (const name of ['node:http', 'node:https']) {
    const transport = require(name);
    transport.request = transport.get = deny;
  }
  require('node:net').Socket.prototype.connect = deny;
  require('node:tls').connect = deny;
  function observeInference() {
    const { workerData } = require('node:worker_threads');
    globalThis.fetch = () => { throw Error('Audio smoke forbids network'); };
    require('node:net').Socket.prototype.connect = globalThis.fetch;
    require.cache[workerData.recognizer] = { exports: { Recognizer: class {
      static async load(_options, emit) { return new this(emit); }
      constructor(emit) { this.emit = emit; }
      healthy = true;
      metadata = {};
      inferenceMs = 0;
      progress = new Map();
      feed(source, samples, rate, timestamp) {
        this.progress.set(source, timestamp);
        this.emit({ type: 'test-audio', source, samples, rate, timestamp });
      }
      processedThrough(source) { return this.progress.get(source); }
      canSwitch() { return true; }
      async close() { this.healthy = false; }
      discontinuity() {}
      flush() {}
    } } };
    require(workerData.entry);
  }
  const Worker = threads.Worker;
  threads.Worker = class extends Worker {
    constructor(entry) {
      assert.equal(path.basename(entry), 'worker.js');
      super('(' + observeInference.toString() + ')()', { eval: true, workerData: {
        entry, recognizer: path.join(path.dirname(entry), 'recognizer.js'),
      } });
    }
  };
  const { SpeechController } = require(path.join(runtime, 'dist-electron/macos/electron/speech/controller.js'));
  const sources = ['system', 'microphone'];
  for (const rate of [48000, 44100]) {
    const events = [];
    const devices = sources.map(source => ({ source, id: source, name: source, default: true }));
    const capture = new Map();
    const controller = new SpeechController('synthetic', 'synthetic', event => events.push(event));
    controller.adapter.captureClockNow = () => 1000;
    controller.adapter.devices = async () => devices;
    controller.adapter.create = (_helper, source, _device, feed) => {
      capture.set(source, feed);
      return { start: async () => {}, stop: async () => {} };
    };
    try {
      const started = await controller.call({ op: 'start', options: { sources },
        inputState: { inputMode: 'remote', microphoneMuted: false } });
      assert.equal(started.state, 'running', started.error);
      const raw = Float32Array.from({ length: rate === 48000 ? 967 : 883 }, (_, i) => Math.sin(i / 9) * 0.1);
      capture.get('system')({ samples: new Float32Array(960), rate: 48000, timestamp: 1000, flags: 0 });
      capture.get('microphone')({ samples: raw.slice(), rate, timestamp: 1000, flags: 0 });
      await controller.call({ op: 'pause' });
      const microphone = events.filter(e => e.type === 'test-audio' && e.source === 'microphone');
      assert.ok(microphone.length && microphone.every(e => e.rate === 48000));
      const output = Float32Array.from(microphone.flatMap(e => Array.from(e.samples)));
      if (rate === 48000) assert.deepEqual(output, raw);
      else {
        assert.ok(Math.abs(output.length - Math.ceil(raw.length * 48000 / rate)) <= 1);
        assert.ok(output.every(Number.isFinite));
      }
    } finally { await controller.close(); }
  }
  console.log('PASS: Mac capture controller loaded local AEC, preserved the short tail and resampled 44.1 kHz before recognition.');
}
const entry = path.join(testRoot, 'echo-runtime.cjs');
await writeFile(entry, '(' + runAudio.toString() + ')().catch(e => { console.error(e); process.exitCode = 1; });');
const child = spawnTestProcess(executable, [entry, runtime], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: path.join(runtime, 'node_modules') },
});
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
assert.equal(code, 0, 'Real Electron audio worker must exit successfully');
