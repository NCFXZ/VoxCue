// Test-only capture adapter. Recognition, VAD, ACKs and speech events are production code.
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const config = JSON.parse(fs.readFileSync(process.env.VOXCUE_REAL_AUDIO_CONFIG, 'utf8'));
const load = createRequire(path.join(config.root, 'package.json'));
const sherpa = load('sherpa-onnx-node');
const { SpeechController } = load(
  path.join(config.root, 'dist-electron/shared/electron/backend/speech/controller.js'),
);
const port = process.parentPort;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const captures = new Map();
let controller,
  playing = false,
  samplesSent = 0,
  lastProgress;
const failures = [];
const adapter = {
  drainBeforeRetire: true,
  preprocessorFile: path.join(
    config.root,
    'dist-electron/windows/electron/speech/echoCancellation.js',
  ),
  qwenRuntime: config.qwenRuntime,
  devices: async () => [
    { id: 'fixture-system', name: 'Owned WAV PCM input', source: 'system', default: true },
  ],
  create: (_helper, source, _device, audio) => {
    const capture = { active: false, audio };
    captures.set(source, capture);
    return {
      start: async () => {
        capture.active = true;
        capture.timer = setInterval(() => {
          if (
            !capture.active ||
            playing ||
            controller.status.state !== 'running' ||
            controller.queued >= 256
          )
            return;
          capture.audio({
            samples: new Float32Array(512),
            rate: 16000,
            flags: 0,
            timestamp: samplesSent / 16,
          });
          samplesSent += 512;
        }, 32);
      },
      stop: async () => {
        capture.active = false;
        clearInterval(capture.timer);
      },
    };
  },
};
function healthy(capture) {
  if (!capture?.active || failures.length) throw Error(failures[0] || 'WAV capture is not running');
}
async function play(id) {
  if (playing) throw Error('Only one WAV may be replayed at a time');
  const item = config.audio.find((item) => item.id === id);
  if (!item) throw Error('Unknown WAV fixture');
  const capture = captures.get('system');
  healthy(capture);
  playing = true;
  try {
    const bytes = fs.readFileSync(item.wave);
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256)
      throw Error('WAV checksum mismatch');
    const wave = sherpa.readWave(item.wave, false);
    if (wave.sampleRate !== 16000 || !wave.samples.length || wave.samples.length > 60 * 16000)
      throw Error('Expected nonempty mono 16 kHz WAV no longer than 60 seconds');
    const total = Math.ceil((5120 + wave.samples.length + 51200) / 512) * 512;
    const started = performance.now();
    for (let offset = 0; offset < total; offset += 512) {
      healthy(capture);
      while (controller.queued >= 256) {
        healthy(capture);
        if (performance.now() - started > 240000)
          throw Error('ASR replay exceeded its bounded deadline');
        await wait(10);
      }
      const ahead = offset / 16 - (performance.now() - started);
      if (ahead > 0) await wait(ahead);
      const block = new Float32Array(512);
      for (let i = 0; i < block.length; i++) {
        const at = offset + i - 5120;
        if (at >= 0 && at < wave.samples.length) block[i] = wave.samples[at];
      }
      capture.audio({ samples: block, rate: 16000, flags: 0, timestamp: samplesSent / 16 });
      samplesSent += block.length;
    }
    while (controller.pendingAudio.size) {
      healthy(capture);
      if (performance.now() - started > 240000)
        throw Error('ASR ACK drain exceeded its bounded deadline');
      await wait(10);
    }
    healthy(capture);
    return {
      samples: total,
      maxQueueMs: controller.maxQueue,
      droppedSamples: controller.droppedSamples,
      discontinuities: controller.discontinuities,
      progress: lastProgress,
    };
  } finally {
    playing = false;
  }
}
port.on('message', async ({ data: message }) => {
  try {
    if (message.init)
      controller = new SpeechController(
        message.model,
        'unused-file-capture',
        (event) => {
          if (event.type === 'gap' || (event.type === 'status' && event.status.state === 'error'))
            failures.push(event.message || event.status.error || 'Speech pipeline failed');
          if (event.type === 'audio-progress' && event.source === 'system') lastProgress = event;
          port.postMessage({ event });
        },
        adapter,
        message.qwenDirectory,
      );
    let value;
    if (message.play) value = await play(message.play);
    else if (message.close) await controller?.close();
    else if (!message.init) value = await controller.call(message.call);
    port.postMessage({ id: message.id, value });
  } catch (error) {
    port.postMessage({ id: message.id, error: error.message });
  }
});
process.once('SIGTERM', () => {
  for (const capture of captures.values()) {
    capture.active = false;
    clearInterval(capture.timer);
  }
  void controller?.close().finally(() => process.exit(0));
});
