import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: native.spawn, execFile: vi.fn() }));
import { CoreAudioCapture } from '../../electron/speech/capture';
import { SpeechController } from '../../electron/speech/controller';
beforeEach(() => {
  vi.useFakeTimers();
  native.spawn.mockReset();
});
afterEach(() => vi.useRealTimers());
function fixture(kill = () => true) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    kill: vi.fn(kill),
  });
  native.spawn.mockReturnValue(child);
  const audio = vi.fn();
  const capture = new CoreAudioCapture('synthetic', 'system', undefined, audio, vi.fn());
  const ready = async (value = capture) => {
    const start = value.start();
    child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
    await start;
  };
  return { child, capture, audio, ready };
}
it('shares stop work, drains audio after exit and requires actual close', async () => {
  const f = fixture();
  await f.ready();
  let settled = false;
  const stopping = f.capture.stop();
  expect(f.capture.stop()).toBe(stopping);
  void stopping.then(() => {
    settled = true;
  });
  f.child.emit('exit', 0);
  await Promise.resolve();
  expect(settled).toBe(false);
  const packet = Buffer.alloc(25);
  packet.writeUInt32LE(21);
  packet[4] = 1;
  packet.writeUInt32LE(16000, 5);
  packet.writeFloatLE(0.25, 21);
  f.child.stdout.emit('data', packet);
  expect(f.audio.mock.calls[0][0].samples[0]).toBe(0.25);
  f.child.emit('close', 0);
  await stopping;
  expect(f.capture.retired).toBe(true);
  expect(f.child.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['success', 'false', 'throw'] as const)(
  'never equates kill %s with close; fences replacement until late close',
  async (mode) => {
    const f = fixture(() => {
      if (mode === 'throw') throw Error('synthetic kill failure');
      return mode !== 'false';
    });
    const controller = new SpeechController('synthetic-model', 'synthetic', vi.fn());
    const adapter = (controller as any).adapter;
    const capture = adapter.create('synthetic', 'system', undefined, vi.fn(), vi.fn());
    await f.ready(capture);
    const stopped = capture.stop().then(
      () => undefined,
      (error: Error) => error,
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await stopped).toBeInstanceOf(Error);
    expect(capture.retiring).toBe(true);
    expect(f.child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(() => adapter.create('synthetic', 'microphone', undefined, vi.fn(), vi.fn())).toThrow(
      '尚未退出',
    );
    await expect(capture.start()).rejects.toThrow('尚未退出');
    expect(native.spawn).toHaveBeenCalledOnce();
    f.child.emit('close', null);
    await capture.stop();
    expect(capture.retiring).toBe(false);
    expect(() =>
      adapter.create('synthetic', 'microphone', undefined, vi.fn(), vi.fn()),
    ).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it('reports forced shutdown even when close is subsequently confirmed', async () => {
  const f = fixture();
  await f.ready();
  const result = f.capture.stop().catch((error: Error) => error);
  await vi.advanceTimersByTimeAsync(2500);
  f.child.emit('close', null);
  expect((await result)!.message).toContain('强制停止');
  expect(f.capture.retiring).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
