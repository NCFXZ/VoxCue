import { t, uiLocale } from '../i18n';
import type { AccountQuota, AccountUsage } from '../../electron/contracts/accountUsage';

/** Use the same bound provider snapshot as AI settings; never invent a five-hour window. */
export function accountUsageSummary(usage: AccountUsage | null) {
  const summary = accountUsageSummaryParts(usage);
  if (!summary) return t('AI 服务用量暂不可用');
  return summary.low
    ? `${t('{0} 剩余', [summary.provider])}: ${summary.values.map((value) => value.text).join(' · ')}`
    : `${summary.provider} ${summary.values[0].text}`;
}

export function accountUsageSummaryParts(
  usage: AccountUsage | null,
  mode: 'summary' | 'all' | 'sidebar' = 'summary',
): {
  provider: string;
  title: string;
  low: boolean;
  values: { text: string; low: boolean }[];
} | null {
  if (usage?.status !== 'available') return null;
  const provider = usage.provider === 'chatgpt' ? 'ChatGPT' : 'Copilot';
  const low = usage.quotas
    .filter(isQuotaLow)
    .sort((a, b) => Number(isFiveHourQuota(b)) - Number(isFiveHourQuota(a)));
  const fiveHour = usage.quotas.find(isFiveHourQuota);
  const quota = fiveHour ?? usage.quotas[0];
  const showAll = mode === 'all' || (mode === 'sidebar' && low.length > 0 && !!fiveHour);
  const selected = showAll
    ? fiveHour
      ? [...usage.quotas].sort((a, b) => Number(isFiveHourQuota(b)) - Number(isFiveHourQuota(a)))
      : [low[0] ?? quota]
    : low.length
      ? low
      : [quota];
  const quotas = selected.filter((value): value is AccountQuota => !!value);
  if (!quotas.length) return null;
  const showLabels = showAll ? !!fiveHour : low.length > 0;
  return {
    provider,
    title: t('{0} 用量', [provider]),
    low: low.length > 0,
    values: quotas.map((value) => ({
      text: showLabels ? compactQuota(value) : remaining(value),
      low: isQuotaLow(value),
    })),
  };
}

export function isAccountUsageLow(usage: AccountUsage | null) {
  return usage?.status === 'available' && usage.quotas.some(isQuotaLow);
}

function isQuotaLow(quota: AccountQuota) {
  return (
    !quota.unlimited &&
    quota.state !== 'unavailable' &&
    quota.state !== 'unknown' &&
    quota.remainingPercent !== null &&
    quota.remainingPercent >= 0 &&
    quota.remainingPercent < 20
  );
}

function isFiveHourQuota(quota: AccountQuota) {
  return /(?:^| · )5小时额度$/.test(quota.label);
}

function compactQuota(quota: AccountQuota) {
  if (
    !quota.unlimited &&
    quota.state !== 'unavailable' &&
    quota.state !== 'unknown' &&
    quota.remainingPercent !== null
  ) {
    const percent = percentage(quota.remainingPercent);
    if (quota.label === '5小时额度') return t('5小时 {0}%', [percent]);
    if (quota.label === '每周额度') return t('每周 {0}%', [percent]);
    return `${t(quota.label)} ${percent}%`;
  }
  return `${t(quota.label)} ${remaining(quota)}`;
}

function percentage(value: number) {
  return Math.floor(value).toLocaleString(uiLocale());
}

function remaining(quota: AccountQuota) {
  if (quota.unlimited) return t('不限量');
  if (quota.state === 'unavailable' || quota.state === 'unknown') return t('用量暂不可用');
  if (quota.remainingPercent !== null) return t('剩余 {0}%', [percentage(quota.remainingPercent)]);
  if (quota.remaining === null || quota.unit === 'unknown') return t('用量暂不可用');
  const unit =
    quota.unit === 'ai_credits' ? 'AI Credits' : quota.unit === 'tokens' ? 'token' : t('次');
  return t('剩余 {0} {1}', [
    quota.remaining.toLocaleString(uiLocale(), { maximumFractionDigits: 2 }),
    unit,
  ]);
}
