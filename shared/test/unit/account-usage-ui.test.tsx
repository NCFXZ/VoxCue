import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { copilotAccountUsage } from '../../electron/backend/copilot/quota';
import { chatGPTAccountUsage } from '../../electron/backend/chat/quota';
import { useGeneralSettings } from '../../src/stores/generalSettings';
beforeEach(() => useGeneralSettings.setState({ language: 'zh-CN' }));
const fixture = vi.hoisted(() => ({
  mode: 'copilot',
  usage: null as any,
  loading: false,
  error: null as string | null,
}));
vi.mock('../../src/stores/chatConnection', () => ({
  useChatConnection: () => ({
    usage: fixture.usage,
    loadingUsage: fixture.loading,
    usageError: fixture.error,
    refreshUsage: vi.fn(),
  }),
}));
vi.mock('../../src/stores/auth', () => ({
  useAuth: (select: any) => select({ session: { mode: fixture.mode, user: { id: 'synthetic' } } }),
}));
import { UsagePanel } from '../../src/components/UsagePanel';
afterEach(() => {
  fixture.mode = 'copilot';
  fixture.usage = null;
  fixture.loading = false;
  fixture.error = null;
  vi.useRealTimers();
});
it('未知额度与读取失败不显示0或耗尽；本地统计/重置已移除', () => {
  fixture.error = '读取暂不可用';
  const html = renderToStaticMarkup(<UsagePanel />);
  expect(html).toContain('账户额度暂不可用');
  expect(html).not.toMatch(/剩余 0|额度已用尽|本应用用量|重置用量|progressbar/);
  expect(html).toContain('查看官方用量');
  expect(html).toMatch(
    /<a[^>]+href="https:\/\/github.com\/settings\/copilot"[^>]*>查看官方用量<\/a>/,
  );
});
it('官方请求额度保持次数单位，明确为零时才显示剩余0%', () => {
  fixture.usage = copilotAccountUsage({
    planTier: 'free',
    snapshots: { chat: { entitlementRequests: 50, usedRequests: 50, remainingPercentage: 0 } },
  });
  const html = renderToStaticMarkup(<UsagePanel />);
  expect(html).toContain('Copilot Free');
  expect(html).toContain('额度已用尽');
  expect(html).toContain('剩余 0%');
  expect(html).toContain('50 次');
  expect(html).not.toContain('AI Credits');
  expect(html).not.toContain('quota-skeleton');
  expect(html).not.toContain('查询时间');
});
it('刷新中不沿用旧额度，ChatGPT不借用Copilot额度', () => {
  fixture.loading = true;
  fixture.usage = copilotAccountUsage({
    snapshots: { chat: { entitlementRequests: 50, usedRequests: 25, remainingPercentage: 50 } },
  });
  let html = renderToStaticMarkup(<UsagePanel />);
  expect(html).toContain('正在读取账户额度');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('role="status"');
  expect(html).toContain('account-quota-skeleton');
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toMatch(/剩余 0|剩余 50|25 次|progressbar|查询时间/);
  fixture.mode = 'chatgpt';
  fixture.loading = false;
  fixture.usage = copilotAccountUsage({
    snapshots: { chat: { entitlementRequests: 50, usedRequests: 25, remainingPercentage: 50 } },
  });
  html = renderToStaticMarkup(<UsagePanel />);
  expect(html).toContain('ChatGPT 账户额度暂不可用');
  expect(html).toContain('href="https://chatgpt.com/settings/usage"');
  expect(html).not.toMatch(/剩余 50|本应用用量|quota-skeleton/);
});
it('ChatGPT返回两窗显示两窗，仅周则不生成五小时卡片', () => {
  fixture.mode = 'chatgpt';
  fixture.usage = chatGPTAccountUsage({
    rateLimits: {
      planType: 'plus',
      primary: { usedPercent: 20, windowDurationMins: 300 },
      secondary: { usedPercent: 40, windowDurationMins: 10080 },
    },
  });
  let html = renderToStaticMarkup(<UsagePanel />);
  expect(html).toContain('5小时额度');
  expect(html).toContain('每周额度');
  expect(html).toContain('ChatGPT Plus');
  expect(html).toContain('剩余 80%');
  expect(html).not.toMatch(/20%|40%|<dt>已用/);
  expect(html).not.toMatch(/AI Credits|计量单位|查询时间/);
  fixture.usage = chatGPTAccountUsage({
    rateLimits: {
      planType: 'pro',
      primary: null,
      secondary: { usedPercent: 10, windowDurationMins: 10080 },
    },
  });
  html = renderToStaticMarkup(<UsagePanel />);
  expect(html).toContain('每周额度');
  expect(html).not.toContain('5小时额度');
  expect(html).not.toContain('连接 ChatGPT 用量');
});
it('刷新按已知窗口生成骨架：两窗两卡，仅周一卡，结构不含已用百分比', () => {
  fixture.mode = 'chatgpt';
  fixture.loading = true;
  fixture.usage = chatGPTAccountUsage({
    rateLimits: {
      primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1793491200 },
      secondary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: 1793577600 },
    },
  });
  let html = renderToStaticMarkup(<UsagePanel />);
  expect(html.match(/account-quota-skeleton/g)).toHaveLength(2);
  expect(html.match(/quota-skeleton-reset/g)).toHaveLength(2);
  expect(html).not.toMatch(/account-quota-details|20%|45%|55%|progressbar/);
  fixture.usage.quotas.shift();
  html = renderToStaticMarkup(<UsagePanel />);
  expect(html.match(/account-quota-skeleton/g)).toHaveLength(1);
  expect(html.match(/quota-skeleton-reset/g)).toHaveLength(1);
  expect(html).not.toContain('account-quota-details');
  fixture.usage = null;
  html = renderToStaticMarkup(<UsagePanel />);
  expect(html).not.toMatch(/account-quota-details|5小时额度|周额度|progressbar/);
});
it('重置显示相对天/小时，不足一天按小时/分钟显示，到期后等待官方更新', () => {
  vi.useFakeTimers();
  const now = Date.UTC(2026, 9, 24, 12);
  vi.setSystemTime(now);
  fixture.mode = 'chatgpt';
  for (const [minutes, expected] of [
    [6 * 1440 + 7 * 60 + 20, '6天7小时后重置'],
    [24 * 60, '1天0小时后重置'],
    [4 * 60 + 15, '4小时15分钟后重置'],
    [24, '24分钟后重置'],
    [0, '重置时间待更新'],
    [-1, '重置时间待更新'],
  ] as const) {
    fixture.usage = chatGPTAccountUsage({
      rateLimits: {
        secondary: {
          usedPercent: 45,
          windowDurationMins: 10080,
          resetsAt: now / 1000 + minutes * 60,
        },
      },
    });
    const html = renderToStaticMarkup(<UsagePanel />);
    expect(html).toContain(expected);
    expect(html).not.toMatch(/2026|45%|<dt>已用|<dt>重置时间/);
  }
});

