import { beforeEach, expect, it } from 'vitest';
import { useGeneralSettings } from '../../src/stores/generalSettings';
beforeEach(() => useGeneralSettings.setState({ language: 'zh-CN' }));
import {
  accountUsageSummary,
  accountUsageSummaryParts,
  isAccountUsageLow,
} from '../../src/services/accountUsageSummary';
import { chatGPTAccountUsage } from '../../electron/backend/chat/quota';
import { copilotAccountUsage } from '../../electron/backend/copilot/quota';

it('shows the low five-hour quota, including zero, and omits the healthy weekly quota', () => {
  const usage = chatGPTAccountUsage({
    rateLimits: {
      primary: { usedPercent: 29, windowDurationMins: 10080 },
      secondary: { usedPercent: 100, windowDurationMins: 300 },
    },
  });
  expect(accountUsageSummary(usage)).toBe('ChatGPT 剩余: 5小时 0%');
  expect(isAccountUsageLow(usage)).toBe(true);
});

it('uses the returned weekly quota when no five-hour quota exists', () => {
  expect(
    accountUsageSummary(
      chatGPTAccountUsage({
        rateLimits: {
          primary: { usedPercent: 29, windowDurationMins: 10080 },
        },
      }),
    ),
  ).toBe('ChatGPT 剩余 71%');
});

it('does not invent usage when the provider snapshot is unavailable', () => {
  expect(accountUsageSummary(null)).toBe('AI 服务用量暂不可用');
  expect(accountUsageSummary(chatGPTAccountUsage({}))).toBe('AI 服务用量暂不可用');
});

it('translates named provider windows while preserving the bucket name and low weekly quota', () => {
  useGeneralSettings.setState({ language: 'en' });
  const usage = chatGPTAccountUsage({
    rateLimitsByLimitId: {
      codex: {
        limitName: 'codex',
        primary: { usedPercent: 0, windowDurationMins: 300 },
        secondary: { usedPercent: 81, windowDurationMins: 10080 },
      },
    },
  });
  expect(accountUsageSummaryParts(usage, 'all')?.values).toEqual([
    { text: 'codex · 5-hour usage 100%', low: false },
    { text: 'codex · Weekly usage 19%', low: true },
  ]);
  expect(accountUsageSummary(usage)).toBe('ChatGPT remaining: codex · Weekly usage 19%');
});

it('displays the bound Copilot quantity without a five-hour claim', () => {
  const usage = chatGPTAccountUsage({
    rateLimits: {
      primary: { usedPercent: 0, windowDurationMins: 10080 },
    },
  });
  expect(
    accountUsageSummary({
      ...usage,
      provider: 'copilot',
      quotas: [
        {
          ...usage.quotas[0],
          unit: 'ai_credits',
          remainingPercent: null,
          remaining: 12.5,
        },
      ],
    }),
  ).toBe('Copilot 剩余 12.5 AI Credits');
});

it.each([
  [0, true],
  [19, true],
  [19.99, true],
  [20, false],
  [20.01, false],
  [100, false],
])('warns only below 20%% remaining: %s%%', (remaining, low) => {
  const usage = chatGPTAccountUsage({
    rateLimits: { primary: { usedPercent: 100 - remaining, windowDurationMins: 300 } },
  });
  expect(isAccountUsageLow(usage)).toBe(low);
});

it('warns for an exhausted week even when the five-hour quota is full, omitting the healthy quota', () => {
  const usage = chatGPTAccountUsage({
    rateLimits: {
      primary: { usedPercent: 100, windowDurationMins: 10080 },
      secondary: { usedPercent: 0, windowDurationMins: 300 },
    },
  });
  expect(accountUsageSummary(usage)).toBe('ChatGPT 剩余: 每周 0%');
  expect(isAccountUsageLow(usage)).toBe(true);
  usage.quotas.pop();
  expect(accountUsageSummary(usage)).toBe('ChatGPT 剩余: 每周 0%');
  expect(isAccountUsageLow(usage)).toBe(true);
});

