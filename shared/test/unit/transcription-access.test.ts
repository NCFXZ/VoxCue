import { expect, it, vi } from 'vitest';
import { checkTranscriptionAccess } from '../../electron/application/transcriptionAccess';
import type { AudioDevice, SpeechOptions } from '../../electron/contracts/speech';

function fixture(platform = 'win32', permission = 'granted') {
  return {
    platform,
    microphonePermission: vi.fn(() => permission),
    devices: vi.fn(async (): Promise<AudioDevice[]> => [
      { id: 'mic', name: 'Synthetic microphone', source: 'microphone', default: true },
      { id: 'system', name: 'Synthetic playback', source: 'system', default: true },
    ]),
    probe: vi.fn(
      async (_source: 'microphone', _device?: string): Promise<{ ok: boolean; code?: string }> => ({
        ok: true,
      }),
    ),
  };
}
const options: SpeechOptions = { sources: ['microphone'], microphone: 'mic' };

it.each(['win32', 'darwin'])(
  'checks only the selected microphone using existing native ports (%s)',
  async (platform) => {
    const ports = fixture(platform);
    const report = await checkTranscriptionAccess(options, ports);
    expect(report).toMatchObject({
      ready: true,
      checks: [{ source: 'microphone', status: 'granted' }],
    });
    expect(report.devices.map((device) => device.source)).toEqual(['microphone']);
    expect(ports.probe.mock.calls).toEqual([['microphone', 'mic']]);
    expect(options).toEqual({ sources: ['microphone'], microphone: 'mic' });
  },
);
it('allows the Mac native microphone probe to request undetermined permission without probing system audio', async () => {
  const ports = fixture('darwin', 'not-determined');
  expect((await checkTranscriptionAccess({ sources: ['microphone'] }, ports)).ready).toBe(true);
  expect(ports.probe.mock.calls).toEqual([['microphone', undefined]]);
});
it.each(['denied', 'restricted'])(
  'returns denied without starting a probe when microphone access is %s',
  async (permission) => {
    const ports = fixture('win32', permission);
    expect(await checkTranscriptionAccess(options, ports)).toMatchObject({
      ready: false,
      checks: [{ source: 'microphone', status: 'denied' }],
    });
    expect(ports.probe).not.toHaveBeenCalled();
  },
);
it('fails closed for unknown Windows permission, missing devices and device inventory failure', async () => {
  const unknown = fixture('win32', 'unknown');
  expect((await checkTranscriptionAccess(options, unknown)).checks[0].status).toBe('error');
  expect(unknown.probe).not.toHaveBeenCalled();
  const missing = fixture();
  expect(
    (await checkTranscriptionAccess({ ...options, microphone: 'system' }, missing)).checks[0]
      .status,
  ).toBe('unavailable');
  expect(missing.probe).not.toHaveBeenCalled();
  const failed = fixture();
  failed.devices.mockRejectedValueOnce(Error('Synthetic device failure'));
  expect((await checkTranscriptionAccess(options, failed)).checks[0].status).toBe('error');
  expect(failed.probe).not.toHaveBeenCalled();
});
it.each(['permission-denied', '0x80070005'])(
  'reports native microphone denial without testing another source (%s)',
  async (code) => {
    const ports = fixture();
    ports.probe.mockResolvedValueOnce({ ok: false, code });
    expect((await checkTranscriptionAccess(options, ports)).checks[0].status).toBe('denied');
    expect(ports.probe.mock.calls).toEqual([['microphone', 'mic']]);
  },
);
it('reports native initialization errors and exceptions explicitly', async () => {
  const ports = fixture();
  ports.probe.mockResolvedValueOnce({ ok: false });
  expect((await checkTranscriptionAccess(options, ports)).checks[0].status).toBe('error');
  ports.probe.mockRejectedValueOnce(Error('Synthetic probe failure'));
  expect((await checkTranscriptionAccess(options, ports)).checks[0].status).toBe('error');
});
it.each([[], ['system'], ['microphone', 'system']])(
  'rejects a non-microphone-only source set before touching native ports (%j)',
  async (sources) => {
    const ports = fixture();
    await expect(checkTranscriptionAccess({ sources } as SpeechOptions, ports)).rejects.toThrow(
      'Invalid audio sources',
    );
    expect(ports.devices).not.toHaveBeenCalled();
    expect(ports.microphonePermission).not.toHaveBeenCalled();
    expect(ports.probe).not.toHaveBeenCalled();
  },
);
