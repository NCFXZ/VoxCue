import { describe, expect, it, vi } from 'vitest';
import { InterviewAccess } from '../../electron/speech/access';
const inventory = [
  { id: 'output', name: 'Output', source: 'system' as const, default: true },
  { id: 'input', name: 'Input', source: 'microphone' as const, default: true },
];
describe('Mac 原生音频开场检查', () => {
  it('明确禁用麦克风时只检查系统 tap；不以其他权限代替系统音频检查', async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    const access = new InterviewAccess({ devices: async () => inventory, probe });
    expect((await access.check({ sources: ['system'] })).ready).toBe(true);
    expect(probe.mock.calls).toEqual([['system', undefined]]);
  });
  it('所选设备失效时不改默认设备、不请求其他设备权限', async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    const result = await new InterviewAccess({ devices: async () => inventory, probe }).check({
      sources: ['system'],
      system: 'removed',
    });
    expect(result.ready).toBe(false);
    expect(result.checks[0].status).toBe('unavailable');
    expect(probe).not.toHaveBeenCalled();
  });
  it('系统权限拒绝与检查异常均禁止开场，麦克风权限提示按顺序执行', async () => {
    const calls: string[] = [];
    const access = new InterviewAccess({
      devices: async () => inventory,
      probe: async (source) => {
        calls.push(source);
        return { ok: false, code: source === 'system' ? 'permission-denied' : 'initialize-failed' };
      },
    });
    const result = await access.check({ sources: ['system', 'microphone'] });
    expect(result.ready).toBe(false);
    expect(result.checks.map((c) => c.status)).toEqual(['denied', 'error']);
    expect(calls).toEqual(['system', 'microphone']);
  });
  it('枚举失败不返回伪造成功；没有系统音频的配置直接拒绝', async () => {
    const access = new InterviewAccess({
      devices: async () => {
        throw Error('offline');
      },
      probe: async () => ({ ok: true }),
    });
    expect((await access.check({ sources: ['system'] })).ready).toBe(false);
    await expect(access.check({ sources: ['microphone'] })).rejects.toThrow('系统音频');
  });
});
