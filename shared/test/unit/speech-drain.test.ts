import { beforeEach, expect, it, vi } from 'vitest';
import type { AudioPacket } from '../../../shared/electron/backend/speech/buffer';
import type { SpeechEvent } from '../../electron/contracts/speech';
import { recordingBacklog } from '../../electron/backend/speech/recording';
import { SpeechController } from '../../electron/backend/speech/controller';
const state = vi.hoisted(() => ({ messages: [] as any[] }));
beforeEach(() => { state.messages.length = 0; });
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      postMessage(message: any) {
        state.messages.push(message);
        queueMicrotask(() => {
          if (message.op === 'init') this.emit('message', { ready: true });
          if (message.op === 'audio')
            this.emit('message', { ack: message.sequence, ms: message.ms });
          if (message.op === 'flush') this.emit('message', { flushed: message.id });
          if (message.op === 'prepare') this.emit('message', { prepared: message.id });
          if (message.op === 'close') this.emit('message', { closed: message.id });
        });
      }
      async terminate() {
        state.messages.push({ op: 'terminate' });
        this.emit('exit');
        return 0;
      }
    },
  };
});

it.each([false, true])('慢盘积压立即报告，转写独立收尾，停止请求仍等文件关闭（识别器超载=%s）', async overloaded => {
  let packet!: (value: AudioPacket) => void;
  let release!: () => void;
  const disk = new Promise<void>(resolve => { release = resolve; });
  const events: SpeechEvent[] = [];
  const controller = new SpeechController('model', 'helper', event => events.push(event), {
    devices: async () => [{ id: 'system', name: 'System', source: 'system', default: true }],
    create: (_helper, _source, _device, audio) => {
      packet = audio;
      return { start: async () => {}, stop: async () => {} };
    },
  }, 'qwen');
  try {
    await controller.call({ op: 'start', options: { sources: ['system'], speechModel: 'qwen' } });
    Object.assign(controller, { recording: {
      startedAt: Date.now() - 1000,
      append() { throw Error(recordingBacklog); },
      close: () => disk,
    } });
    const audio = { rate: 16000, timestamp: 0, flags: 0, samples: new Float32Array(160) };
    packet(audio);
    expect(events).toContainEqual({ type: 'recording', active: false, draining: true, error: recordingBacklog });
    if (overloaded) packet({ ...audio, samples: new Float32Array(16000 * 31) });
    let stopped = false;
    const stop = controller.call({ op: 'stop' }).then(() => { stopped = true; });
    await vi.waitFor(() => expect(state.messages).toContainEqual(
      expect.objectContaining({ op: overloaded ? 'terminate' : 'flush' }),
    ));
    expect(stopped).toBe(false);
    expect(events).not.toContainEqual({ type: 'recording', active: false });
    release();
    await stop;
    expect(events).toContainEqual({ type: 'recording', active: false });
  } finally {
    release();
    await controller.close();
  }
});
it('支持排空的原生适配器在 ASR flush 前交付尾包，停止后旧回调失效', async () => {
  let packet: (value: AudioPacket) => void = () => {};
  const tail = { rate: 16000, timestamp: 0, flags: 0, samples: new Float32Array(160) };
  const controller = new SpeechController('model', 'helper', () => {}, {
    drainBeforeRetire: true,
    devices: async () => [{ id: 'mic', name: 'Mic', source: 'microphone', default: true }],
    create: (_helper, _source, _device, audio) => {
      packet = audio;
      return { start: async () => {}, stop: async () => audio(tail) };
    },
  });
  try {
    await controller.call({ op: 'start', options: { sources: ['microphone'] } });
    await controller.call({ op: 'stop' });
    expect(
      state.messages.filter((m) => ['audio', 'flush'].includes(m.op)).map((m) => m.op),
    ).toEqual(['audio', 'flush']);
    const count = state.messages.length;
    packet(tail);
    expect(state.messages).toHaveLength(count);
  } finally {
    await controller.close();
  }
});
it('录音最后一次写盘失败会随停止结果返回一次，识别器仍正常收尾', async () => {
  const events: SpeechEvent[] = [];
  const controller = new SpeechController('model', 'helper', event => events.push(event), {
    devices: async () => [],
    create: () => { throw Error('unexpected capture'); },
  });
  try {
    Object.assign(controller, { recording: { close: async () => { throw Error('disk full'); } } });
    const result = await controller.call({ op: 'stop' });
    expect(result).toMatchObject({ state: 'idle', recordingError: '录音写入失败，请检查可用空间。' });
    expect(result.transcriptTailIncomplete).toBeUndefined();
    expect(events).toContainEqual({ type: 'recording', active: false, error: result.recordingError });
    expect((await controller.call({ op: 'stop' })).recordingError).toBeUndefined();
  } finally { await controller.close(); }
});
it('暂停时的录音错误保留到恢复后的最终停止，然后下一场重新开始', async () => {
  const controller = new SpeechController('model', 'helper', () => {}, {
    devices: async () => [{ id: 'system', name: 'System', source: 'system', default: true }],
    create: () => ({ start: async () => {}, stop: async () => {} }),
  });
  const start = () => controller.call({ op: 'start', options: { sources: ['system'] } });
  try {
    await start();
    Object.assign(controller, { recording: { close: async () => { throw Error('disk full'); } } });
    expect((await controller.call({ op: 'pause' })).state).toBe('paused');
    expect((await start()).state).toBe('running');
    expect((await controller.call({ op: 'stop' })).recordingError).toBe('录音写入失败，请检查可用空间。');
    await start();
    expect((await controller.call({ op: 'stop' })).recordingError).toBeUndefined();
  } finally { await controller.close(); }
});
