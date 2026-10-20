import workspace from '../../scripts/workspace.mjs';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = workspace.platformRequire,
  sherpa = require('sherpa-onnx-node');
const seconds = Number(process.argv.find((a) => a.startsWith('--seconds='))?.split('=')[1] ?? 300);
assert.ok(Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600, 'Invalid soak duration');
const worker = new Worker(path.resolve('dist-electron/shared/electron/backend/speech/worker.js'));
let queued = 0,
  maxQueued = 0,
  sequence = 0,
  finals = 0,
  interim = 0,
  errors = [],
  metrics = [],
  inferenceMs = 0,
  audioMs = 0,
  acknowledgements = 0;
function reply(request, predicate, label) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.off('message', message);
      worker.off('error', failure);
      worker.off('exit', exited);
    };
    const failure = (error) => {
      cleanup();
      reject(error);
    };
    const exited = (code) => failure(Error(`${label}: worker exited ${code}`));
    const message = (value) => {
      if (value.error) failure(Error(value.error));
      else if (predicate(value)) {
        cleanup();
        resolve(value);
      }
    };
    const timer = setTimeout(() => failure(Error(`${label} timed out`)), 30000);
    worker.on('message', message);
    worker.once('error', failure);
    worker.once('exit', exited);
    worker.postMessage(request);
  });
}
worker.on('message', (m) => {
  if (m.error) errors.push(m.error);
  if (m.ack) {
    if (m.ack !== ++acknowledgements) errors.push('Duplicate or out-of-order acknowledgement');
    queued = Math.max(0, queued - m.ms);
    inferenceMs = m.inferenceMs;
    audioMs = m.audioMs;
  }
  if (m.event?.type === 'segment') {
    m.event.segment.final ? finals++ : interim++;
  }
});
worker.on('error', (e) => errors.push(e.message));
const fixtureRoot =
  process.env.VOXCUE_SPEECH_FIXTURE_DIR ?? path.resolve('../shared/test/fixtures/speech-audio');
const waves = ['chinese', 'english'].map((n) =>
  sherpa.readWave(path.join(fixtureRoot, `${n}.wav`), false),
);
let offsets = [0, 0];
const origin = performance.now(),
  cpu = process.cpuUsage();
try {
  await reply(
    {
      op: 'init',
      directory:
        process.env.VOXCUE_TEST_SPEECH_MODELS ?? path.resolve('../shared/local-models/speech'),
    },
    (value) => value.ready,
    'ASR initialization',
  );
  while (performance.now() - origin < seconds * 1000) {
    const elapsed = performance.now() - origin;
    for (let i = 0; i < 2; i++) {
      const wave = waves[i],
        samples = new Float32Array(512),
        period = wave.samples.length + 16000;
      for (let j = 0; j < 512; j++) {
        const p = (offsets[i] + j) % period;
        if (p < wave.samples.length) samples[j] = wave.samples[p];
      }
      offsets[i] += 512;
      queued += 32;
      maxQueued = Math.max(maxQueued, queued);
      worker.postMessage(
        {
          op: 'audio',
          source: i ? 'microphone' : 'system',
          samples,
          rate: 16000,
          timestamp: elapsed,
          sequence: ++sequence,
          ms: 32,
        },
        [samples.buffer],
      );
    }
    if (sequence % 200 === 0)
      metrics.push({
        elapsedMs: elapsed,
        rss: process.memoryUsage().rss,
        queueMs: queued,
        finals,
        interim,
      });
    if (queued > 2000 || errors.length) throw Error('Speech queue/error bound failed');
    await new Promise((r) =>
      setTimeout(r, Math.max(1, (sequence / 2) * 32 - (performance.now() - origin))),
    );
  }
  await reply(
    { op: 'flush', reason: 'stop', id: 1 },
    (value) => value.flushed === 1,
    'ASR tail flush',
  );
  assert.equal(queued, 0, 'All queued audio must be acknowledged before stop');
  assert.equal(acknowledgements, sequence, 'No audio packets may be silently lost');
  assert.deepEqual(errors, []);
  assert.ok(finals > 0 && interim > 0, 'Both real streaming and final ASR output are required');
  const warm = metrics.find((value) => value.elapsedMs >= 10000);
  if (warm)
    assert.ok(
      process.memoryUsage().rss - warm.rss < 256 * 1024 * 1024,
      'ASR memory growth exceeded 256 MiB after warmup',
    );
} finally {
  try {
    await reply({ op: 'close', id: 2 }, (value) => value.closed === 2, 'ASR model release');
  } finally {
    await worker.terminate();
  }
  console.log(
    JSON.stringify(
      {
        wallMs: performance.now() - origin,
        audioMs,
        inferenceMs,
        maxQueueMs: maxQueued,
        unacknowledgedPackets: sequence - acknowledgements,
        finals,
        interim,
        errors,
        metrics,
        parentCpu: process.cpuUsage(cpu),
        workerThreadIdAfterClose: worker.threadId,
        note: `${seconds}-second paced public-fixture dual-channel PCM with real ASR/VAD; no physical microphone, human accuracy or Windows hardware validation.`,
      },
      null,
      2,
    ),
  );
}
console.log({ seconds, finals, interim, maxQueueMs: maxQueued, errors });
