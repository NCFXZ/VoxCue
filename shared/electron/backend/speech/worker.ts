import { parentPort } from 'node:worker_threads';
import { SpeechEngine } from './engine';
import type { AudioPreprocessor, ConsumeAudio } from './preprocessor';
let engine: SpeechEngine;
let preprocessor: AudioPreprocessor | undefined;
let preprocessing = false;
const fail = () => {
  preprocessor?.close();
  parentPort!.postMessage({
    error: preprocessing
      ? '本地回声消除或语音推理失败，采集已停止；请重新开始。'
      : '本地语音推理失败；请检查模型、设备或降低并发负载后重新开始。',
  });
};
parentPort!.on('message', async (m) => {
  try {
    if (m.op === 'init') {
      const start = performance.now();
      engine = new SpeechEngine(m.directory, (event) => parentPort!.postMessage({ event }));
      if (m.preprocessorFile) {
        preprocessing = true;
        const factory: {
          createAudioPreprocessor(
            consume: ConsumeAudio,
            failure: () => void,
          ): Promise<AudioPreprocessor>;
        } = require(m.preprocessorFile);
        preprocessor = await factory.createAudioPreprocessor(
          (source, samples, rate, timestamp) => engine.feed(source, samples, rate, timestamp),
          fail,
        );
      }
      parentPort!.postMessage({ ready: true, loadMs: performance.now() - start });
    } else if (m.op === 'prepare') {
      preprocessor?.start(m.sources);
      parentPort!.postMessage({ prepared: m.id });
    } else if (m.op === 'audio') {
      if (preprocessor) preprocessor.feed(m.source, m.samples, m.rate, m.timestamp, m.captureClock);
      else engine.feed(m.source, m.samples, m.rate, m.timestamp);
      parentPort!.postMessage({
        ack: m.sequence,
        source: m.source,
        ms: m.ms,
        audioMs: engine.audioMs,
        inferenceMs: engine.inferenceMs,
      });
    } else if (m.op === 'gap') {
      for (const source of preprocessor?.discontinuity(m.source) ?? [m.source])
        engine.discontinuity(source);
    } else if (m.op === 'flush') {
      preprocessor?.flush();
      engine.flush(m.reason);
      parentPort!.postMessage({ flushed: m.id });
    }
  } catch {
    fail();
  }
});
