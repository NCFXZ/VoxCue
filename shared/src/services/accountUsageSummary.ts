import { t, uiLocale } from '../i18n';
import type { AccountQuota, AccountUsage } from '../../electron/contracts/accountUsage';

/** Use the same bound provider snapshot as AI settings; never invent a five-hour window. */
export function accountUsageSummary(usage: AccountUsage | null) {
  if (usage?.status !== 'available') return t('AI 服务用量暂不可用');
  const quota = usage.quotas.find((q) => /(?:^| · )5小时额度$/.test(q.label)) ?? usage.quotas[0];
  if (!quota) return t('AI 服务用量暂不可用');
  const provider = usage.provider === 'chatgpt' ? 'ChatGPT' : 'Copilot';
  const value = remaining(quota);
  return `${provider} ${value}`;
}

function remaining(quota: AccountQuota) {
  if (quota.unlimited) return t('不限量');
  if (quota.state === 'unavailable' || quota.state === 'unknown') return t('用量暂不可用');
  if (quota.remainingPercent !== null)
    return t('剩余 {0}%', [
      quota.remainingPercent.toLocaleString(uiLocale(), { maximumFractionDigits: 2 }),
    ]);
  if (quota.remaining === null || quota.unit === 'unknown') return t('用量暂不可用');
  const unit =
    quota.unit === 'ai_credits' ? 'AI Credits' : quota.unit === 'tokens' ? 'token' : t('次');
  return t('剩余 {0} {1}', [
    quota.remaining.toLocaleString(uiLocale(), { maximumFractionDigits: 2 }),
    unit,
  ]);
}
