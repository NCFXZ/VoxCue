import { expect, it } from 'vitest';
import { accountUsageSummary } from '../../src/services/accountUsageSummary';
import { chatGPTAccountUsage } from '../../electron/backend/chat/quota';

it('prefers the explicit five-hour remaining percentage, including zero, over weekly data', () => {
  const usage = chatGPTAccountUsage({
    rateLimits: {
      primary: { usedPercent: 29, windowDurationMins: 10080 },
      secondary: { usedPercent: 100, windowDurationMins: 300 },
    },
  });
  expect(accountUsageSummary(usage)).toBe('ChatGPT 剩余 0%');
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
