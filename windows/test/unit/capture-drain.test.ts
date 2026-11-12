import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ child: undefined as any }));
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: () => state.child,
}));
import { WasapiCapture, devices } from '../../electron/speech/capture';
afterEach(() => vi.useRealTimers());

it('设备枚举排空诊断并等待 exit 后的 UTF-8 尾部，保留跨块设备名', async () => {
  const child: any = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  state.child = child;
  const inventory = [{ id: 'synthetic', name: '声音设备', source: 'system', default: true }];
  const bytes = Buffer.from(JSON.stringify(inventory));
  const split = bytes.indexOf(Buffer.from('声')) + 1;
  let settled = false;
  const reading = devices('unused').then((value) => { settled = true; return value; });
  const diagnostics = new Promise<void>((resolve, reject) =>
    child.stderr.write(Buffer.alloc(256 * 1024, 65), (error?: Error | null) =>
      error ? reject(error) : resolve()),
  );
  child.stdout.write(bytes.subarray(0, split));
  child.emit('exit', 0);
  await Promise.resolve();
  expect(settled).toBe(false);
  child.stdout.end(bytes.subarray(split));
  await diagnostics;
  child.stderr.end();
  child.emit('close', 0);
  expect(await reading).toEqual(inventory);
  expect(child.stderr.readableLength).toBe(0);
  expect(child.kill).not.toHaveBeenCalled();
});

it('设备枚举超出输出上限后及时失败并清除启动期限', async () => {
  vi.useFakeTimers();
  const child: any = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  state.child = child;
  const rejected = expect(devices('unused')).rejects.toThrow('Invalid device inventory');
  child.stdout.write(Buffer.alloc(100001, 65));
  await rejected;
  child.stdout.write(Buffer.alloc(100001, 65));
  child.emit('close', 0);
  expect(child.kill).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  child.stdout.destroy();
  child.stderr.destroy();
});

it.each([false, true])('bounds unterminated native status output before/after startup (%s)', async (started) => {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  child.exitCode = null;
  child.kill = vi.fn(() => {
    child.exitCode = 1;
    child.emit('exit', 1);
    child.emit('close', 1);
  });
  state.child = child;
  const failure = vi.fn();
  const capture = new WasapiCapture('unused', 'system', undefined, vi.fn(), failure);
  const starting = capture.start();
  const rejected = started ? undefined : expect(starting).rejects.toThrow('输出异常');
  if (started) {
    child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
    await starting;
  }
  child.stderr.emit('data', Buffer.alloc(16384, 65));
  expect(child.kill).not.toHaveBeenCalled();
  child.stderr.emit('data', Buffer.from('x'));
  child.stderr.emit('data', Buffer.alloc(65536, 65));
  if (rejected) await rejected;
  expect(child.kill).toHaveBeenCalledOnce();
  if (started) expect(failure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('输出异常'));
  else expect(failure).not.toHaveBeenCalled();
});

it('waits for stdout close after exit and retains the final packet before retiring capture', async () => {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
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
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
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
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
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
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
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

it('a broken stop pipe retires capture and reports failure without an unhandled stream error', async () => {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new Writable({
    write(_bytes, _encoding, callback) { callback(); },
    final(callback) { callback(Error('synthetic EPIPE')); },
  });
  child.exitCode = null;
  child.kill = vi.fn(() => {
    child.exitCode = 1;
    child.emit('exit', 1);
    child.emit('close', 1);
  });
  state.child = child;
  const failure = vi.fn();
  const capture = new WasapiCapture('unused', 'system', undefined, vi.fn(), failure);
  const starting = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await starting;
  await expect(capture.stop()).rejects.toThrow('异常结束');
  expect(child.kill).toHaveBeenCalledOnce();
  expect(failure).not.toHaveBeenCalled();
});
