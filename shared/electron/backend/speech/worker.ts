import { parentPort } from 'node:worker_threads';
import { SpeechEngine } from './engine';
let engine: SpeechEngine;
parentPort!.on('message', (m) => {
  try {
    if (m.op === 'init') {
      const start = performance.now();
      engine = new SpeechEngine(m.directory, (event) => parentPort!.postMessage({ event }));
      parentPort!.postMessage({ ready: true, loadMs: performance.now() - start });
    } else if (m.op === 'audio') {
      engine.feed(m.source, m.samples, m.rate, m.timestamp);
      parentPort!.postMessage({
        ack: m.sequence,
        source: m.source,
        ms: m.ms,
        audioMs: engine.audioMs,
        inferenceMs: engine.inferenceMs,
      });
    } else if (m.op === 'gap') {
      engine.discontinuity(m.source);
    } else if (m.op === 'flush') {
      engine.flush(m.reason);
      parentPort!.postMessage({ flushed: m.id });
    }
  } catch {
    parentPort!.postMessage({
      error: '本地语音推理失败；请检查模型、设备或降低并发负载后重新开始。',
    });
  }
});
