import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ child: undefined as any }));
vi.mock('node:child_process', () => ({ spawn: () => runtime.child }));
import { QwenEngine } from '../../electron/backend/speech/qwen';

function childProcess() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = { resume: vi.fn() };
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn(() => child.emit('exit', 0)) });
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    child.exitCode = 1;
    child.emit('exit', 1);
    return true;
  });
  runtime.child = child;
  return child;
}

it.each([false, true])('bounds fragmented unterminated Qwen output before/after ready (%s)', async (ready) => {
  const child = childProcess();
  const loading = QwenEngine.load('synthetic', 'cpu', vi.fn());
  const failed = ready ? undefined : expect(loading).rejects.toThrow('Qwen 启动失败');
  let engine: QwenEngine | undefined;
  if (ready) {
    child.stdout.emit('data', Buffer.from('{"type":"ready","chunk_ms":500,"device":"cpu","alignment_device":"cpu"}\n'));
    engine = (await loading).engine;
  }
  child.stdout.emit('data', Buffer.alloc(800000, 65));
  expect(child.kill).not.toHaveBeenCalled();
  child.stdout.emit('data', Buffer.from('x'));
  child.stdout.emit('data', Buffer.alloc(100000, 65));
  if (failed) await failed;
  expect(child.kill).toHaveBeenCalledOnce();
  await engine?.close();
});

it('reports an unsupported CPU capability frame before model readiness', async () => {
  const child = childProcess();
  const rejected = expect(QwenEngine.load('synthetic', 'cpu', vi.fn())).rejects.toThrow(
    'Qwen 需要支持 AVX2 和 FMA 的处理器，请改用 Paraformer。',
  );
  child.stdout.emit('data', Buffer.from('{"type":"error","seq":null,"code":"unsupported-cpu","message":"discard native text"}\n'));
  await rejected;
  expect(child.kill).toHaveBeenCalledOnce();
});

it.each([undefined, null, 'metal', 'cuda', 'CPU', { device: 'cpu' }])(
  'rejects invalid CPU alignment metadata %j before exposing ready',
  async (alignment) => {
    const child = childProcess();
    const rejected = expect(QwenEngine.load('synthetic', 'cpu', vi.fn())).rejects.toThrow('Qwen 启动失败');
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'ready', chunk_ms: 1000, device: 'cpu', alignment_device: alignment,
    }) + '\n'));
    await rejected;
    expect(child.kill).toHaveBeenCalledOnce();
  },
);

it.each(['cpu', 'cuda'])('accepts CUDA alignment metadata %s, including the supported CPU fallback', async (alignment) => {
  const child = childProcess();
  const loading = QwenEngine.load('synthetic', 'cuda', vi.fn());
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    type: 'ready', chunk_ms: 500, device: 'cuda', alignment_device: alignment,
  }) + '\n'));
  const loaded = await loading;
  expect(loaded).toMatchObject({ chunkMs: 500, alignmentDevice: alignment });
  await loaded.engine.close();
});

it('retires the native stream on an unacknowledgeable invalid-command frame', async () => {
  const child = childProcess();
  const loading = QwenEngine.load('synthetic', 'cpu', vi.fn());
  child.stdout.emit('data', Buffer.from('{"type":"ready","chunk_ms":1000,"device":"cpu","alignment_device":"cpu"}\n'));
  const { engine } = await loading;
  child.stdout.emit('data', Buffer.from('{"type":"error","seq":null,"code":"invalid-command","message":"Invalid native command frame"}\n'));
  expect(child.kill).toHaveBeenCalledOnce();
  await engine.close();
});

it('a broken native input pipe rejects work and retires the process without an unhandled stream error', async () => {
  const child = childProcess();
  child.stdin = new Writable({
    write(_bytes, _encoding, callback) { callback(Error('synthetic EPIPE')); },
  });
  const loading = QwenEngine.load('synthetic', 'cpu', vi.fn());
  child.stdout.emit('data', Buffer.from('{"type":"ready","chunk_ms":500,"device":"cpu","alignment_device":"cpu"}\n'));
  const { engine } = await loading;
  await expect(engine.feed('system', new Float32Array(160), 16000, 0)).rejects.toThrow();
  // Writable emits error separately from the failed write callback.
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(child.kill).toHaveBeenCalledOnce();
  expect((engine as any).pending.size).toBe(0);
  await engine.close();
});