it('五小时窗口显示小时与分钟，并保留不足一小时的分钟数', () => {
  vi.useFakeTimers();
  const now = Date.UTC(2026, 9, 24, 12);
  vi.setSystemTime(now);
  fixture.mode = 'chatgpt';
  for (const [seconds, expected] of [
    [4 * 3600 + 25 * 60, '4小时25分钟后重置'],
    [25 * 60, '25分钟后重置'],
    [1, '1分钟后重置'],
  ] as const) {
    fixture.usage = chatGPTAccountUsage({
      rateLimits: {
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: now / 1000 + seconds },
      },
    });
    expect(renderToStaticMarkup(<UsagePanel />)).toContain(expected);
  }
});

it('Pro官方变体显示Pro，未知套餐仅显示ChatGPT，预览不作为真实套餐来源', () => {
  fixture.mode = 'chatgpt';
  for (const planType of ['prolite', 'promax']) {
    fixture.usage = chatGPTAccountUsage({
      rateLimits: { planType, secondary: { usedPercent: 45, windowDurationMins: 10080 } },
    });
    expect(renderToStaticMarkup(<UsagePanel />)).toContain('ChatGPT Pro');
  }
  fixture.usage = chatGPTAccountUsage({
    rateLimits: { secondary: { usedPercent: 45, windowDurationMins: 10080 } },
  });
  const html = renderToStaticMarkup(<UsagePanel />);
  expect(html).toContain('class="account-quota-plan">ChatGPT</span>');
  expect(html).not.toMatch(/ChatGPT Pro|ChatGPT Plus|ChatGPT Free/);
});
