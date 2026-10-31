import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AudioPacket } from '../../electron/backend/speech/buffer';
import type { AudioSource, SpeechEvent } from '../../electron/contracts/speech';
const runtime = vi.hoisted(() => ({ workers: [] as any[], messages: [] as any[] }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      constructor() {
        super();
        runtime.workers.push(this);
      }
      postMessage(message: any) {
        runtime.messages.push(message);
        queueMicrotask(() => {
          if (message.op === 'init') this.emit('message', { ready: true });
          if (message.op === 'flush') this.emit('message', { flushed: message.id });
          if (message.op === 'prepare') this.emit('message', { prepared: message.id });
          if (message.op === 'close') this.emit('message', { closed: message.id });
        });
      }
      async terminate() {
        this.emit('exit');
        return 0;
      }
    },
  };
});
import { SpeechController } from '../../electron/backend/speech/controller';
let controller: SpeechController;
let events: SpeechEvent[];
const captures = new Map<AudioSource, (packet: AudioPacket) => void>();
beforeEach(async () => {
  vi.useFakeTimers();
  runtime.workers = [];
  runtime.messages = [];
  captures.clear();
  events = [];
  controller = new SpeechController('model', 'helper', (event) => events.push(event), {
    devices: async () =>
      ['system', 'microphone'].map((source) => ({
        id: source,
        name: source,
        source: source as AudioSource,
        default: true,
      })),
    create: (_helper, source, _device, audio) => {
      captures.set(source, audio);
      return { start: async () => {}, stop: async () => {} };
    },
  });
  await controller.call({ op: 'start', options: { sources: ['system', 'microphone'] } });
});
afterEach(async () => {
  await controller.close();
  vi.useRealTimers();
});
const packet = () => ({ samples: new Float32Array(3200), rate: 16000, timestamp: 0, flags: 0 });
const last = (source: AudioSource) =>
  events.filter((e) => e.type === 'audio-progress' && e.source === source).at(-1);
const ack = (message: any, system?: number, microphone?: number) =>
  runtime.workers.at(-1).emit('message', {
    ack: message.sequence,
    ms: message.ms,
    progress: { system, microphone },
  });

