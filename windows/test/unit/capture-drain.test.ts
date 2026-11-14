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

function nativeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    exitCode: null as number | null, kill: vi.fn(),
  });
  state.child = child;
  return child;
}

it.each([
  ['0x88890004', true], ['0x88890010', true], ['0x88890026', true], ['0x80070490', true],
  ['0x80070005', false], ['0x88890008', false], ['0x80131509', false], ['0xDEADBEEF', false],
] as const)('classifies a drained WASAPI HRESULT %s, including a final line without LF', async (code, recoverable) => {
  const child = nativeProcess();
  const failure = vi.fn();
  const capture = new WasapiCapture('unused', 'system', undefined, vi.fn(), failure);
  const starting = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await starting;
  child.stdin.emit('error', Error('EPIPE'));
  child.exitCode = 1;
  child.emit('exit', 1);
  const status = Buffer.from(JSON.stringify({ type: 'error', code, message: 'private diagnostics' }));
  child.stderr.emit('data', status.subarray(0, 8));
  child.stderr.emit('data', status.subarray(8));
  expect(failure).not.toHaveBeenCalled();
  child.emit('close', 1);
  expect(failure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(code), recoverable);
  expect(failure.mock.calls[0][0]).not.toContain('private diagnostics');
  if (recoverable) await capture.stop();
  else await expect(capture.stop()).rejects.toThrow('异常结束');
});

it.each([['0x88890004'], '0x88890004\n', 'InvalidOperationException', {}, undefined].map(code => ({ code })))(
  'keeps a malformed native error terminal', async ({ code }) => {
    const child = nativeProcess();
    const failure = vi.fn();
    const capture = new WasapiCapture('unused', 'microphone', undefined, vi.fn(), failure);
    const starting = capture.start();
    child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
    await starting;
    child.stderr.emit('data', Buffer.from(JSON.stringify({ type: 'error', code }) + '\n'));
    child.emit('close', 1);
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('输出异常'), false);
  },
);

it('needs actual close before classifying an unexplained exit and ignores retired pipe data', async () => {
  vi.useFakeTimers();
  const child = nativeProcess();
  const failure = vi.fn(), audio = vi.fn();
  const capture = new WasapiCapture('unused', 'microphone', undefined, audio, failure);
  const starting = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await starting;
  child.exitCode = 1;
  child.emit('exit', 1);
  await vi.advanceTimersByTimeAsync(4999);
  expect(failure).not.toHaveBeenCalled();
  child.emit('close', 1);
  expect(failure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('进程退出'), true);
  await capture.stop();
  const next = nativeProcess();
  const restarted = capture.start();
  next.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await restarted;
  child.stderr.emit('data', Buffer.from('{"type":"error","code":"0x80070005"}\n'));
  child.stdout.emit('data', Buffer.alloc(7));
  child.emit('exit', 1);
  expect(failure).toHaveBeenCalledTimes(1);
  expect(audio).not.toHaveBeenCalled();
  const stopping = capture.stop();
  next.exitCode = 0;
  next.emit('close', 0);
  await stopping;
  expect(vi.getTimerCount()).toBe(0);
});

it('accepts stopped only after a requested stop and does not retry an unsolicited stopped message', async () => {
  const failure = vi.fn();
  const capture = new WasapiCapture('unused', 'system', undefined, vi.fn(), failure);
  const child = nativeProcess();
  const starting = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await starting;
  child.stderr.emit('data', Buffer.from('{"type":"stopped"}\n'));
  expect(failure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('输出异常'), false);
  expect(child.kill).toHaveBeenCalledOnce();
  await expect(capture.start()).rejects.toThrow('尚未退出');
  child.exitCode = 0;
  child.emit('close', 0);
  expect(failure).toHaveBeenCalledTimes(1);

  const next = nativeProcess();
  const restarted = capture.start();
  next.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await restarted;
  const stopping = capture.stop();
  next.stderr.emit('data', Buffer.from('{"type":"stopped"}\n'));
  next.exitCode = 0;
  next.emit('close', 0);
  await stopping;
  expect(next.kill).not.toHaveBeenCalled();
  expect(failure).toHaveBeenCalledTimes(1);
});

