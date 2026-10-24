import type { AccountQuota, AccountUsage } from '../../contracts/accountUsage';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const plans = new Set<AccountUsage['plan']>([
  'free',
  'go',
  'plus',
  'pro',
  'business',
  'enterprise',
  'edu',
]);

/** The pinned official protocol has multiple Pro variants; show their known family. */
export function chatGPTPlan(value: unknown): AccountUsage['plan'] {
  if (value === 'prolite' || value === 'promax') return 'pro';
  return plans.has(value as AccountUsage['plan']) ? (value as AccountUsage['plan']) : 'unknown';
}

/** Only explicit server windows are displayed; primary never implies five hours. */
export function chatGPTAccountUsage(value: unknown, now = Date.now()): AccountUsage {
  const data = record(value);
  const groups = record(data?.rateLimitsByLimitId);
  const buckets = groups ? Object.values(groups) : [data?.rateLimits];
  const quotas: AccountQuota[] = [];
  // Plan metadata may remain in the legacy snapshot while quota windows use
  // the multi-bucket view. Reading it must not duplicate legacy windows.
  let plan = chatGPTPlan(record(data?.rateLimits)?.planType);
  for (const source of buckets.slice(0, 32)) {
    const bucket = record(source);
    if (!bucket) continue;
    const bucketPlan = chatGPTPlan(bucket.planType);
    if (bucketPlan !== 'unknown') plan = bucketPlan;
    const label =
      typeof bucket.limitName === 'string' && /^[\p{L}\p{N} ._+()\-]{1,60}$/u.test(bucket.limitName)
        ? bucket.limitName
        : '';
    for (const field of ['primary', 'secondary'] as const) {
      const window = record(bucket[field]);
      if (!window) continue;
      const duration = window.windowDurationMins;
      const used = window.usedPercent;
      if (
        typeof duration !== 'number' ||
        !Number.isSafeInteger(duration) ||
        duration <= 0 ||
        duration > 525600 ||
        typeof used !== 'number' ||
        !Number.isFinite(used) ||
        used < 0
      )
        continue;
      const period =
        duration === 300
          ? '5小时额度'
          : duration === 10080
            ? '每周额度'
            : duration % 1440 === 0
              ? `${duration / 1440}天额度`
              : duration % 60 === 0
                ? `${duration / 60}小时额度`
                : `${duration}分钟额度`;
      const reset = window.resetsAt;
      quotas.push({
        id: `quota-${quotas.length}-${duration}`,
        label: label ? `${label} · ${period}` : period,
        unit: 'percent',
        total: null,
        used,
        remaining: null,
        remainingPercent: Math.max(0, 100 - used),
        unlimited: false,
        state: used >= 100 ? 'exhausted' : 'available',
        additionalUsageAllowed: null,
        advisory: false,
        resetAt:
          typeof reset === 'number' &&
          Number.isSafeInteger(reset) &&
          reset > 0 &&
          reset < 8640000000000
            ? reset * 1000
            : null,
        resetEstimated: false,
      });
    }
  }
  return {
    provider: 'chatgpt',
    status: quotas.length ? 'available' : 'unavailable',
    plan,
    quotas,
    queriedAt: now,
  };
}
