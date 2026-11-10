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
it.each(['switch-recognizer', 'set-input-state'] as const)('%s超时只取消切换，不杀掉继续采集的旧服务；迟到确认不复活请求', async (operation) => {
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
  const pending = host.call(operation === 'switch-recognizer' ? {
    op: 'switch-recognizer',
    options: { sources: ['system'], speechModel: 'qwen', inferenceDevice: 'metal' },
  } : { op: 'set-input-state', state: { inputMode: 'remote', microphoneMuted: true } });
  const rejection = expect(pending).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(operation === 'switch-recognizer' ? 310000 : 200000);
  await rejection;
  const stage = child.postMessage.mock.calls.find(([m]) => m.call?.op === operation)![0];
  expect(child.postMessage.mock.calls.at(-1)?.[0].call).toEqual({ op: operation === 'switch-recognizer' ? 'cancel-switch' : 'cancel-input-state' });
  expect(child.kill).not.toHaveBeenCalled();
  child.emit('message', { id: stage.id, value: { state: 'running', model: 'late' } });
  expect(await host.call({ op: 'status' })).toEqual({ state: 'running', model: 'old' });
});
