import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { copilotAccountUsage } from '../../electron/backend/copilot/quota';
import { chatGPTAccountUsage } from '../../electron/backend/chat/quota';
import { useGeneralSettings } from '../../src/stores/generalSettings';
import { t } from '../../src/i18n';
beforeEach(() => useGeneralSettings.setState({ language: 'zh-CN' }));
const fixture = vi.hoisted(() => ({
  mode: 'copilot',
  usage: null as any,
  loading: false,
  error: null as string | null,
  user: { id: 'synthetic', name: '', email: '' },
  accounts: [] as ('chatgpt' | 'copilot')[],
  accountUsers: {} as Record<string, { name: string; email: string }>,
}));
vi.mock('../../src/stores/chatConnection', () => ({
  useChatConnection: () => ({
    usage: fixture.usage,
    loadingUsage: fixture.loading,
    usageError: fixture.error,
    refreshUsage: vi.fn(),
    savedUsage: {},
  }),
}));
vi.mock('../../src/stores/auth', () => ({
  useAuth: (select?: (value: unknown) => unknown) => {
    const state = {
      session: { mode: fixture.mode, user: fixture.user },
      accounts: fixture.accounts,
      accountUsers: fixture.accountUsers,
      accountsLoaded: true,
      loadAccounts: vi.fn(),
      resolved: true,
    };
    return select ? select(state) : state;
  },
}));
import { AIServicePanel } from '../../src/components/AIServicePanel';
import { UsagePanel } from '../../src/components/UsagePanel';
import { AccountUsageSummary, InterviewApiBillingRow } from '../../src/components/AccountUsageSummary';
afterEach(() => {
  fixture.mode = 'copilot';
  fixture.usage = null;
  fixture.loading = false;
  fixture.error = null;
  fixture.user = { id: 'synthetic', name: '', email: '' };
  fixture.accounts = [];
  fixture.accountUsers = {};
  vi.useRealTimers();
});
it.each(['zh-CN', 'en'] as const)('开始面试按当前 API 服务商显示余额或计费方式：%s', language => {
  useGeneralSettings.setState({ language });
  const balances = [{ currency: 'USD', total: '0.00' }, { currency: 'CNY', total: '12.34' }];
  const row = renderToStaticMarkup(<InterviewApiBillingRow provider="openai" />);
  expect(row).toBe(language === 'en'
    ? '<div><dt>OpenAI API</dt><dd>API billing</dd></div>'
    : '<div><dt>OpenAI API</dt><dd>API计费</dd></div>');
  const deepSeek = renderToStaticMarkup(<InterviewApiBillingRow provider="deepseek" balances={balances} />);
  expect(deepSeek).toContain('<dt>DeepSeek API</dt>');
  expect(deepSeek).toContain(language === 'en' ? '12.34 CNY remaining' : '剩余 12.34 CNY');
  expect(deepSeek).not.toContain('0.00 USD');
});
it('没有余额信息时显示API计费，真实零余额仍显示额度', () => {
  const status = (balances?: { currency: string; total: string }[] | null) =>
    renderToStaticMarkup(<InterviewApiBillingRow provider="deepseek" balances={balances} />);
  expect(status()).toContain('API计费');
  expect(status(null)).toContain('API计费');
  expect(status([])).toContain('API计费');
  expect(status([{ currency: 'CNY', total: '0.00' }])).toContain('剩余 0.00 CNY');
});
it('账号身份优先显示邮箱，否则显示用户名，并保留未启用账号身份', () => {
  fixture.mode = 'copilot';
  fixture.user.name = 'synthetic-github';
  fixture.accounts = ['chatgpt', 'copilot'];
  fixture.accountUsers.chatgpt = { name: 'Synthetic ChatGPT', email: 'synthetic@example.test' };
  let html = renderToStaticMarkup(<AIServicePanel />);
  expect(html).toContain('synthetic-github');
  expect(html).toContain('synthetic@example.test');
  expect(html).not.toContain('当前使用中');
  fixture.user.email = 'github@example.test';
  html = renderToStaticMarkup(<AIServicePanel />);
  expect(html).toContain('github@example.test');
  expect(html).not.toContain('synthetic-github');
});
it.each(['zh-CN', 'en'] as const)('额度错误去重并保留读屏提示与其他错误：%s', language => {
  useGeneralSettings.setState({ language });
  fixture.mode = 'chatgpt';
  fixture.error = 'ChatGPT 账户额度暂不可用，请刷新或查看官方用量。';
  const placeholder = t(fixture.error);
  const html = renderToStaticMarkup(<UsagePanel />);
  expect(html.split(placeholder)).toHaveLength(2);
  expect(html).toContain('role="alert">' + placeholder + '</p>');
  fixture.error = 'Synthetic account error';
  const distinct = renderToStaticMarkup(<UsagePanel />);
  expect(distinct).toContain(placeholder);
  expect(distinct).toContain('role="alert">Synthetic account error</p>');
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
it.each(['zh-CN', 'en'] as const)('官方零额度保留计量与进度，不显示耗尽提示：%s', (language) => {
  useGeneralSettings.setState({ language });
  fixture.usage = copilotAccountUsage({
    planTier: 'free',
    snapshots: { chat: { entitlementRequests: 50, usedRequests: 50, remainingPercentage: 0 } },
  });
  const html = renderToStaticMarkup(<UsagePanel />);
  expect(html).toContain('Copilot Free');
  expect(html).not.toMatch(/额度已用尽|Allowance used up/);
  expect(html).toContain(language === 'en' ? '0% remaining' : '剩余 0%');
  expect(html).toContain('aria-valuenow="0"');
  expect(html).toContain(language === 'en' ? '50 requests' : '50 次');
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
  fixture.usage.quotas.reverse();
  let html = renderToStaticMarkup(<UsagePanel />);
  expect(html.indexOf('5小时额度')).toBeLessThan(html.indexOf('每周额度'));
  expect(fixture.usage.quotas[0].label).toBe('每周额度');
  expect(html).toContain('5小时额度');
  expect(html).toContain('每周额度');
  expect(html).toContain('<strong>ChatGPT Plus额度</strong>');
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
it.each(['chatgpt', 'copilot'] as const)('设置卡片与摘要都显示整数，进度保留供应商精度：%s', (provider) => {
  fixture.mode = provider;
  for (const [remaining, integer] of [[19, 19], [19.99, 19], [75.246, 75]]) {
    fixture.usage = provider === 'chatgpt'
      ? chatGPTAccountUsage({ rateLimits: { primary: { usedPercent: 100 - remaining, windowDurationMins: 300 } } })
      : copilotAccountUsage({ snapshots: { chat: { entitlementRequests: 100, usedRequests: 100 - remaining, remainingPercentage: remaining, hasQuota: true } } });
    const raw = fixture.usage.quotas[0].remainingPercent;
    const card = renderToStaticMarkup(<UsagePanel />);
    expect(raw).toBeCloseTo(remaining, 8);
    expect(card).toContain(`class="account-quota-remaining">剩余 ${integer}%</span>`);
    expect(card).toContain(`aria-valuenow="${raw}"`);
    const summary = renderToStaticMarkup(<AccountUsageSummary usage={fixture.usage} mode="sidebar" />);
    expect(summary.replace(/<[^>]*>/g, '')).toContain(`${integer}%`);
    expect(summary).not.toMatch(/\d\.\d+%/);
  }
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

it.each(['zh-CN', 'en'] as const)('套餐与额度合并为标题，未知套餐不推断计划：%s', (language) => {
  useGeneralSettings.setState({ language });
  fixture.mode = 'chatgpt';
  for (const planType of ['prolite', 'promax']) {
    fixture.usage = chatGPTAccountUsage({
      rateLimits: { planType, secondary: { usedPercent: 45, windowDurationMins: 10080 } },
    });
    expect(renderToStaticMarkup(<UsagePanel />)).toContain(
      `<strong>ChatGPT Pro${language === 'en' ? ' usage' : '额度'}</strong>`,
    );
  }
  fixture.usage = chatGPTAccountUsage({
    rateLimits: { secondary: { usedPercent: 45, windowDurationMins: 10080 } },
  });
  const html = renderToStaticMarkup(<UsagePanel />);
  expect(html).toContain(`<strong>ChatGPT${language === 'en' ? ' usage' : '额度'}</strong>`);
  expect(html).not.toContain('account-quota-plan');
  expect(html).not.toMatch(/ChatGPT Pro|ChatGPT Plus|ChatGPT Free/);
  fixture.mode = 'copilot';
  fixture.usage = copilotAccountUsage({ planTier: 'edu' });
  expect(renderToStaticMarkup(<UsagePanel />)).toContain(language === 'en'
    ? '<strong>Copilot student/education plan usage</strong>'
    : '<strong>Copilot 学生/教育计划额度</strong>');
});

it.each(
  (['zh-CN', 'en'] as const).flatMap((language) =>
    [300, 10080].flatMap((minutes) =>
      [0, 19, 20, 71].map((remaining) => ({ language, minutes, remaining })),
    ),
  ),
)(
  'single-period sidebar keeps provider and remaining inline, highlighting only a low percent: $language, $minutes min, $remaining%',
  ({ language, minutes, remaining }) => {
    useGeneralSettings.setState({ language });
    const usage = chatGPTAccountUsage({
      rateLimits: { primary: { usedPercent: 100 - remaining, windowDurationMins: minutes } },
    });
    const html = renderToStaticMarkup(<AccountUsageSummary usage={usage} mode="sidebar" />);
    const classes = html.match(/^<span class="([^"]+)"/)?.[1].split(' ');
    expect(classes).toEqual(
      expect.arrayContaining(['account-usage-summary', 'is-sidebar', 'is-inline']),
    );
    expect(classes).not.toContain('is-low');
    expect(html.replace(/<[^>]+>/g, '')).toBe(
      language === 'en' ? `ChatGPT ${remaining}% remaining` : `ChatGPT 剩余 ${remaining}%`,
    );
    expect(html).toContain('class="account-usage-heading">ChatGPT</span>');
    expect(html).toContain('class="account-usage-value"');
    expect(html).not.toContain('class="account-usage-value is-low"');
    expect(html.match(/class="[^"]*\bis-low\b[^"]*"/g) ?? []).toHaveLength(remaining < 20 ? 1 : 0);
    if (remaining < 20)
      expect(html).toContain(`class="account-usage-percent is-low">${remaining}%</span>`);
  },
);

it('a low weekly period preserves the expanded two-period sidebar and healthy five-hour value', () => {
  const usage = chatGPTAccountUsage({
    rateLimits: {
      primary: { usedPercent: 29, windowDurationMins: 300 },
      secondary: { usedPercent: 81, windowDurationMins: 10080 },
    },
  });
  const html = renderToStaticMarkup(<AccountUsageSummary usage={usage} mode="sidebar" />);
  const classes = html.match(/^<span class="([^"]+)"/)?.[1].split(' ');
  expect(classes).toEqual(
    expect.arrayContaining(['account-usage-summary', 'is-sidebar', 'is-low']),
  );
  expect(classes).not.toContain('is-inline');
  expect(html).toContain('class="account-usage-heading">ChatGPT 用量</span>');
  expect(html).toContain('class="account-usage-value">5小时 71%</span>');
  expect(html).toContain('class="account-usage-value is-low">每周 19%</span>');
  expect(html).not.toContain('account-usage-percent');
});

it.each(['chatgpt', 'copilot'] as const)('shows the account quota inside only the connected %s group', (mode) => {
  fixture.mode = mode;
  fixture.usage = mode === 'chatgpt'
    ? chatGPTAccountUsage({ rateLimits: { primary: { usedPercent: 41, windowDurationMins: 300 } } })
    : copilotAccountUsage({
        snapshots: { chat: { entitlementRequests: 100, usedRequests: 41, remainingPercentage: 59 } },
      });
  const html = renderToStaticMarkup(<AIServicePanel />);
  const parts = html.split('<section class="usage-panel settings-usage"');
  expect(parts).toHaveLength(2);
  const [before, after] = parts;
  const other = mode === 'chatgpt' ? 'copilot' : 'chatgpt';
  expect(before.lastIndexOf(`data-settings-target="${mode}"`)).toBeGreaterThan(
    before.lastIndexOf(`data-settings-target="${other}"`),
  );
  expect(before).toContain(`aria-controls="account-settings-${mode}"`);
  expect(before).toContain('aria-expanded="true"');
  expect(before).toContain('禁用</button>');
  expect(after).toContain('剩余 59%');
  expect(html).toContain('未登录');
});
