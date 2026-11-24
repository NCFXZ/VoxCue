import { orderedAccountQuotas, quotaPercentage } from '../services/accountUsageSummary';
import { InterviewReveal } from './InterviewReveal';
import { t, uiLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { useHeightTransition } from './ui/useHeightTransition';
import type { AccountQuota, AccountUsage } from '../../electron/contracts/accountUsage';
import { useChatConnection } from '../stores/chatConnection';
import { useAuth } from '../stores/auth';
import { openChatLink } from '../services/chat';
import { Button } from './ui/button';
import { Refresh } from './icons';
import type { AccountService } from '../../electron/contracts/auth';

const planNames: Partial<Record<AccountUsage['plan'], string>> = {
  free: 'Copilot Free',
  edu: 'Copilot 学生/教育计划',
  pro: 'Copilot Pro',
  pro_plus: 'Copilot Pro+',
  max: 'Copilot Max',
  business: 'Copilot Business',
  enterprise: 'Copilot Enterprise',
  unknown: 'GitHub Copilot',
};
const chatGPTPlans: Partial<Record<AccountUsage['plan'], string>> = {
  free: 'ChatGPT Free',
  go: 'ChatGPT Go',
  plus: 'ChatGPT Plus',
  pro: 'ChatGPT Pro',
  edu: 'ChatGPT Edu',
  business: 'ChatGPT Business',
  enterprise: 'ChatGPT Enterprise',
  unknown: 'ChatGPT',
};
const quantity = (value: number | null, unit: AccountQuota['unit']) => {
  if (value === null || unit === 'unknown') return t('暂不可用');
  const number =
    value !== 0 && Math.abs(value) < 0.000001
      ? value.toExponential(2)
      : value.toLocaleString(uiLocale(), { maximumFractionDigits: 6 });
  return unit === 'percent'
    ? `${number}%`
    : `${number} ${unit === 'ai_credits' ? 'AI Credits' : unit === 'tokens' ? 'token' : t('次')}`;
};
function resetCountdown(resetAt: number, now: number) {
  const remaining = resetAt - now;
  if (remaining <= 0) return t('重置时间待更新');
  const hours = Math.floor(remaining / 3_600_000);
  if (hours >= 24) return t(`${Math.floor(hours / 24)}天${hours % 24}小时后重置`);
  const minutes = Math.ceil(remaining / 60_000);
  if (hours === 0) return t(`${minutes}分钟后重置`);
  return t(`${Math.floor(minutes / 60)}小时${minutes % 60}分钟后重置`);
}
function SkeletonLine({ className = '' }: { className?: string }) {
  return <span className={`quota-skeleton-line ${className}`} />;
}
function Quota({
  value,
  loading = false,
  now,
}: {
  value?: AccountQuota;
  loading?: boolean;
  now: number;
}) {
  const state =
    value?.state === 'exhausted'
      ? value.additionalUsageAllowed
        ? '可继续使用额外用量'
        : null
      : value?.state === 'restricted'
        ? '当前账户访问受限'
        : value?.state === 'unavailable'
          ? '额度暂不可用'
          : value?.advisory
            ? '服务返回的参考余额'
            : null;
  const reset = !value || value.resetAt !== null;
  const metrics: { label: string; amount: number | null }[] = !reset && value
    ? [
        ...(value.used !== null && value.unit !== 'percent'
          ? [{ label: '已用', amount: value.used }]
          : []),
        ...(value.remaining !== null && value.remainingPercent !== null
          ? [{ label: '剩余', amount: value.remaining }]
          : []),
      ]
    : [];
  const progress = !value || value.remainingPercent !== null;
  return (
    <article
      className={`account-quota${loading ? ' account-quota-skeleton' : ''}`}
      aria-label={loading ? undefined : t(value?.label)}
    >
      <header>
        <div className="account-quota-heading">
          <strong>
            {loading ? <SkeletonLine className="quota-skeleton-label" /> : t(value?.label)}
          </strong>
        </div>
      </header>
      <div className="account-quota-summary">
        {reset && (
          <p className="account-quota-reset">
            {loading ? (
              <SkeletonLine className="quota-skeleton-reset" />
            ) : (
              `${value?.resetEstimated ? t('预计') : ''}${resetCountdown(value!.resetAt!, now)}`
            )}
          </p>
        )}
        {metrics.length > 0 && (
          <dl className="account-quota-details">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <dt>
                  {loading ? <SkeletonLine className="quota-skeleton-label" /> : t(metric.label)}
                </dt>
                <dd>
                  {loading ? (
                    <SkeletonLine className="quota-skeleton-number" />
                  ) : (
                    quantity(metric.amount, value!.unit)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <span className="account-quota-remaining">
          {loading ? (
            <SkeletonLine />
          ) : value?.unlimited ? (
            t('不限量')
          ) : value?.remainingPercent !== null && value?.remainingPercent !== undefined ? (
            t('剩余 {0}%', [quotaPercentage(value.remainingPercent)])
          ) : value ? (
            `${value.advisory ? t('参考可用') : t('剩余')} ${quantity(value.remaining, value.unit)}`
          ) : null}
        </span>
      </div>
      <InterviewReveal resizeKey={state ?? ''}>
        {state ? (
          <span className={`account-quota-state${!loading && value?.state === 'restricted' ? ' danger-text' : ''}`}>
            {loading ? <SkeletonLine className="quota-skeleton-hint" /> : t(state)}
          </span>
        ) : null}
      </InterviewReveal>
      <InterviewReveal>
        {value?.unit === 'unknown' ? (
          <p>{loading ? <SkeletonLine /> : t('官方未提供明确的计量单位，具体用量请查看官方页面。')}</p>
        ) : null}
      </InterviewReveal>
      {progress &&
        (loading ? (
          <SkeletonLine className="quota-skeleton-progress" />
        ) : (
          <div
            className="account-quota-progress"
            role="progressbar"
            aria-label={t('{0}剩余比例', [t(value?.label)])}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value?.remainingPercent ?? undefined}
          >
            <span style={{ width: `${value?.remainingPercent}%` }} />
          </div>
        ))}
    </article>
  );
}
function QuotaSkeleton({
  usage,
  now,
}: {
  usage: AccountUsage | null;
  now: number;
}) {
  const count =
    usage?.status === 'available' && usage.quotas.length
      ? usage.quotas.length
      : 1;
  return (
    <div role="status" aria-label={t('正在读取账户额度')}>
      <span className="sr-only">{t('正在读取账户额度…')}</span>
      <div className="account-quota-list" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <Quota key={index} loading now={now} />
        ))}
      </div>
    </div>
  );
}
export function UsagePanel({ service }: { service?: AccountService } = {}) {
  const state = useChatConnection();
  const [now, setNow] = useState(Date.now);
  const session = useAuth((value) => value.session);
  const account = service ?? (session?.mode === 'chatgpt' || session?.mode === 'copilot' ? session.mode : undefined);
  const copilot = account === 'copilot';
  const live = !!account;
  const details = service && service !== session?.mode
    ? state.savedUsage[service] ?? { usage: null, usageError: null, loadingUsage: false } : state;
  const usage = details.usage?.provider === account ? details.usage : null;
  const refreshUsage = () => service && service !== session?.mode
    ? state.refreshSavedUsage(service) : state.refreshUsage();
  const unavailable = copilot
    ? t('账户额度暂不可用，请刷新或查看 GitHub 官方用量。')
    : t('ChatGPT 账户额度暂不可用，请刷新或查看官方用量。');
  const error = details.usageError && t(details.usageError);
  const available = usage?.status === 'available' && usage.quotas.length > 0;
  const quotaBody = useRef<HTMLDivElement>(null);
  const quotaView = !live ? 'disconnected'
    : details.loadingUsage ? 'loading'
    : available ? 'available'
    : error === unavailable ? 'empty'
    : 'unavailable';
  useHeightTransition(quotaView, () => [quotaBody.current]);
  useEffect(() => {
    setNow(Date.now());
    if (details.loadingUsage || !usage?.quotas.some((quota) => quota.resetAt !== null)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [usage, details.loadingUsage]);
  const usageUrl = copilot
    ? 'https://github.com/settings/copilot'
    : 'https://chatgpt.com/settings/usage';
  useEffect(() => {
    if (!service && live) void state.refreshUsage();
  }, [service, session?.mode, session?.user.id]);
  return (
    <section
      className="usage-panel settings-usage"
      aria-label={t('账户额度')}
      aria-busy={live && details.loadingUsage}
    >
      <div className="account-usage-card">
        <header>
          <div className="account-quota-heading">
            <strong>
              {live
                ? details.loadingUsage
                  ? <span className="quota-skeleton-line quota-skeleton-plan" aria-hidden="true" />
                  : t('{0}额度', [t((copilot ? planNames : chatGPTPlans)[usage?.plan ?? 'unknown'] ??
                    (copilot ? 'GitHub Copilot' : 'ChatGPT'))])
                : t('账户额度')}
            </strong>
          </div>
          {live && (
            <Button
              variant="ghost"
              disabled={details.loadingUsage}
              onClick={() => void refreshUsage()}
              aria-label={t('刷新账户额度')}
            >
              <Refresh size={16} />
              {details.loadingUsage ? t('刷新中…') : t('刷新')}
            </Button>
          )}
        </header>
        <div ref={quotaBody} className="quota-body">
          {quotaView === 'disconnected' ? (
            <p>{t('连接模型服务后可查看账户用量。')}</p>
          ) : quotaView === 'loading' ? (
            <QuotaSkeleton usage={usage} now={now} />
          ) : available ? (
            <div className="account-quota-list">
              {orderedAccountQuotas(usage.quotas).map((quota, index) => (
                <Quota key={`${quota.id}-${index}`} value={quota} now={now} />
              ))}
            </div>
          ) : quotaView === 'unavailable' ? <p>{unavailable}</p> : null}
        </div>
      </div>
      {live && (
        <footer className="usage-footer">
          <div className="account-usage-note">
            <small>
              {copilot
                ? t('由 GitHub 返回账户额度，更新可能延迟；以官方页面为准。')
                : t('由当前 ChatGPT 登录账户返回额度；以官方页面为准。')}
            </small>
          </div>
          <a
            className="account-usage-link"
            href={usageUrl}
            onClick={(event) => {
              event.preventDefault();
              void openChatLink(usageUrl).catch(() => {});
            }}
          >
            {t('查看官方用量')}
          </a>
        </footer>
      )}
      <InterviewReveal>
        {live && error ? (
          <p className="usage-error" role="alert">
            {error}
          </p>
        ) : null}
      </InterviewReveal>
    </section>
  );
}
