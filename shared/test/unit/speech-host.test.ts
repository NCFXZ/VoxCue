import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const native = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: native.fork } }));
import { SpeechHost } from '../../electron/backend/speech/host';
const hosts: SpeechHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.stop();
  vi.useRealTimers();
});
it('候选超时只取消切换，不杀掉继续采集的旧服务；迟到确认不复活请求', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    postMessage: vi.fn((m: any) => {
      if (m.init) queueMicrotask(() => child.emit('message', { id: m.id }));
      if (m.call?.op === 'status')
        queueMicrotask(() =>
          child.emit('message', { id: m.id, value: { state: 'running', model: 'old' } }),
        );
    }),
  });
  native.fork.mockReturnValue(child);
  const host = new SpeechHost(
    'synthetic-model',
    'synthetic-helper',
    () => {},
    'synthetic-process',
    'synthetic-qwen',
  );
  hosts.push(host);
  await host.call({ op: 'status' });
  const pending = host.call({
    op: 'switch-recognizer',
    options: { sources: ['system'], speechModel: 'qwen', inferenceDevice: 'metal' },
  });
  const rejection = expect(pending).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(310000);
  await rejection;
  const stage = child.postMessage.mock.calls.find(([m]) => m.call?.op === 'switch-recognizer')![0];
  expect(child.postMessage.mock.calls.at(-1)?.[0].call).toEqual({ op: 'cancel-switch' });
  expect(child.kill).not.toHaveBeenCalled();
  child.emit('message', { id: stage.id, value: { state: 'running', model: 'late' } });
  expect(await host.call({ op: 'status' })).toEqual({ state: 'running', model: 'old' });
});