it('fails closed on inherited pipes held open past exit and never reclassifies a late close', async () => {
  vi.useFakeTimers();
  const child = nativeProcess();
  const failure = vi.fn();
  const capture = new WasapiCapture('unused', 'system', undefined, vi.fn(), failure);
  const starting = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await starting;
  child.exitCode = 1;
  child.emit('exit', 1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(failure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('尚未退出'), false);
  const stopping = capture.stop();
  const rejected = expect(stopping).rejects.toThrow('未能退出');
  await vi.advanceTimersByTimeAsync(2500);
  await rejected;
  await expect(capture.start()).rejects.toThrow('尚未退出');
  child.emit('close', 1);
  expect(failure).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

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

it('only returns bounded typed WASAPI devices and accepts an empty inventory', async () => {
  async function read(value: unknown) {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    state.child = child;
    const reading = devices('unused');
    child.stdout.end(JSON.stringify(value));
    child.stderr.end();
    child.emit('close', 0);
    return reading;
  }
  const device = { id: 'synthetic', name: 'Synthetic input', source: 'microphone', default: false };
  expect(await read([])).toEqual([]);
  expect(await read([{ ...device, extra: true }])).toEqual([device]);
  for (const bad of [
    {}, [null], Array(257).fill(device), [{ ...device, id: '' }], [{ ...device, id: 7 }],
    [{ ...device, id: 'a'.repeat(513) }], [{ ...device, name: null }],
    [{ ...device, name: 'x'.repeat(2001) }], [{ ...device, source: 'network' }],
    [{ ...device, default: 1 }],
  ]) await expect(read(bad)).rejects.toThrow('无法枚举 Windows 音频设备');
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
  if (started) expect(failure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('输出异常'), false);
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

it.each([
  { reason: 'normal stop', length: 2 }, { reason: 'normal stop', length: 24 },
  { reason: 'process loss', length: 24 }, { reason: 'device invalidated', length: 24 },
])('accounts for a $length-byte partial PCM packet at $reason', async ({ reason, length }) => {
  const child = nativeProcess();
  const audio = vi.fn(), failure = vi.fn();
  const capture = new WasapiCapture('unused', 'system', undefined, audio, failure);
  const starting = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await starting;
  const stopping = reason === 'normal stop' ? capture.stop() : undefined;
  const packet = Buffer.alloc(25);
  packet.writeUInt32LE(21);
  packet[4] = 1;
  packet.writeUInt32LE(48000, 5);
  child.stdout.emit('data', Buffer.concat([packet, packet.subarray(0, length)]));
  if (reason === 'device invalidated')
    child.stderr.emit('data', Buffer.from('{"type":"error","code":"0x88890004"}\n'));
  child.exitCode = stopping ? 0 : 1;
  child.emit('exit', child.exitCode);
  child.emit('close', child.exitCode);
  expect(audio).toHaveBeenCalledOnce();
  if (stopping) {
    await expect(stopping).rejects.toThrow('末尾音频可能不完整');
    expect(failure).not.toHaveBeenCalled();
  } else {
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.any(String), true);
    await capture.stop();
  }
});

it('keeps ownership after a stop deadline and an exit until the native pipes close', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    exitCode: null as number | null, kill: vi.fn(() => true),
  });
  state.child = child;
  const capture = new WasapiCapture('unused', 'system', undefined, vi.fn(), vi.fn());
  const starting = capture.start();
  child.stderr.emit('data', Buffer.from('{"type":"started"}\n'));
  await starting;
  const stopping = capture.stop();
  expect(capture.stop()).toBe(stopping);
  const deadline = expect(stopping).rejects.toThrow('未能退出');
  await vi.advanceTimersByTimeAsync(2500);
  await deadline;
  child.exitCode = 1;
  child.emit('exit', 1);
  expect(capture.retiring).toBe(true);
  await expect(capture.start()).rejects.toThrow('尚未退出');
  child.emit('close', 1);
  expect(capture.retiring).toBe(false);
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
