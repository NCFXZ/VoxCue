import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ child: undefined as any }));
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: () => state.child,
}));
import { WasapiCapture } from '../../electron/speech/capture';
afterEach(() => vi.useRealTimers());

it('waits for stdout close after exit and retains the final packet before retiring capture', async () => {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn();
  child.exitCode = null;
  state.child = child;
  const audio = vi.fn(),
    failure = vi.fn();
  const capture = new WasapiCapture('unused', 'microphone', undefined, audio, failure);
  const started = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await started;
  let stopped = false;
  const stopping = capture.stop().then(() => {
    stopped = true;
  });
  child.exitCode = 0;
  child.emit('exit', 0);
  await Promise.resolve();
  expect(stopped).toBe(false);
  const packet = Buffer.alloc(25);
  packet.writeUInt32LE(21, 0);
  packet.writeUInt8(1, 4);
  packet.writeUInt32LE(48000, 5);
  packet.writeDoubleLE(987654.25, 9);
  packet.writeFloatLE(0.125, 21);
  child.stdout.emit('data', packet);
  child.emit('close', 0);
  await stopping;
  expect(audio).toHaveBeenCalledOnce();
  expect(audio.mock.calls[0][0]).toMatchObject({ timestamp: 987654.25, rate: 48000 });
  expect(audio.mock.calls[0][0].samples).toEqual(new Float32Array([0.125]));
  expect(failure).not.toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
});

it('reports a forced native termination as a failed drain instead of a successful stop', async () => {
  vi.useFakeTimers();
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.exitCode = null;
  child.kill = vi.fn(() => queueMicrotask(() => child.emit('close', 1)));
  state.child = child;
  const capture = new WasapiCapture('unused', 'system', undefined, vi.fn(), vi.fn());
  const starting = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await starting;
  const failed = expect(capture.stop()).rejects.toThrow('末尾音频可能不完整');
  await vi.advanceTimersByTimeAsync(1500);
  await failed;
  expect(child.kill).toHaveBeenCalledOnce();
});

it('retains the startup deadline when forced cleanup also rejects', async () => {
  vi.useFakeTimers();
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.exitCode = null;
  child.kill = vi.fn(() => queueMicrotask(() => child.emit('close', 1)));
  state.child = child;
  const capture = new WasapiCapture('unused', 'system', undefined, vi.fn(), vi.fn());
  const failed = expect(capture.start()).rejects.toThrow('启动超时');
  await vi.advanceTimersByTimeAsync(9500);
  await failed;
  expect(child.kill).toHaveBeenCalledOnce();
});

it('rejects a native error during stop after waiting for the closed pipes', async () => {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.exitCode = null;
  state.child = child;
  const capture = new WasapiCapture('unused', 'system', undefined, vi.fn(), vi.fn());
  const starting = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await starting;
  const failed = expect(capture.stop()).rejects.toThrow('异常结束');
  child.exitCode = 1;
  child.emit('close', 1);
  await failed;
});
