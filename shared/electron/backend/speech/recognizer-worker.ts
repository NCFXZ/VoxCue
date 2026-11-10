import { parentPort } from 'node:worker_threads';
import { SpeechEngine } from './engine';
import { QwenEngine } from './qwen';
let engine: SpeechEngine | QwenEngine;
let messages = Promise.resolve();
parentPort!.on('message', (m) => {
  messages = messages.then(async () => {
    try {
      let value: unknown;
      if (m.op === 'init') {
        if (m.speechModel === 'qwen') {
          const loaded = await QwenEngine.load(
            m.directory,
            m.inferenceDevice,
            (event) => parentPort!.postMessage({ event }),
            m.runtimeFile,
          );
          engine = loaded.engine;
          value = { chunkMs: loaded.chunkMs, alignmentDevice: loaded.alignmentDevice };
        } else {
          engine = new SpeechEngine(m.directory, (event) => parentPort!.postMessage({ event }));
          value = {};
        }
      } else if (m.op === 'close') {
        if (engine instanceof QwenEngine) await engine.close();
      } else {
        if (m.op === 'audio') await engine.feed(m.source, m.samples, m.rate, m.timestamp);
        else if (m.op === 'gap') await engine.discontinuity(m.source);
        else if (m.op === 'discard') await engine.discard(m.source);
        else if (m.op === 'flush') await engine.flush(m.reason);
        else throw Error('Unknown recognizer operation');
        value = {
          audioMs: engine.audioMs,
          inferenceMs: engine.inferenceMs,
          progress: {
            system: engine.processedThrough('system'),
            microphone: engine.processedThrough('microphone'),
          },
          idle: { system: engine.canSwitch('system'), microphone: engine.canSwitch('microphone') },
        };
      }
      parentPort!.postMessage({ id: m.id, value });
    } catch (error) {
      parentPort!.postMessage({
        id: m.id,
        error: error instanceof Error ? error.message : '语音识别器失败。',
      });
    }
  });
});
parentPort!.on('close', () => {
  if (engine instanceof QwenEngine) void engine.close();
});
