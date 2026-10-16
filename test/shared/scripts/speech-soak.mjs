import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url),
  sherpa = require('sherpa-onnx-node');
const seconds = Number(process.argv.find((a) => a.startsWith('--seconds='))?.split('=')[1] ?? 600);
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
  ready,
  flushed;
worker.on('message', (m) => {
  if (m.ready) ready?.();
  if (m.flushed) flushed?.();
  if (m.error) errors.push(m.error);
  if (m.ack) {
    queued = Math.max(0, queued - m.ms);
    inferenceMs = m.inferenceMs;
    audioMs = m.audioMs;
  }
  if (m.event?.type === 'segment') {
    m.event.segment.final ? finals++ : interim++;
  }
});
worker.on('error', (e) => errors.push(e.message));
await new Promise((resolve, reject) => {
  ready = resolve;
  worker.once('error', reject);
  worker.postMessage({ op: 'init', directory: path.resolve('local-models/speech') });
});
const waves = ['chinese', 'english'].map((n) =>
  sherpa.readWave(`test/results/speech-fixtures/${n}.wav`, false),
);
let offsets = [0, 0];
const origin = performance.now(),
  cpu = process.cpuUsage();
try {
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
  await new Promise((resolve) => {
    flushed = resolve;
    worker.postMessage({ op: 'flush', reason: 'stop', id: 1 });
  });
} finally {
  await worker.terminate();
  await writeFile(
    'test/results/speech-soak-results.json',
    JSON.stringify(
      {
        wallMs: performance.now() - origin,
        audioMs,
        inferenceMs,
        maxQueueMs: maxQueued,
        droppedSamples: 0,
        finals,
        interim,
        errors,
        metrics,
        parentCpu: process.cpuUsage(cpu),
        workerThreadIdAfterClose: worker.threadId,
        note: '10-minute paced dual-channel generated PCM with real ASR/VAD. Separate physical device tests cover WASAPI; this is not a 10-minute human conversation accuracy benchmark.',
      },
      null,
      2,
    ),
  );
}
console.log({ seconds, finals, interim, maxQueueMs: maxQueued, errors });