it('lists every low quota while omitting quotas at 20% or above', () => {
  const usage = chatGPTAccountUsage({
    rateLimits: {
      primary: { usedPercent: 90, windowDurationMins: 300 },
      secondary: { usedPercent: 85, windowDurationMins: 10080 },
    },
  });
  expect(accountUsageSummary(usage)).toBe('ChatGPT 剩余: 5小时 10% · 每周 15%');
  expect(accountUsageSummaryParts(usage)).toMatchObject({
    title: 'ChatGPT 用量',
    low: true,
    values: [
      { text: '5小时 10%', low: true },
      { text: '每周 15%', low: true },
    ],
  });
  expect(isAccountUsageLow(usage)).toBe(true);
  useGeneralSettings.setState({ language: 'en' });
  expect(accountUsageSummary(usage)).toBe('ChatGPT remaining: 5h 10% · Weekly 15%');
  expect(accountUsageSummaryParts(usage)?.title).toBe('ChatGPT usage');
  useGeneralSettings.setState({ language: 'zh-CN' });
  usage.quotas[0].remainingPercent = 20;
  expect(accountUsageSummary(usage)).toBe('ChatGPT 剩余: 每周 15%');
  usage.quotas[1].remainingPercent = 20;
  expect(accountUsageSummary(usage)).toBe('ChatGPT 剩余 20%');
  expect(accountUsageSummaryParts(usage)?.title).toBe('ChatGPT 用量');
  expect(isAccountUsageLow(usage)).toBe(false);
});

it('names low Copilot quotas and translates quota warnings', () => {
  const copilot = copilotAccountUsage({
    snapshots: {
      chat: {
        entitlementRequests: 50,
        usedRequests: 45,
        remainingPercentage: 10,
        hasQuota: true,
      },
    },
  });
  expect(accountUsageSummary(copilot)).toBe('Copilot 剩余: 聊天额度 10%');
  expect(accountUsageSummaryParts(copilot)?.title).toBe('Copilot 用量');
  expect(isAccountUsageLow(copilot)).toBe(true);
  useGeneralSettings.setState({ language: 'en' });
  expect(accountUsageSummary(copilot)).toBe('Copilot remaining: Chat usage 10%');
  useGeneralSettings.setState({ language: 'zh-CN' });
  copilot.quotas[0].remainingPercent = 60;
  expect(accountUsageSummaryParts(copilot)).toMatchObject({
    title: 'Copilot 用量',
    low: false,
  });
});

it('displays integer percentages without rounding a low quota up to 20%', () => {
  const usage = chatGPTAccountUsage({
    rateLimits: { primary: { usedPercent: 80.01, windowDurationMins: 300 } },
  });
  expect(accountUsageSummary(usage)).toBe('ChatGPT 剩余: 5小时 19%');
  expect(isAccountUsageLow(usage)).toBe(true);
  usage.quotas[0].remainingPercent = 71.9;
  expect(accountUsageSummary(usage)).toBe('ChatGPT 剩余 71%');
});

it('does not warn for unavailable, unknown, unlimited or missing percentages', () => {
  const usage = chatGPTAccountUsage({
    rateLimits: { primary: { usedPercent: 90, windowDurationMins: 300 } },
  });
  expect(isAccountUsageLow(null)).toBe(false);
  expect(isAccountUsageLow({ ...usage, status: 'unavailable' })).toBe(false);
  expect(isAccountUsageLow({ ...usage, quotas: [] })).toBe(false);
  for (const change of [
    { unlimited: true },
    { state: 'unknown' as const },
    { state: 'unavailable' as const },
    { remainingPercent: null, remaining: 1 },
    { remainingPercent: -1 },
    { remainingPercent: NaN },
  ])
    expect(isAccountUsageLow({ ...usage, quotas: [{ ...usage.quotas[0], ...change }] })).toBe(
      false,
    );
});

it.each([
  [71, 19, ['5小时 71%', '每周 19%'], [false, true]],
  [19, 71, ['5小时 19%', '每周 71%'], [true, false]],
  [100, 0, ['5小时 100%', '每周 0%'], [false, true]],
  [19, 15, ['5小时 19%', '每周 15%'], [true, true]],
  [20, 20, ['剩余 20%'], [false]],
  [71, 71, ['剩余 71%'], [false]],
] as const)(
  'sidebar expands both periods only while warning: five=%s, week=%s',
  (five, week, texts, warnings) => {
    const usage = chatGPTAccountUsage({
      rateLimits: {
        primary: { usedPercent: 100 - week, windowDurationMins: 10080 },
        secondary: { usedPercent: 100 - five, windowDurationMins: 300 },
      },
    });
    const sidebar = accountUsageSummaryParts(usage, 'sidebar');
    expect(sidebar?.values.map((value) => value.text)).toEqual(texts);
    expect(sidebar?.values.map((value) => value.low)).toEqual(warnings);
    expect(sidebar?.low).toBe(warnings.some(Boolean));
    expect(sidebar?.inline).toBe(false);
  },
);

