import { describe, expect, it, vi } from 'vitest';
import { copilotAccountUsage } from '../../electron/backend/copilot/quota';
import { CopilotChatService } from '../../electron/backend/copilot/service';
import { SelectedChatService } from '../../electron/application/providers';

const observation = (changes = {}) => ({
  provider: { kind: 'copilot', id: 'private-account-id', label: 'Private account' },
  observationKind: 'account_snapshot',
  acquisitionStatus: 'succeeded',
  quotaId: 'ai_credits',
  unit: 'ai_credits',
  quantityKind: 'authoritative_budget',
  accessState: 'allowed',
  capacityState: 'available',
  budgetMetadata: {
    entitlement: 100,
    consumed: 25.5,
    remainingPercentage: 74.5,
    unlimited: false,
    resetAtEpochMs: Date.parse('2026-11-01T00:00:00Z'),
    usageAllowedWhenExhausted: false,
    overageAllowedWhenExhausted: false,
  },
  ...changes,
});
const read = (item = observation()) =>
  copilotAccountUsage({ planTier: 'free', providerQuotas: [item] });
describe('官方账户额度边界', () => {
  it('保留官方额度单位、小数和重置时间，只公开受限字段', () => {
    const usage = read();
    expect(usage.plan).toBe('free');
    expect(usage.quotas[0]).toMatchObject({
      total: 100,
      used: 25.5,
      remaining: 74.5,
      remainingPercent: 74.5,
      unit: 'ai_credits',
      resetAt: Date.parse('2026-11-01T00:00:00Z'),
    });
    expect(JSON.stringify(usage)).not.toMatch(/private-account-id|Private account|budgetMetadata/);
  });
  it('失败或缺失读取不能沿用旧数字、伪造0或宣布额度耗尽', () => {
    const quota = read(
      observation({
        acquisitionStatus: 'failed',
        capacityState: 'exhausted',
        acquisitionError: 'credential=secret',
      }),
    );
    expect(quota.status).toBe('unavailable');
    expect(quota.quotas[0]).toMatchObject({
      total: null,
      used: null,
      remaining: null,
      remainingPercent: null,
      state: 'unavailable',
    });
    expect(JSON.stringify(quota)).not.toContain('secret');
    expect(copilotAccountUsage({}).status).toBe('unavailable');
    expect(read(observation({ budgetMetadata: {} })).quotas[0].remaining).toBeNull();
  });
  it('参考余额的0/0保留可用判定，不推算消耗、百分比或月度重置', () => {
    const quota = read(
      observation({ quantityKind: 'advisory_balance', availableQuantity: 0, entitledQuantity: 0 }),
    ).quotas[0];
    expect(quota).toMatchObject({
      advisory: true,
      state: 'available',
      remaining: 0,
      total: 0,
      used: null,
      remainingPercent: null,
      resetAt: null,
    });
    expect(
      read(observation({ quantityKind: 'advisory_balance', availableQuantity: null })).quotas[0]
        .remaining,
    ).toBeNull();
  });
  it('不把响应准入状态、其他提供商或损坏标识当作当前账户余额', () => {
    for (const changes of [
      { observationKind: 'admission_state' },
      { provider: { kind: 'loki' } },
      { quotaId: 123 },
    ])
      expect(read(observation(changes)).quotas).toEqual([]);
  });
  it('旧请求额度与token计费的未知单位明确分开，不误标AI Credits', () => {
    const usage = copilotAccountUsage({
      snapshots: {
        chat: { entitlementRequests: 50, usedRequests: 20, remainingPercentage: 60 },
        premium_interactions: {
          entitlementRequests: 100,
          usedRequests: 100,
          tokenBasedBilling: true,
        },
        completions: { entitlementRequests: -1, usedRequests: 80 },
      },
    });
    expect(usage.quotas[0]).toMatchObject({
      unit: 'requests',
      remaining: 30,
      remainingPercent: 60,
    });
    expect(usage.quotas[1]).toMatchObject({
      unit: 'unknown',
      remaining: null,
      used: null,
      remainingPercent: null,
      state: 'unknown',
    });
    expect(usage.quotas[2]).toMatchObject({
      unlimited: true,
      remaining: null,
      remainingPercent: null,
    });
  });
  it('明确的耗尽/访问受限保持服务判定，非法数字不能变为0', () => {
    expect(read(observation({ capacityState: 'exhausted' })).quotas[0].state).toBe('exhausted');
    expect(read(observation({ accessState: 'denied' })).quotas[0].state).toBe('restricted');
    const quota = read(
      observation({
        budgetMetadata: {
          entitlement: NaN,
          consumed: Infinity,
          remainingPercentage: 120,
          resetAtEpochMs: -1,
        },
      }),
    ).quotas[0];
    expect(quota).toMatchObject({
      total: null,
      used: null,
      remaining: null,
      remainingPercent: null,
      resetAt: null,
    });
  });
  it('额度调用不调用推理或本机账本，检查身份并屏蔽原始错误', async () => {
    const refresh = vi.fn(async () => ({ providerQuotas: [observation()] }));
    const access = vi.fn(async () => ({ account: 'synthetic' }));
    const ledger = { get: vi.fn(), add: vi.fn(), reset: vi.fn() };
    const client = vi.fn();
    const service = new CopilotChatService({
      access,
      client,
      ledger: ledger as any,
      control: async () => ({ rpc: { quota: { refresh } } }) as any,
    });
    expect((await service.accountUsage()).quotas[0].remaining).toBe(74.5);
    expect(access).toHaveBeenCalledTimes(2);
    expect(client).not.toHaveBeenCalled();
    expect(ledger.get).not.toHaveBeenCalled();
    refresh.mockRejectedValueOnce(Error('token=private-secret'));
    await expect(service.accountUsage()).rejects.toThrow('账户额度暂不可用');
    access.mockRejectedValueOnce(Error('account changed'));
    const calls = refresh.mock.calls.length;
    await expect(service.accountUsage()).rejects.toThrow('账户额度暂不可用');
    expect(refresh.mock.calls).toHaveLength(calls);
    access.mockResolvedValueOnce({ account: 'first' }).mockResolvedValueOnce({ account: 'second' });
    await expect(service.accountUsage()).rejects.toThrow('账户额度暂不可用');
    const router = new SelectedChatService(() => service);
    expect((await router.accountUsage())?.provider).toBe('copilot');
  });
});
