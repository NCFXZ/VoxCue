import { parentPort } from 'node:worker_threads';
import { Recognizer } from './recognizer';
import { RecognitionRouter } from './recognition';
import type { AudioSource, InterviewInputState, SpeechEvent } from '../../contracts/speech';
import { inputSources, inputSourceEnabled, speechSwitchCancelled } from '../../contracts/speechSettings';
const userCancellation = Error(speechSwitchCancelled);
let engine: RecognitionRouter;
let messages = Promise.resolve();
let failed = false;
let qwen = false;
let inputState: InterviewInputState = { inputMode: 'remote', microphoneMuted: false };
let pendingInput: object | undefined;
const blockedInput = new Set<AudioSource>();
const enabled = (source: AudioSource) =>
  !blockedInput.has(source) && inputSourceEnabled(inputState, source);
const enabledSources = (state: InterviewInputState) =>
  inputSources(state).filter((source) => inputSourceEnabled(state, source));
const emit = (event: SpeechEvent) => {
  const source =
    event.type === 'segment' ? event.segment.source : 'source' in event ? event.source : undefined;
  if (!source || enabled(source)) parentPort!.postMessage({ event });
};
const fail = (error?: unknown) => {
  if (failed) return;
  failed = true;
  void engine?.close().catch(() => {});
  parentPort!.postMessage({
    error:
      error instanceof Error && qwen
        ? error.message
        : '本地语音推理失败；请检查模型、设备或降低并发负载后重新开始。',
  });
};
parentPort!.on('message', (m) => {
  if (m.op === 'set-input-state') {
    pendingInput = m;
    for (const source of m.changed as AudioSource[]) blockedInput.add(source);
  }
  // Loading a candidate must never occupy the serial recognition queue.
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
          userCancelled: error === userCancellation,
          message: error instanceof Error ? error.message : '语音切换失败，仍使用原配置。',
        }),
      );
    return;
  }
  if (m.op === 'expedite-switch') {
    engine?.expedite(m.manual === true);
    return;
  }
  if (m.op === 'cancel-switch') {
    engine?.cancel(m.manual ? userCancellation : undefined);
    return;
  }
  messages = messages
    .then(async () => {
      if (m.op === 'close') {
        await engine?.close();
        parentPort!.postMessage({ closed: m.id });
        return;
      }
      if (failed) {
        if (m.id !== undefined)
          parentPort!.postMessage({ error: '语音服务已失败，尾段无法处理；请重新开始。' });
        return;
      }
      if (m.op === 'init') {
        const start = performance.now();
        qwen = m.speechModel === 'qwen';
        engine = new RecognitionRouter(
          (options, emit, signal) => Recognizer.load(options, emit, signal),
          emit,
        );
        await engine.initialize(
          {
            directory: m.directory,
            speechModel: m.speechModel,
            inferenceDevice: m.inferenceDevice,
            runtimeFile: m.runtimeFile,
            legacyModels: m.legacyModels,
          },
          m.sources ?? [],
        );
        parentPort!.postMessage({
          ready: true,
          loadMs: performance.now() - start,
          ...engine.metadata,
        });
      } else if (m.op === 'prepare') {
        inputState = m.inputState ?? { inputMode: 'remote', microphoneMuted: false };
        blockedInput.clear();
        engine.prepare(m.sources.filter((source: AudioSource) => enabled(source)));
        parentPort!.postMessage({ prepared: m.id });
      } else if (m.op === 'set-input-state') {
        if (pendingInput === m) {
          await engine.inputSources(enabledSources(m.state), m.changed);
          if (pendingInput === m) {
            inputState = m.state;
            pendingInput = undefined;
            blockedInput.clear();
          }
        }
        parentPort!.postMessage({ inputSet: m.id });
      } else if (m.op === 'audio') {
        if (enabled(m.source)) await engine.feed(m.source, m.samples, m.rate, m.timestamp);
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
        await engine.discontinuity(m.source);
      } else if (m.op === 'flush') {
        await engine.flush(m.reason);
        parentPort!.postMessage({ flushed: m.id });
      }
    })
    .catch(fail);
});
parentPort!.on('close', () => {
  void engine?.close().catch(() => {});
});
