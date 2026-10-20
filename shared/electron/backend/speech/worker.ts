import { parentPort } from 'node:worker_threads';
import { Recognizer } from './recognizer';
import { RecognitionRouter } from './recognition';
import type { AudioPreprocessor, ConsumeAudio } from './preprocessor';
let engine: RecognitionRouter;
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
  void engine?.close().catch(() => {});
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
  // Loading a candidate must never occupy the serial capture/AEC queue.
  if (m.op === 'stage-recognizer') {
    if (failed || !engine) {
      parentPort!.postMessage({ switchError: m.id, message: '语音服务尚未就绪。' });
      return;
    }
    void engine
      .stage(m.options, (phase) => parentPort!.postMessage({ switchPhase: m.id, phase }))
      .then((metadata) => {
        qwen = m.options.speechModel === 'qwen';
        parentPort!.postMessage({ switched: m.id, ...metadata });
      })
      .catch((error) =>
        parentPort!.postMessage({
          switchError: m.id,
          message: error instanceof Error ? error.message : '语音切换失败，仍使用原配置。',
        }),
      );
    return;
  }
  if (m.op === 'cancel-switch') {
    engine?.cancel();
    return;
  }
  messages = messages
    .then(async () => {
      if (m.op === 'close') {
        preprocessor?.close();
        await feeding.catch(() => {});
        await engine?.close();
        parentPort!.postMessage({ closed: m.id });
        return;
      }
      if (failed) return;
      if (m.op === 'init') {
        const start = performance.now();
        qwen = m.speechModel === 'qwen';
        engine = new RecognitionRouter(
          (options, emit, signal) => Recognizer.load(options, emit, signal),
          (event) => parentPort!.postMessage({ event }),
        );
        await engine.initialize(
          {
            directory: m.directory,
            speechModel: m.speechModel,
            inferenceDevice: m.inferenceDevice,
            runtimeFile: m.runtimeFile,
          },
          m.sources ?? [],
        );
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
        parentPort!.postMessage({
          ready: true,
          loadMs: performance.now() - start,
          ...engine.metadata,
        });
      } else if (m.op === 'prepare') {
        preprocessor?.start(m.sources);
        engine.prepare(m.sources);
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
          progress: {
            microphone: engine.processedThrough('microphone'),
            system: engine.processedThrough('system'),
          },
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
  void engine?.close().catch(() => {});
});
