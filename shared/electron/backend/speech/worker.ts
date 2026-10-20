import { parentPort } from 'node:worker_threads';
import { SpeechEngine } from './engine';
import { QwenEngine } from './qwen';
import type { AudioPreprocessor, ConsumeAudio } from './preprocessor';
let engine: SpeechEngine | QwenEngine;
let preprocessor: AudioPreprocessor | undefined;
let preprocessing = false;
let feeding = Promise.resolve();
let messages = Promise.resolve();
let failed = false;
let qwen = false;
const fail = (error?: unknown) => {
  if (failed) return;
  failed = true;
  preprocessor?.close();
  if (engine instanceof QwenEngine) void engine.close();
  parentPort!.postMessage({
    error:
      error instanceof Error && qwen
        ? error.message
        : preprocessing
          ? '本地回声消除或语音推理失败，采集已停止；请重新开始。'
          : '本地语音推理失败；请检查模型、设备或降低并发负载后重新开始。',
  });
};
const consume: ConsumeAudio = (source, samples, rate, timestamp) => {
  feeding = feeding.then(() => engine.feed(source, samples, rate, timestamp));
  void feeding.catch(fail);
};
parentPort!.on('message', (m) => {
  messages = messages
    .then(async () => {
      if (m.op === 'close') {
        preprocessor?.close();
        await feeding.catch(() => {});
        if (engine instanceof QwenEngine) await engine.close();
        parentPort!.postMessage({ closed: m.id });
        return;
      }
      if (failed) return;
      if (m.op === 'init') {
        const start = performance.now();
        let metadata = {};
        if (m.speechModel === 'qwen') {
          qwen = true;
          const loaded = await QwenEngine.load(m.directory, m.inferenceDevice, (event) =>
            parentPort!.postMessage({ event }),
          );
          engine = loaded.engine;
          metadata = { chunkMs: loaded.chunkMs, alignmentDevice: loaded.alignmentDevice };
        } else
          engine = new SpeechEngine(m.directory, (event) => parentPort!.postMessage({ event }));
        if (m.preprocessorFile) {
          preprocessing = true;
          const factory: {
            createAudioPreprocessor(
              consume: ConsumeAudio,
              failure: () => void,
            ): Promise<AudioPreprocessor>;
          } = require(m.preprocessorFile);
          preprocessor = await factory.createAudioPreprocessor(consume, fail);
        }
        parentPort!.postMessage({ ready: true, loadMs: performance.now() - start, ...metadata });
      } else if (m.op === 'prepare') {
        preprocessor?.start(m.sources);
        parentPort!.postMessage({ prepared: m.id });
      } else if (m.op === 'audio') {
        if (preprocessor)
          preprocessor.feed(m.source, m.samples, m.rate, m.timestamp, m.captureClock);
        else consume(m.source, m.samples, m.rate, m.timestamp);
        await feeding;
        parentPort!.postMessage({
          ack: m.sequence,
          source: m.source,
          ms: m.ms,
          audioMs: engine.audioMs,
          inferenceMs: engine.inferenceMs,
        });
      } else if (m.op === 'gap') {
        const sources = preprocessor?.discontinuity(m.source) ?? [m.source];
        await feeding;
        for (const source of sources) await engine.discontinuity(source);
      } else if (m.op === 'flush') {
        preprocessor?.flush();
        await feeding;
        await engine.flush(m.reason);
        parentPort!.postMessage({ flushed: m.id });
      }
    })
    .catch(fail);
});
parentPort!.on('close', () => {
  if (engine instanceof QwenEngine) void engine.close();
});
