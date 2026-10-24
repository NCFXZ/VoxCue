import type { AccountQuota, AccountUsage } from '../../contracts/accountUsage';

const object = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const quantity = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
const nonnegative = (value: unknown) => {
  const number = quantity(value);
  return number !== null && number >= 0 ? number : null;
};
const percent = (value: unknown) => {
  const number = nonnegative(value);
  return number !== null && number <= 100 ? number : null;
};
const date = (value: unknown) => {
  const number = nonnegative(value);
  return number !== null && number > 0 && number <= 8640000000000000 ? number : null;
};
const isoDate = (value: unknown) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? date(Date.parse(value))
    : null;
const quotaKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w.-]{1,80}$/.test(value);
const labels = new Map([
  ['chat', '聊天额度'],
  ['completions', '代码补全额度'],
  ['premium_interactions', '高级请求额度'],
  ['ai_credits', 'AI Credits'],
]);
const label = (key: string, unit: AccountQuota['unit']) =>
  labels.get(key) ??
  (unit === 'ai_credits' ? 'AI Credits' : unit === 'tokens' ? 'Token 额度' : '账户额度');
function empty(id: string, unit: AccountQuota['unit']): AccountQuota {
  return {
    id,
    label: label(id, unit),
    unit,
    total: null,
    used: null,
    remaining: null,
    remainingPercent: null,
    unlimited: false,
    state: 'unknown',
    additionalUsageAllowed: null,
    advisory: false,
    resetAt: null,
    resetEstimated: false,
  };
}

/** Only account quota fields cross IPC. Never forward provider identities or raw errors. */
export function copilotAccountUsage(value: unknown, accountQuota?: unknown): AccountUsage {
  const raw = object(value);
  const snapshots = object(raw.snapshots);
  const accountSnapshots = object(object(accountQuota).quotaSnapshots);
  const plan = ['free', 'edu', 'pro', 'pro_plus', 'max', 'business', 'enterprise'].includes(
    raw.planTier,
  )
    ? raw.planTier
    : 'unknown';
  const quotas: AccountQuota[] = [];
  if (Array.isArray(raw.providerQuotas) && raw.providerQuotas.length) {
    for (const item of raw.providerQuotas.slice(0, 32)) {
      const source = object(item);
      if (
        source.provider?.kind !== 'copilot' ||
        source.observationKind !== 'account_snapshot' ||
        !quotaKey(source.quotaId)
      )
        continue;
      const unit: AccountQuota['unit'] = ['ai_credits', 'requests', 'tokens'].includes(source.unit)
        ? source.unit
        : 'unknown';
      const quota = empty(source.quotaId, unit);
      if (source.acquisitionStatus === 'failed' || source.acquisitionStatus === 'unavailable') {
        quotas.push({ ...quota, state: 'unavailable' });
        continue;
      }
      quota.state =
        source.accessState === 'denied'
          ? 'restricted'
          : source.capacityState === 'exhausted'
            ? 'exhausted'
            : ['available', 'unlimited', 'not_required'].includes(source.capacityState)
              ? 'available'
              : 'unknown';
      if (source.quantityKind === 'authoritative_budget' && unit !== 'unknown') {
        const budget = object(source.budgetMetadata);
        quota.total = nonnegative(budget.entitlement);
        quota.used = nonnegative(budget.consumed);
        quota.unlimited = budget.unlimited === true || budget.entitlement === -1;
        quota.remaining =
          quota.unlimited || quota.total === null || quota.used === null
            ? null
            : Math.max(0, quota.total - quota.used);
        quota.remainingPercent =
          quota.unlimited || quota.total === null || quota.total <= 0
            ? null
            : percent(budget.remainingPercentage);
        // The runtime explicitly maps authoritative budgets to compatibility
        // snapshot keys. Only borrow reset metadata for that exact quota.
        const key = source.compatibilityKey ?? source.quotaId;
        const snapshot = quotaKey(key) ? object(snapshots[key]) : {};
        const accountSnapshot = quotaKey(key) ? object(accountSnapshots[key]) : {};
        const budgetReset = date(budget.resetAtEpochMs);
        const snapshotReset = date(snapshot.resetDateEpochMs);
        quota.resetAt = budgetReset ?? snapshotReset ?? isoDate(accountSnapshot.resetDate);
        quota.resetEstimated =
          budgetReset !== null
            ? budget.resetEstimated === true
            : snapshotReset !== null && snapshot.resetDateEstimated === true;
        quota.additionalUsageAllowed =
          typeof budget.usageAllowedWhenExhausted === 'boolean' &&
          typeof budget.overageAllowedWhenExhausted === 'boolean'
            ? budget.usageAllowedWhenExhausted || budget.overageAllowedWhenExhausted
            : null;
      } else if (source.quantityKind === 'advisory_balance' && unit !== 'unknown') {
        quota.advisory = true;
        quota.total = quantity(source.entitledQuantity);
        quota.remaining = quantity(source.availableQuantity);
        quota.unlimited = quota.total === -1;
        if (quota.unlimited) quota.total = null;
        // Independent balances do not establish consumption, a percentage or a reset window.
      }
      quotas.push(quota);
    }
  } else {
    // Compatibility snapshots preserve their reported unit. Token-based billing
    // alone does not prove that a numeric quantity means AI Credits.
    for (const [key, item] of Object.entries(snapshots).slice(0, 16)) {
      if (!quotaKey(key)) continue;
      const source = object(item);
      const quota = empty(key, source.tokenBasedBilling === true ? 'unknown' : 'requests');
      quota.unlimited = source.isUnlimitedEntitlement === true || source.entitlementRequests === -1;
      if (quota.unit !== 'unknown') {
        quota.total = nonnegative(source.entitlementRequests);
        quota.used = nonnegative(source.usedRequests);
        quota.remaining =
          quota.unlimited || quota.total === null || quota.used === null
            ? null
            : Math.max(0, quota.total - quota.used);
        quota.remainingPercent =
          quota.unlimited || quota.total === null || quota.total <= 0
            ? null
            : percent(source.remainingPercentage);
      }
      quota.state =
        source.hasQuota === true || quota.unlimited
          ? 'available'
          : quota.total !== null && quota.total > 0 && quota.remaining === 0
            ? 'exhausted'
            : 'unknown';
      const snapshotReset = date(source.resetDateEpochMs);
      quota.resetAt = snapshotReset ?? isoDate(object(accountSnapshots[key]).resetDate);
      quota.resetEstimated = snapshotReset !== null && source.resetDateEstimated === true;
      quota.additionalUsageAllowed =
        typeof source.usageAllowedWithExhaustedQuota === 'boolean' &&
        typeof source.overageAllowedWithExhaustedQuota === 'boolean'
          ? source.usageAllowedWithExhaustedQuota || source.overageAllowedWithExhaustedQuota
          : null;
      quotas.push(quota);
    }
  }
  return {
    provider: 'copilot',
    status: quotas.some((quota) => quota.state !== 'unavailable') ? 'available' : 'unavailable',
    plan,
    quotas,
    queriedAt: Date.now(),
  };
}
