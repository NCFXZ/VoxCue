import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
const native = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: native.execFile }));
import { SpeechHardwareProbe } from '../../electron/backend/speech/hardware';
import type { SpeechHardware } from '../../electron/contracts/speech';

beforeEach(() => vi.resetAllMocks());
describe('CUDA availability and independent CPU inference', () => {
  it('probes the owned Mac Metal runtime and rejects cross-platform devices', async () => {
    native.execFile.mockImplementation((_file, _args, _options, done) =>
      done(null, '{"metal":true}'),
    );
    const mac = new SpeechHardwareProbe('audio', 'darwin', '/app/native/qwen/voxcue-qwen');
    await expect(mac.read()).resolves.toEqual({ cuda: false, metal: true });
    expect(native.execFile.mock.calls[0].slice(0, 2)).toEqual([
      '/app/native/qwen/voxcue-qwen',
      ['metal-check'],
    ]);
    await expect(
      mac.require({ sources: ['system'], speechModel: 'qwen', inferenceDevice: 'metal' }),
    ).resolves.toBeUndefined();
    await expect(
      mac.require({ sources: ['system'], speechModel: 'qwen', inferenceDevice: 'cuda' }),
    ).rejects.toThrow(/CPU/);
    await expect(
      new SpeechHardwareProbe('audio', 'win32').require({
        sources: ['system'],
        speechModel: 'qwen',
        inferenceDevice: 'metal',
      }),
    ).rejects.toThrow(/Metal/);
  });
  it('fails closed when the Metal runtime errors or returns malformed data', async () => {
    native.execFile.mockImplementation((_file, _args, _options, done) =>
      done(Error('timeout'), '{"metal":true}'),
    );
    const probe = new SpeechHardwareProbe('audio', 'darwin', '/app/native/qwen/voxcue-qwen');
    await expect(probe.read()).resolves.toEqual({
      cuda: false,
      metal: false,
      reason: 'unavailable',
    });
    await expect(
      probe.require({ sources: ['system'], speechModel: 'qwen', inferenceDevice: 'metal' }),
    ).rejects.toThrow(/CPU/);
  });
  it('queries only the owned helper and merges concurrent requests', async () => {
    const finish = new Map<string, (error: Error | null, stdout: string) => void>();
    native.execFile.mockImplementation((file, _args, _options, done) => {
      finish.set(file, done);
    });
    const probe = new SpeechHardwareProbe('C:/app/VoxCue.Audio.exe', 'win32');
    const first = probe.read();
    expect(probe.read()).toBe(first);
    expect(native.execFile).toHaveBeenCalledWith(
      'C:/app/VoxCue.Audio.exe',
      ['cuda-check'],
      { windowsHide: true, timeout: 5000, maxBuffer: 4096 },
      expect.any(Function),
    );
    const cpuHelper = path.join('C:/app', 'VoxCue.Cpu.exe');
    expect(native.execFile).toHaveBeenCalledWith(
      cpuHelper, [], { windowsHide: true, timeout: 5000, maxBuffer: 4096 }, expect.any(Function),
    );
    finish.get('C:/app/VoxCue.Audio.exe')!(null, '{"cuda":true,"private":"discard"}');
    finish.get(cpuHelper)!(null, '{"qwenCpu":true,"private":"discard"}');
    await expect(first).resolves.toEqual({ cuda: true, qwenCpu: true });
    const refresh = probe.read();
    expect(native.execFile).toHaveBeenCalledTimes(4);
    finish.get('C:/app/VoxCue.Audio.exe')!(null, '{"cuda":false,"reason":"driver-unavailable"}');
    finish.get(cpuHelper)!(null, '{"qwenCpu":true}');
    await expect(refresh).resolves.toEqual({ cuda: false, reason: 'driver-unavailable', qwenCpu: true });
  });
  it.each(['unsupported-gpu', 'driver-unavailable', 'driver-outdated'] as const)(
    'rejects only CUDA when %s, and keeps Qwen CPU and Paraformer available',
    async (reason) => {
      native.execFile.mockImplementation((file, _args, _options, done) =>
        done(null, JSON.stringify(file.endsWith('VoxCue.Cpu.exe') ? { qwenCpu: true } : { cuda: false, reason })),
      );
      const probe = new SpeechHardwareProbe('C:/app/VoxCue.Audio.exe', 'win32');
      await probe.require({ sources: ['system'], speechModel: 'qwen', inferenceDevice: 'cpu' });
      await probe.require({
        sources: ['system'],
        speechModel: 'paraformer',
        inferenceDevice: 'cuda',
      });
      expect(native.execFile).toHaveBeenCalledTimes(1);
      expect(native.execFile.mock.calls[0][0]).toBe(path.join('C:/app', 'VoxCue.Cpu.exe'));
      await expect(
        probe.require({ sources: ['system'], speechModel: 'qwen', inferenceDevice: 'cuda' }),
      ).rejects.toThrow(/CPU/);
      await expect(probe.read()).resolves.toEqual({ cuda: false, reason, qwenCpu: true });
    },
  );
  it.each([
    [null, ''],
    [null, '{"cuda":"true"}'],
    [null, '{"cuda":false,"reason":"unknown"}'],
    [Error('timeout'), '{"cuda":true}'],
  ])('fails closed for missing, malformed or timed-out probes', async (error, stdout) => {
    native.execFile.mockImplementation((_file, _args, _options, done) => done(error, stdout));
    await expect(new SpeechHardwareProbe('helper.exe', 'win32').read()).resolves.toEqual({
      cuda: false,
      reason: 'unavailable',
      qwenCpu: false,
      qwenCpuReason: 'unavailable',
    });
  });
  it.each(['cpu', 'cuda'] as const)(
    'rejects Qwen %s before loading models when either required CPU instruction is absent',
    async (inferenceDevice) => {
      native.execFile.mockImplementation((file, _args, _options, done) =>
        done(null, JSON.stringify(file.endsWith('VoxCue.Cpu.exe') ? { qwenCpu: false } : { cuda: true })),
      );
      const probe = new SpeechHardwareProbe('C:/app/VoxCue.Audio.exe', 'win32');
      await expect(probe.require({ sources: ['system'], speechModel: 'qwen', inferenceDevice }))
        .rejects.toThrow('AVX2 和 FMA');
      const calls = native.execFile.mock.calls.length;
      await probe.require({ sources: ['system'], speechModel: 'paraformer', inferenceDevice: 'cpu' });
      expect(native.execFile).toHaveBeenCalledTimes(calls);
    },
  );
  it('fails closed on a missing CPU helper without consulting the CUDA driver for CPU selection', async () => {
    native.execFile.mockImplementation((_file, _args, _options, done) => done(Error('missing'), ''));
    await expect(new SpeechHardwareProbe('C:/app/VoxCue.Audio.exe', 'win32').require({
      sources: ['system'], speechModel: 'qwen', inferenceDevice: 'cpu',
    })).rejects.toThrow('无法确认 Qwen 所需的处理器指令集');
    expect(native.execFile).toHaveBeenCalledExactlyOnceWith(
      path.join('C:/app', 'VoxCue.Cpu.exe'), [],
      { windowsHide: true, timeout: 5000, maxBuffer: 4096 }, expect.any(Function),
    );
  });
  it('does not run a Windows driver probe on other platforms or without the helper', async () => {
    await expect(new SpeechHardwareProbe('helper', 'darwin').read()).resolves.toEqual({
      cuda: false,
      reason: 'platform',
    } satisfies SpeechHardware);
    await expect(new SpeechHardwareProbe(undefined, 'win32').read()).resolves.toEqual({
      cuda: false,
      reason: 'unavailable',
    });
    expect(native.execFile).not.toHaveBeenCalled();
  });
});
