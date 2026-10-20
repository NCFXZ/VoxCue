import { expect, it, vi } from 'vitest';
import type { AudioPacket } from '../../../shared/electron/backend/speech/buffer';
const state = vi.hoisted(() => ({ messages: [] as any[] }));
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
        this.emit('exit');
        return 0;
      }
    },
  };
});
import { SpeechController } from '../../../shared/electron/backend/speech/controller';
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
