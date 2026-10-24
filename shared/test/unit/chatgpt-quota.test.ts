import { describe, it, expect, vi } from 'vitest';
import { chatGPTAccountUsage } from '../../electron/backend/chat/quota';
import { ChatGPTAccountUsage } from '../../electron/backend/chat/accountUsage';
import type { CodexUsagePort } from '../../electron/backend/chat/codexUsage';
const window = (minutes: number, usedPercent = 25) => ({
  windowDurationMins: minutes,
  usedPercent,
  resetsAt: 1793491200,
});
describe('ChatGPT 账户窗口', () => {
  it('两个窗口按官方时长显示；周在primary也不误标五小时', () => {
    const result = chatGPTAccountUsage({
      rateLimits: { primary: window(300), secondary: window(10080, 40), planType: 'plus' },
    });
    expect(result.plan).toBe('plus');
    expect(result.quotas.map((q) => [q.label, q.remainingPercent, q.resetAt])).toEqual([
      ['5小时额度', 75, 1793491200000],
      ['每周额度', 60, 1793491200000],
    ]);
    const weekly = chatGPTAccountUsage({
      rateLimits: { primary: window(10080), secondary: null, planType: 'pro' },
    });
    expect(weekly.quotas.map((q) => q.label)).toEqual(['每周额度']);
    expect(weekly.quotas[0]).toMatchObject({
      unit: 'percent',
      total: null,
      used: 25,
      remaining: null,
    });
  });
  it('新版多bucket优先，缺失/无效窗口不补0，其他时长不硬编码', () => {
    const result = chatGPTAccountUsage({
      rateLimits: { primary: window(300) },
      rateLimitsByLimitId: {
        codex: { secondary: window(10080, 100) },
        other: { primary: window(60, 12), limitName: 'Model B' },
        bad: {
          primary: { ...window(300), usedPercent: null },
          secondary: { ...window(10080), windowDurationMins: null },
        },
      },
    });
    expect(result.quotas.map((q) => q.label)).toEqual(['每周额度', 'Model B · 1小时额度']);
    expect(result.quotas[0]).toMatchObject({ remainingPercent: 0, state: 'exhausted' });
    expect(
      chatGPTAccountUsage({ rateLimitsByLimitId: {}, rateLimits: { primary: window(300) } }).status,
    ).toBe('unavailable');
    for (const source of [
      null,
      {},
      { rateLimits: { primary: null, secondary: null } },
      { rateLimits: { primary: window(300, -1) } },
    ])
      expect(chatGPTAccountUsage(source).quotas).toEqual([]);
  });
});
function fixture() {
  let identity = {
    account: 'subject:workspace',
    email: 'synthetic@example.test',
    chatgptAccountId: 'workspace',
  };
  const runtime: CodexUsagePort = {
    account: vi.fn(async () => ({ email: 'synthetic@example.test', planType: 'pro' })),
    access: vi.fn(),
    limits: vi.fn(async () => ({
      accountId: 'workspace',
      rateLimits: { secondary: window(10080) },
    })),
    login: vi.fn(),
    cancel: vi.fn(),
    logout: vi.fn(),
    stop: vi.fn(),
  };
  return {
    runtime,
    setIdentity: (value: Partial<typeof identity>) => {
      identity = { ...identity, ...value };
    },
    service: new ChatGPTAccountUsage({ runtime, identity: async () => ({ ...identity }) }),
  };
}
describe('同一登录直接读取额度', () => {
  it('无需第二次授权，读取当前账户实际窗口', async () => {
    const { service, runtime } = fixture();
    expect((await service.read()).quotas.map((q) => q.label)).toEqual(['每周额度']);
    expect(runtime.login).not.toHaveBeenCalled();
    expect((await service.read()).plan).toBe('pro');
  });
  it('同邮箱的不同工作区、账户切换与迟到结果均拒绝，原始错误不公开', async () => {
    const f = fixture();
    vi.mocked(f.runtime.limits).mockResolvedValueOnce({
      accountId: 'other-workspace',
      rateLimits: { primary: window(300) },
    });
    await expect(f.service.read()).rejects.toThrow('账户额度暂不可用');
    vi.mocked(f.runtime.limits).mockImplementationOnce(async () => {
      f.setIdentity({ account: 'new' });
      return { rateLimits: { primary: window(300) } };
    });
    await expect(f.service.read()).rejects.toThrow('账户额度暂不可用');
    vi.mocked(f.runtime.limits).mockRejectedValueOnce(Error('private credential'));
    await expect(f.service.read()).rejects.toThrow(
      'ChatGPT 账户额度暂不可用，请刷新或查看官方用量。',
    );
  });
});

describe('官方套餐字段兼容', () => {
  it('识别官方Pro变体及Plus，不从窗口或陌生套餐名推测', () => {
    for (const planType of ['pro', 'prolite', 'promax', 'plus']) {
      const usage = chatGPTAccountUsage({ rateLimits: { planType, secondary: window(10080) } });
      expect(usage.plan).toBe(planType === 'plus' ? 'plus' : 'pro');
    }
    for (const planType of [undefined, null, 'unknown', 'pro_future', 'Plus']) {
      expect(
        chatGPTAccountUsage({
          rateLimits: { planType, primary: window(300), secondary: window(10080) },
        }).plan,
      ).toBe('unknown');
    }
  });
  it('多桶额度仍可读取旧格式套餐元数据，但不重复旧窗口', () => {
    const usage = chatGPTAccountUsage({
      rateLimits: { planType: 'plus', primary: window(300) },
      rateLimitsByLimitId: { codex: { secondary: window(10080) } },
    });
    expect(usage.plan).toBe('plus');
    expect(usage.quotas.map((quota) => quota.label)).toEqual(['每周额度']);
  });
  it('额度无套餐时使用当前账户的官方套餐；未知则仍保持未知', async () => {
    for (const planType of ['prolite', 'promax', 'plus', 'unknown']) {
      const { service, runtime } = fixture();
      vi.mocked(runtime.account).mockResolvedValue({ email: 'synthetic@example.test', planType });
      expect((await service.read()).plan).toBe(
        planType === 'prolite' || planType === 'promax' ? 'pro' : planType,
      );
    }
  });
});
