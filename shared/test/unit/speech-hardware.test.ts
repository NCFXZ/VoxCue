import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    let finish: (error: Error | null, stdout: string) => void;
    native.execFile.mockImplementation((_file, _args, _options, done) => {
      finish = done;
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
    finish!(null, '{"cuda":true,"private":"discard"}');
    await expect(first).resolves.toEqual({ cuda: true });
    const refresh = probe.read();
    expect(native.execFile).toHaveBeenCalledTimes(2);
    finish!(null, '{"cuda":false,"reason":"driver-unavailable"}');
    await expect(refresh).resolves.toEqual({ cuda: false, reason: 'driver-unavailable' });
  });
  it.each(['unsupported-gpu', 'driver-unavailable', 'driver-outdated'] as const)(
    'rejects only CUDA when %s, and keeps Qwen CPU and Paraformer available',
    async (reason) => {
      native.execFile.mockImplementation((_file, _args, _options, done) =>
        done(null, JSON.stringify({ cuda: false, reason })),
      );
      const probe = new SpeechHardwareProbe('C:/app/VoxCue.Audio.exe', 'win32');
      await probe.require({ sources: ['system'], speechModel: 'qwen', inferenceDevice: 'cpu' });
      await probe.require({
        sources: ['system'],
        speechModel: 'paraformer',
        inferenceDevice: 'cuda',
      });
      expect(native.execFile).not.toHaveBeenCalled();
      await expect(
        probe.require({ sources: ['system'], speechModel: 'qwen', inferenceDevice: 'cuda' }),
      ).rejects.toThrow(/CPU/);
      await expect(probe.read()).resolves.toEqual({ cuda: false, reason });
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
    });
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