it('采集先标记积压，处理完本音源所有包后才允许使用其静音进度', () => {
  captures.get('system')!(packet());
  captures.get('system')!(packet());
  captures.get('microphone')!(packet());
  const audio = runtime.messages.filter((message) => message.op === 'audio');
  expect(last('system')).toMatchObject({ pending: true });
  ack(audio[2], 1800, 1800);
  expect(last('system')).toMatchObject({ pending: true, processedThroughMs: 1800 });
  expect(last('microphone')).toMatchObject({ pending: false });
  ack(audio[0], 1900, 1800);
  expect(last('system')).toMatchObject({ pending: true });
  ack(audio[1], 2000, 1800);
  expect(last('system')).toMatchObject({ pending: false, processedThroughMs: 2000 });
  const count = events.length;
  ack(audio[1], 9000, 9000); // Duplicate/stale ACK cannot invent progress.
  expect(events).toHaveLength(count);
});
it('未确认音频不能靠墙钟超时变成已处理，暂停重启不复用旧进度', async () => {
  captures.get('system')!(packet());
  const audio = runtime.messages.find((message) => message.op === 'audio');
  await vi.advanceTimersByTimeAsync(150);
  expect(last('system')).toMatchObject({ pending: true });
  ack(audio, 3000);
  expect(last('system')).toMatchObject({ pending: false, processedThroughMs: 3000 });
  await controller.call({ op: 'pause' });
  await controller.call({ op: 'start', options: { sources: ['system'] } });
  captures.get('system')!(packet());
  expect(last('system')).toMatchObject({ pending: true, processedThroughMs: undefined });
});
it('采集停顿不按墙钟补造静音，两路进度都必须等待原生采集包', async () => {
  captures.get('system')!(packet());
  captures.get('microphone')!(packet());
  const audio = runtime.messages.filter((message) => message.op === 'audio');
  ack(audio[0], 1800, undefined);
  ack(audio[1], 1800, 1800);
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.messages.filter((message) => message.op === 'audio')).toHaveLength(2);
  expect(last('system')).toMatchObject({ pending: false, processedThroughMs: 1800 });
  expect(last('microphone')).toMatchObject({ pending: false, processedThroughMs: 1800 });
  captures.get('system')!(packet());
  expect(last('system')).toMatchObject({ pending: true, processedThroughMs: 1800 });
});
it('热切换不重建采集或清空进度，收到交接确认才更新当前选择', async () => {
  // This fixture has no Qwen directory; use the trusted platform port explicitly.
  Object.assign(controller, { qwenDirectory: 'synthetic-qwen' });
  captures.get('system')!(packet());
  const audio = runtime.messages.find((m) => m.op === 'audio');
  ack(audio, 1800);
  const oldCapture = captures.get('system');
  const options = {
    sources: ['system', 'microphone'] as AudioSource[],
    speechModel: 'qwen' as const,
    inferenceDevice: 'metal' as const,
  };
  const pending = controller.call({ op: 'switch-recognizer', options });
  const stage = runtime.messages.find((m) => m.op === 'stage-recognizer');
  expect(await controller.call({ op: 'status' })).toMatchObject({
    state: 'running',
    speechModel: 'paraformer',
    switching: 'loading',
  });
  runtime.workers.at(-1).emit('message', { switchPhase: stage.id, phase: 'waiting' });
  captures.get('system')!(packet());
  expect(last('system')).toMatchObject({ pending: true, processedThroughMs: 1800 });
  expect(captures.get('system')).toBe(oldCapture);
  expect(runtime.messages.some((m) => m.op === 'flush')).toBe(false);
  runtime.workers
    .at(-1)
    .emit('message', { switched: stage.id, chunkMs: 1000, alignmentDevice: 'cpu' });
  expect(await pending).toMatchObject({
    state: 'running',
    speechModel: 'qwen',
    inferenceDevice: 'metal',
    chunkMs: 1000,
  });
  expect((await controller.call({ op: 'status' })).switching).toBeUndefined();
});
it('候选失败保持原语音状态，暂停立即取消未完成的设备切换并忽略迟到确认', async () => {
  Object.assign(controller, { qwenDirectory: 'synthetic-qwen' });
  const options = {
    sources: ['system', 'microphone'] as AudioSource[],
    speechModel: 'qwen' as const,
    inferenceDevice: 'cpu' as const,
  };
  const failed = controller.call({ op: 'switch-recognizer', options });
  const rejection = expect(failed).rejects.toThrow('candidate failed');
  let stage = runtime.messages.filter((m) => m.op === 'stage-recognizer').at(-1);
  runtime.workers.at(-1).emit('message', { switchError: stage.id, message: 'candidate failed' });
  await rejection;
  expect(await controller.call({ op: 'status' })).toMatchObject({
    state: 'running',
    speechModel: 'paraformer',
  });
  const pending = controller.call({ op: 'switch-recognizer', options });
  const cancelled = expect(pending).rejects.toThrow('取消');
  stage = runtime.messages.filter((m) => m.op === 'stage-recognizer').at(-1);
  await controller.call({ op: 'pause' });
  await cancelled;
  runtime.workers.at(-1).emit('message', { switched: stage.id, chunkMs: 1000 });
  expect(await controller.call({ op: 'status' })).toMatchObject({
    state: 'paused',
    speechModel: 'paraformer',
  });
  const retired = runtime.workers.at(-1);
  await controller.call({ op: 'start', options: { sources: ['system', 'microphone'] } });
  expect(runtime.workers.at(-1)).not.toBe(retired);
  expect(await controller.call({ op: 'status' })).toMatchObject({
    state: 'running',
    speechModel: 'paraformer',
  });
});