it.each(
  (['zh-CN', 'en'] as const).flatMap((language) =>
    [300, 10080].flatMap((minutes) =>
      [0, 19, 20, 71].map((remaining) => ({ language, minutes, remaining })),
    ),
  ),
)(
  'sidebar keeps one actual ChatGPT period inline: $language, $minutes min, $remaining%',
  ({ language, minutes, remaining }) => {
    useGeneralSettings.setState({ language });
    const usage = chatGPTAccountUsage({
      rateLimits: { primary: { usedPercent: 100 - remaining, windowDurationMins: minutes } },
    });
    const low = remaining < 20;
    expect(accountUsageSummaryParts(usage, 'sidebar')).toMatchObject({
      provider: 'ChatGPT',
      inline: true,
      low,
      values: [
        {
          text: language === 'en' ? `${remaining}% remaining` : `剩余 ${remaining}%`,
          low,
          ...(low ? { percent: `${remaining}%` } : {}),
        },
      ],
    });
    const value = accountUsageSummaryParts(usage, 'sidebar')?.values[0];
    if (!low) expect(value).not.toHaveProperty('percent');
    for (const mode of ['summary', 'all'] as const) {
      const summary = accountUsageSummaryParts(usage, mode);
      expect(summary?.inline).toBe(false);
      expect(summary?.values[0]).not.toHaveProperty('percent');
    }
  },
);

it('sidebar preserves the Copilot summary without applying the ChatGPT single-period layout', () => {
  const copilot = copilotAccountUsage({
    snapshots: { chat: { entitlementRequests: 50, usedRequests: 45, remainingPercentage: 10 } },
  });
  expect(accountUsageSummaryParts(copilot, 'sidebar')).toEqual(accountUsageSummaryParts(copilot));
  expect(accountUsageSummaryParts(copilot, 'sidebar')?.inline).toBe(false);
});

it.each([71, 20, 19, 0].flatMap((five) => [71, 20, 19, 0].map((week) => [five, week])))(
  'start overview shows both windows with independent warnings: five=%s, week=%s',
  (five, week) => {
    const usage = chatGPTAccountUsage({
      rateLimits: {
        primary: { usedPercent: 100 - five, windowDurationMins: 300 },
        secondary: { usedPercent: 100 - week, windowDurationMins: 10080 },
      },
    });
    expect(accountUsageSummaryParts(usage, 'all')).toMatchObject({
      low: five < 20 || week < 20,
      values: [
        { text: `5小时 ${five}%`, low: five < 20 },
        { text: `每周 ${week}%`, low: week < 20 },
      ],
    });
  },
);

it.each([71, 20, 19, 0])(
  'without a five-hour quota, the start overview uses plain remaining %s%%',
  (week) => {
    const usage = chatGPTAccountUsage({
      rateLimits: {
        primary: { usedPercent: 100 - week, windowDurationMins: 10080 },
      },
    });
    expect(accountUsageSummaryParts(usage, 'all')?.values).toEqual([
      { text: `剩余 ${week}%`, low: week < 20 },
    ]);
  },
);

it('full overview preserves unlimited and unknown quota states without inventing zero', () => {
  const usage = chatGPTAccountUsage({
    rateLimits: {
      primary: { usedPercent: 29, windowDurationMins: 300 },
      secondary: { usedPercent: 29, windowDurationMins: 10080 },
    },
  });
  usage.quotas[0].unlimited = true;
  usage.quotas[0].remainingPercent = null;
  expect(accountUsageSummaryParts(usage, 'all')?.values[0]).toEqual({
    text: '5小时额度 不限量',
    low: false,
  });
  usage.quotas[0].unlimited = false;
  usage.quotas[0].state = 'unknown';
  usage.quotas[0].remainingPercent = 0;
  expect(accountUsageSummaryParts(usage, 'all')?.values[0]).toEqual({
    text: '5小时额度 用量暂不可用',
    low: false,
  });
});
