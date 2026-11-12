import { beforeEach, expect, it, vi } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { probeDevice } from '../../electron/speech/capture';
import { InterviewAccess } from '../../electron/speech/access';
import { translateUI } from '../../../shared/electron/contracts/uiLanguage';

vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it('accepts the sample-free native preflight without treating its zero counter as denied audio', async () => {
  vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
    callback(null, JSON.stringify({ ok: true, samplesRead: 0 }), '');
  }) as typeof execFile);
  await expect(probeDevice('/synthetic/VoxCue.Audio', 'system', 'virtual-output')).resolves.toEqual(
    {
      ok: true,
    },
  );
  expect(execFile).toHaveBeenCalledWith(
    '/synthetic/VoxCue.Audio',
    ['check', 'system', Buffer.from('virtual-output').toString('base64')],
    { timeout: 100000, maxBuffer: 10000 },
    expect.any(Function),
  );
  expect(spawn).not.toHaveBeenCalled();
});

it('requires a new explicit check after denial and does not infer a permission change from silence', async () => {
  let permitted = false;
  vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
    if (permitted) callback(null, JSON.stringify({ ok: true, samplesRead: 0 }), '');
    else
      callback(
        Object.assign(new Error('denied'), { code: 1 }),
        '',
        JSON.stringify({
          type: 'error',
          code: 'permission-denied',
        }),
      );
  }) as typeof execFile);
  const access = new InterviewAccess({
    devices: async () => [
      { id: 'virtual-output', name: 'Synthetic output', source: 'system', default: true },
    ],
    probe: (source, device) => probeDevice('/synthetic/VoxCue.Audio', source, device),
  });
  const denied = await access.check({ sources: ['system'] });
  expect(denied.ready).toBe(false);
  expect(denied.checks[0].status).toBe('denied');
  expect(execFile).toHaveBeenCalledTimes(1);
  permitted = true;
  expect(denied.checks[0].status).toBe('denied');
  expect((await access.check({ sources: ['system'] })).ready).toBe(true);
  expect(execFile).toHaveBeenCalledTimes(2);
  expect(spawn).not.toHaveBeenCalled();
});

it('reports unsupported preferred routing as an actionable localized device error, not permission denial', async () => {
  const access = new InterviewAccess({
    devices: async () => [
      { id: 'virtual-output', name: 'Synthetic output', source: 'system', default: true },
    ],
    probe: async () => ({ ok: false, code: 'unsupported-audio-format-or-layout' }),
  });
  const report = await access.check({ sources: ['system'] });
  expect(report.ready).toBe(false);
  expect(report.checks[0].status).toBe('error');
  expect(report.checks[0].message).toContain('首选声道布局暂不受支持');
  expect(translateUI(report.checks[0].message, 'en')).toContain(
    'preferred channel layout is not supported',
  );
  expect(spawn).not.toHaveBeenCalled();
});