async function selectModel(speechModel: 'qwen' | 'paraformer') {
  Object.assign(controller, { qwenDirectory: 'synthetic-qwen' });
  const pending = controller.call({
    op: 'switch-recognizer',
    options: { sources: ['system', 'microphone'], speechModel, inferenceDevice: 'cpu' },
  });
  const stage = runtime.messages.filter((m) => m.op === 'stage-recognizer').at(-1);
  runtime.workers.at(-1).emit('message', { switched: stage.id, chunkMs: 1000 });
  await pending;
}
it('Qwen切回Paraformer不把继承积压误判为新模型超载，排空后恢复2秒上限', async () => {
  await selectModel('qwen');
  for (let i = 0; i < 15; i++) captures.get('system')!(packet());
  const inherited = runtime.messages.filter((m) => m.op === 'audio');
  await selectModel('paraformer');
  captures.get('system')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  // Out-of-order ACKs shrink only the actual acknowledged audio duration.
  for (const message of inherited.slice(1)) ack(message);
  captures.get('microphone')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  ack(inherited[0]);
  for (const message of runtime.messages.filter((m) => m.op === 'audio').slice(inherited.length))
    ack(message);
  for (let i = 0; i < 10; i++) captures.get('system')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  captures.get('system')!(packet());
  expect(events.some((e) => e.type === 'status' && e.status.error?.includes('积压'))).toBe(true);
});
it('新旧音频一同追平后才恢复Paraformer预算，不在旧队列排空中途误停', async () => {
  await selectModel('qwen');
  for (let i = 0; i < 15; i++) captures.get('system')!(packet());
  await selectModel('paraformer');
  const inherited = runtime.messages.filter((m) => m.op === 'audio');
  for (let i = 0; i < 15; i++) captures.get('system')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  for (const message of inherited) ack(message);
  // Merely processing the pre-handoff packets is insufficient: live input
  // accepted while draining must all be acknowledged within the same 30s cap.
  captures.get('microphone')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  const accepted = runtime.messages.filter((m) => m.op === 'audio').slice(inherited.length);
  for (const message of accepted.slice(0, 11)) ack(message);
  for (let i = 0; i < 5; i++) captures.get('system')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  captures.get('microphone')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  for (const message of runtime.messages.filter((m) => m.op === 'audio')) ack(message);
  for (let i = 0; i < 10; i++) captures.get('system')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  captures.get('microphone')!(packet());
  expect(events.some((e) => e.type === 'status' && e.status.error?.includes('积压'))).toBe(true);
});
it('交接继承和新增音频合计仍受原30秒绝对上限保护', async () => {
  await selectModel('qwen');
  for (let i = 0; i < 149; i++) captures.get('system')!(packet());
  await selectModel('paraformer');
  captures.get('microphone')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  captures.get('microphone')!(packet());
  expect(events.some((e) => e.type === 'status' && e.status.error?.includes('积压'))).toBe(true);
});

it.each([10, 15])('交接%s包在2秒边界的下一批双路音频不误停，全部ACK后仍限制2秒', async (count) => {
  await selectModel('qwen');
  for (let i = 0; i < count; i++) captures.get('system')!(packet());
  const inherited = runtime.messages.filter((m) => m.op === 'audio');
  await selectModel('paraformer');
  for (const message of inherited.slice(0, count - 10)) ack(message);
  captures.get('system')!(packet());
  captures.get('microphone')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  for (const message of runtime.messages.filter((m) => m.op === 'audio')) ack(message);
  for (let i = 0; i < 10; i++) captures.get('system')!(packet());
  expect(await controller.call({ op: 'status' })).toMatchObject({ state: 'running' });
  captures.get('microphone')!(packet());
  expect(events.some((e) => e.type === 'status' && e.status.error?.includes('积压'))).toBe(true);
});
