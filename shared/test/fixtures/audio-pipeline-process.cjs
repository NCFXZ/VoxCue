// A synthetic capture adapter drives the real controller/ASR in an Electron utilityProcess.
const { createRequire } = require('node:module');
const path = require('node:path');
const config = require(process.env.VOXCUE_PIPELINE_CONFIG);
const requireApp = createRequire(path.join(config.root, 'package.json'));
const sherpa = requireApp('sherpa-onnx-node');
let { SpeechController } = require(
  path.join(config.root, 'dist-electron/shared/electron/backend/speech/controller.js'),
);
const waves = Object.fromEntries(
  ['system', 'microphone'].map((source, index) => [
    source,
    sherpa.readWave(
      path.join(
        config.fixtures ?? path.join(config.root, '../shared/test/fixtures/speech-audio'),
        index ? 'english.wav' : 'chinese.wav',
      ),
      false,
    ),
  ]),
);
const captureClockNow = () => Number(process.hrtime.bigint()) / 1e6;
const adapter = {
  captureClockNow,
  drainBeforeRetire: process.platform === 'darwin',
  devices: async () =>
    ['system', 'microphone'].map((source) => ({
      id: source,
      name: 'Public fixture',
      source,
      default: true,
    })),
  create: (_helper, source, _device, audio) => {
    let interval,
      offset = 0;
    const wave = waves[source];
    return {
      start: async () => {
        interval = setInterval(() => {
          const samples = new Float32Array(512);
          const period = wave.samples.length + 16000;
          for (let i = 0; i < 512; i++) {
            const pos = (offset + i) % period;
            if (pos < wave.samples.length) samples[i] = wave.samples[pos];
          }
          offset += 512;
          audio({ samples, rate: 16000, flags: 0, timestamp: captureClockNow() });
        }, 32);
      },
      stop: async () => {
        clearInterval(interval);
        audio({
          samples: new Float32Array(160),
          rate: 16000,
          flags: 0,
          timestamp: captureClockNow(),
        });
      },
    };
  },
};
if (process.platform === 'win32') {
  const capture = require(
    path.join(config.root, 'dist-electron/windows/electron/speech/capture.js'),
  );
  capture.devices = adapter.devices;
  capture.WasapiCapture = class {
    constructor(...args) {
      Object.assign(this, adapter.create(...args));
    }
  };
  ({ SpeechController } = require(
    path.join(config.root, 'dist-electron/windows/electron/speech/controller.js'),
  ));
}
const port = process.parentPort;
let controller;
port.on('message', async ({ data: message }) => {
  try {
    if (message.init)
      controller = new SpeechController(
        message.model,
        'synthetic',
        (event) => port.postMessage({ event }),
        adapter,
      );
    const value = message.init ? undefined : await controller.call(message.call);
    port.postMessage({ id: message.id, value });
  } catch (error) {
    port.postMessage({ id: message.id, error: error.message });
  }
});
process.on('SIGTERM', () => {
  void controller?.close().finally(() => process.exit(0));
});
