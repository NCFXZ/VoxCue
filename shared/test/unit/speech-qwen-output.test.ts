import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  spawn: vi.fn(),
  cores: vi.fn(() => 8),
  setPriority: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: runtime.spawn }));
vi.mock('node:os', async (original) => ({
  ...await original<typeof import('node:os')>(),
  availableParallelism: runtime.cores,
  setPriority: runtime.setPriority,
}));
import { QwenEngine } from '../../electron/backend/speech/qwen';
import * as endpoint from '../../electron/backend/speech/qwenLegacyEndpoint';

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
  runtime.spawn.mockReturnValue(child);
  return child;
}

it.each([undefined, 700, 800])('旧运行时（%s）缺少可验证的断句模型时释放候选进程', async silence => {
  const child = childProcess();
  const loading = QwenEngine.load('synthetic', 'cpu', vi.fn(), 'synthetic/runtime/voxcue-qwen', []);
  const rejected = expect(loading).rejects.toThrow('断句模型');
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    type: 'ready', vad_silence_ms: silence, chunk_ms: 1000, device: 'cpu', alignment_device: 'cpu',
  }) + '\n'));
  await rejected;
  expect(child.stdin.end).toHaveBeenCalledOnce();
});

it.each([undefined, 700, 800, 500])('按运行时阈值 %s 选择两路独立的兼容检测器或原生断句', async silence => {
  const child = childProcess();
  const model = vi.spyOn(endpoint, 'loadEndpointModel').mockResolvedValue('fixture.onnx');
  const detector = vi.spyOn(endpoint.QwenLegacyEndpoint, 'create').mockImplementation(() =>
    Object.create(endpoint.QwenLegacyEndpoint.prototype));
  try {
    const loading = QwenEngine.load('synthetic', 'cpu', vi.fn(), 'synthetic/runtime/voxcue-qwen', []);
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'ready', vad_silence_ms: silence, chunk_ms: 1000, device: 'cpu', alignment_device: 'cpu',
    }) + '\n'));
    const { engine } = await loading;
    await engine.close();
    expect(model).toHaveBeenCalledTimes(silence === 500 ? 0 : 1);
    expect(detector).toHaveBeenCalledTimes(silence === 500 ? 0 : 2);
  } finally {
    detector.mockRestore();
    model.mockRestore();
  }
});

it.each([[1, 1], [4, 2], [32, 4]])('budgets the native model pool on %i available CPUs', async (cores, threads) => {
  const child = childProcess();
  child.pid = 12345;
  runtime.cores.mockReturnValueOnce(cores);
  const loading = QwenEngine.load('synthetic', 'cpu', vi.fn(), 'synthetic/runtime/voxcue-qwen');
  const { constants } = await import('node:os');
  expect(runtime.setPriority).toHaveBeenLastCalledWith(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
  expect(runtime.spawn.mock.lastCall![2].env.RAYON_NUM_THREADS).toBe(String(threads));
  child.stdout.emit('data', Buffer.from('{"type":"ready","vad_silence_ms":500,"chunk_ms":1000,"device":"cpu","alignment_device":"cpu"}\n'));
  await (await loading).engine.close();
});

it.each([false, true])('bounds fragmented unterminated Qwen output before/after ready (%s)', async (ready) => {
  const child = childProcess();
  const loading = QwenEngine.load('synthetic', 'cpu', vi.fn(), 'synthetic/runtime/voxcue-qwen');
  const failed = ready ? undefined : expect(loading).rejects.toThrow('多语言语音识别启动失败');
  let engine: QwenEngine | undefined;
  if (ready) {
    child.stdout.emit('data', Buffer.from('{"type":"ready","vad_silence_ms":500,"chunk_ms":500,"device":"cpu","alignment_device":"cpu"}\n'));
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
  const rejected = expect(QwenEngine.load('synthetic', 'cpu', vi.fn(), 'synthetic/runtime/voxcue-qwen')).rejects.toThrow(
    '多语言语音识别需要支持 AVX2 和 FMA 的处理器，请改用轻量语音识别。',
  );
  child.stdout.emit('data', Buffer.from('{"type":"error","seq":null,"code":"unsupported-cpu","message":"discard native text"}\n'));
  await rejected;
  expect(child.kill).toHaveBeenCalledOnce();
});

it.each([undefined, null, 'metal', 'cuda', 'CPU', { device: 'cpu' }])(
  'rejects invalid CPU alignment metadata %j before exposing ready',
  async (alignment) => {
    const child = childProcess();
    const rejected = expect(QwenEngine.load('synthetic', 'cpu', vi.fn(), 'synthetic/runtime/voxcue-qwen')).rejects.toThrow('多语言语音识别启动失败');
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'ready', vad_silence_ms: 500, chunk_ms: 1000, device: 'cpu', alignment_device: alignment,
    }) + '\n'));
    await rejected;
    expect(child.kill).toHaveBeenCalledOnce();
  },
);

it.each(['cpu', 'cuda'])('accepts CUDA alignment metadata %s, including the supported CPU fallback', async (alignment) => {
  const child = childProcess();
  const loading = QwenEngine.load('synthetic', 'cuda', vi.fn(), 'synthetic/runtime/voxcue-qwen');
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    type: 'ready', vad_silence_ms: 500, chunk_ms: 500, device: 'cuda', alignment_device: alignment,
  }) + '\n'));
  const loaded = await loading;
  expect(loaded).toMatchObject({ chunkMs: 500, alignmentDevice: alignment });
  await loaded.engine.close();
});

it('retires the native stream on an unacknowledgeable invalid-command frame', async () => {
  const child = childProcess();
  const loading = QwenEngine.load('synthetic', 'cpu', vi.fn(), 'synthetic/runtime/voxcue-qwen');
  child.stdout.emit('data', Buffer.from('{"type":"ready","vad_silence_ms":500,"chunk_ms":1000,"device":"cpu","alignment_device":"cpu"}\n'));
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
  const loading = QwenEngine.load('synthetic', 'cpu', vi.fn(), 'synthetic/runtime/voxcue-qwen');
  child.stdout.emit('data', Buffer.from('{"type":"ready","vad_silence_ms":500,"chunk_ms":500,"device":"cpu","alignment_device":"cpu"}\n'));
  const { engine } = await loading;
  await expect(engine.feed('system', new Float32Array(160), 16000, 0)).rejects.toThrow();
  // Writable emits error separately from the failed write callback.
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(child.kill).toHaveBeenCalledOnce();
  expect((engine as any).pending.size).toBe(0);
  await engine.close();
});
