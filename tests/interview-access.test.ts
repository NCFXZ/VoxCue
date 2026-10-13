import { expect, it, vi } from 'vitest';
import { InterviewAccess } from '../electron/backend/speech/access';
const inventory = [
  { id: 'speaker', source: 'system' as const, name: 'Speaker', default: true },
  { id: 'mic', source: 'microphone' as const, name: 'Mic', default: true },
];
const options = { sources: ['system', 'microphone'] as ('system' | 'microphone')[] };
function setup(permission = 'granted') {
  const dependencies = {
    platform: 'win32',
    microphonePermission: vi.fn(() => permission),
    devices: vi.fn(async () => inventory),
    probe: vi.fn(
      async (_source: string, _device?: string): Promise<{ ok: boolean; code?: string }> => ({
        ok: true,
      }),
    ),
  };
  return { dependencies, access: new InterviewAccess(dependencies) };
}
it('所需权限和指定设备全部通过才可开始；检查只调用无采样探测端口', async () => {
  const { access, dependencies } = setup();
  const result = await access.check({ ...options, microphone: 'mic', system: 'speaker' });
  expect(result.ready).toBe(true);
  expect(result.checks.map((c) => c.status)).toEqual(['granted', 'granted']);
  expect(dependencies.probe.mock.calls).toEqual([
    ['system', 'speaker'],
    ['microphone', 'mic'],
  ]);
});
it.each(['denied', 'restricted', 'unknown', 'not-determined'])(
  '权限 %s 不允许开始，也不探测麦克风',
  async (permission) => {
    const { access, dependencies } = setup(permission);
    const result = await access.check(options);
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.source === 'microphone')?.status).not.toBe('granted');
    expect(dependencies.probe.mock.calls).toEqual([['system', undefined]]);
  },
);
it('明确禁用麦克风时不要求麦克风权限，但仍检查系统音频', async () => {
  const { access, dependencies } = setup('denied');
  expect((await access.check({ sources: ['system'] })).ready).toBe(true);
  expect(dependencies.microphonePermission).not.toHaveBeenCalled();
  expect(dependencies.probe.mock.calls).toEqual([['system', undefined]]);
});
it('指定失效设备不能降级为默认设备或静默禁用', async () => {
  const { access, dependencies } = setup();
  const result = await access.check({ ...options, microphone: 'disconnected' });
  expect(result.ready).toBe(false);
  expect(result.checks.find((c) => c.source === 'microphone')?.status).toBe('unavailable');
  expect(dependencies.probe.mock.calls).toEqual([['system', undefined]]);
});
it('没有默认播放设备时阻止开始，不替换为另一个活动设备', async () => {
  const { access, dependencies } = setup();
  dependencies.devices.mockResolvedValue(
    inventory.map((device) => ({ ...device, default: false })),
  );
  expect((await access.check({ sources: ['system'] })).ready).toBe(false);
  expect(dependencies.probe).not.toHaveBeenCalled();
});
it('WASAPI 拒绝访问及设备初始化错误都会阻止开始', async () => {
  const { access, dependencies } = setup();
  dependencies.probe.mockResolvedValueOnce({ ok: false, code: '0x80070005' });
  expect((await access.check({ sources: ['system'] })).checks[0].status).toBe('denied');
  dependencies.probe.mockResolvedValueOnce({ ok: false, code: '0x88890004' });
  expect((await access.check({ sources: ['system'] })).ready).toBe(false);
  dependencies.probe.mockRejectedValueOnce(new Error('fixture'));
  expect((await access.check({ sources: ['system'] })).ready).toBe(false);
});
it('设备读取失败、权限读取抛错与非 Windows 平台不能通过', async () => {
  const { access, dependencies } = setup();
  dependencies.devices.mockRejectedValueOnce(Error('fixture'));
  expect((await access.check(options)).ready).toBe(false);
  dependencies.microphonePermission.mockImplementation(() => {
    throw Error('fixture');
  });
  expect((await access.check(options)).ready).toBe(false);
  dependencies.platform = 'darwin';
  dependencies.devices.mockClear();
  expect((await access.check(options)).ready).toBe(false);
  expect(dependencies.devices).not.toHaveBeenCalled();
});
it('校验音频来源，不能省略系统音频或传任意设备操作', async () => {
  const { access } = setup();
  await expect(access.check({ sources: ['microphone'] })).rejects.toThrow('系统音频');
  await expect(access.check({ sources: ['other'] } as any)).rejects.toThrow();
});
