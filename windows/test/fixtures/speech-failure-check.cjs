const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const threads = require('node:worker_threads');
const RealWorker = threads.Worker;
let mode = 'normal',
  failStart = false,
  failStop = false,
  missing = false,
  ports = [];
threads.Worker = class extends RealWorker {
  constructor(...args) {
    super(...args);
    if (mode === 'exit-loading') setImmediate(() => this.terminate());
  }
  postMessage(message, ...args) {
    if (message.op === 'flush' && mode === 'exit-tail') {
      void this.terminate();
      return;
    }
    if (message.op === 'flush' && mode === 'hang-tail') return;
    return super.postMessage(message, ...args);
  }
};
const root = process.cwd(),
  model = process.env.VOXCUE_TEST_SPEECH_MODELS ?? path.resolve('../shared/local-models/speech');
const capture = require(path.join(root, 'dist-electron/windows/electron/speech/capture.js'));
capture.devices = async () =>
  missing ? [] : [{ id: 'synthetic', name: 'Synthetic device', source: 'system', default: true }];
capture.WasapiCapture = class {
  constructor(_helper, _source, _device, audio, failure) {
    this.audio = audio;
    this.failure = failure;
    ports.push(this);
  }
  async start() {
    if (failStart) {
      failStart = false;
      throw Error('synthetic-start-failure');
    }
    if (mode === 'failure-during-start') this.failure('synthetic-synchronous-native-failure');
  }
  async stop() {
    if (failStop) {
      failStop = false;
      throw Error('synthetic-stop-failure');
    }
  }
};
const { SpeechController } = require(
  path.join(root, 'dist-electron/windows/electron/speech/controller.js'),
);
const events = [];
let controller;
const create = (directory = model) =>
  new SpeechController(directory, 'synthetic-unused-helper', (event) => events.push(event));
const start = () => controller.call({ op: 'start', options: { sources: ['system'] } });
async function until(condition, label) {
  const end = performance.now() + 5000;
  while (!condition()) {
    if (performance.now() > end) throw Error(label);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
async function fresh() {
  mode = 'normal';
  failStart = failStop = false;
  missing = false;
  await controller?.close().catch(() => {});
  controller = create();
  events.length = 0;
}
(async () => {
  try {
    const corrupt = path.join(process.env.VOXCUE_FAILURE_ROOT, 'corrupt-model');
    fs.mkdirSync(corrupt);
    fs.writeFileSync(
      path.join(corrupt, 'manifest.json'),
      JSON.stringify({ files: { 'encoder.int8.onnx': { sha256: 'invalid' } } }),
    );
    fs.writeFileSync(path.join(corrupt, 'encoder.int8.onnx'), 'invalid');
    controller = create(corrupt);
    assert.equal((await start()).state, 'error');
    await fresh();
    mode = 'exit-loading';
    const time = performance.now();
    assert.equal((await start()).state, 'error');
    assert.ok(performance.now() - time < 5000, 'Initialization exit waited for the long deadline');
    mode = 'normal';
    assert.equal((await start()).state, 'running');
    await fresh();
    failStart = failStop = true;
    assert.equal((await start()).error, 'synthetic-start-failure');
    assert.equal(controller.captures.size, 0);
    assert.equal((await start()).state, 'running');
    await fresh();
    mode = 'failure-during-start';
    assert.equal((await start()).state, 'error');
    assert.equal(events.filter((event) => event.type === 'status').at(-1).status.state, 'error');
    assert.ok(!events.some((event) => event.type === 'status' && event.status.state === 'running'));
    mode = 'normal';
    assert.equal((await start()).state, 'running');
    await fresh();
    missing = true;
    await assert.rejects(start(), /未发现/);
    missing = false;
    assert.equal((await start()).state, 'running');
    ports.at(-1).failure('synthetic-device-disconnected');
    await until(() => controller.captures.size === 0, 'Disconnected capture leaked');
    assert.equal((await start()).state, 'running');
    failStop = true;
    await assert.rejects(controller.call({ op: 'stop' }), /音频采集未能正常停止/);
    assert.equal(controller.captures.size, 0);
    assert.equal(controller.status.state, 'error');
    assert.equal((await start()).state, 'running');
    const stale = ports.at(-1);
    stale.audio({ samples: new Float32Array(64000), rate: 16000, flags: 0, timestamp: 1 });
    await until(() => controller.captures.size === 0, 'Backlog did not retire capture');
    assert.equal((await start()).state, 'running');
    stale.audio({ samples: new Float32Array(512), rate: 16000, flags: 0, timestamp: -999999 });
    assert.equal(controller.queued, 0);
    assert.equal(controller.anchors.size, 0);
    await controller.worker.terminate();
    await until(() => controller.captures.size === 0, 'Worker exit left a capture');
    assert.equal((await start()).state, 'running');
    for (const fault of ['exit-tail', 'hang-tail']) {
      mode = fault;
      const before = performance.now();
      await assert.rejects(controller.call({ op: 'stop' }), /尾段|超时/);
      assert.equal(controller.flushers.size, 0);
      assert.equal(controller.worker, undefined);
      if (fault === 'hang-tail') assert.ok(performance.now() - before >= 4500);
      mode = 'normal';
      assert.equal((await start()).state, 'running');
    }
    console.log(
      JSON.stringify({
        status: 'passed',
        realWindowsController: true,
        realAsrWorker: true,
        corruptModel: true,
        workerInitializationExit: true,
        startAndCleanupFailure: true,
        startRace: true,
        deviceFailure: true,
        stopFailure: true,
        backlog: true,
        lateCallbacks: true,
        workerRecovery: true,
        tailExitAndTimeout: true,
        physicalCapture: false,
      }),
    );
  } finally {
    mode = 'normal';
    await controller?.close();
    threads.Worker = RealWorker;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
