import { t, uiLocale } from '../i18n';
import { useEffect, useState } from 'react';
import type { AccountQuota, AccountUsage } from '../../electron/contracts/accountUsage';
import { useChatConnection } from '../stores/chatConnection';
import { useAuth } from '../stores/auth';
import { openChatLink } from '../services/chat';
import { Button } from './ui/button';
import { Refresh } from './icons';

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
  percentage = false,
  now,
}: {
  value?: AccountQuota;
  loading?: boolean;
  percentage?: boolean;
  now: number;
}) {
  const state =
    value?.state === 'exhausted'
      ? value.additionalUsageAllowed
        ? '包含额度已用尽，可继续额外用量'
        : '额度已用尽'
      : value?.state === 'restricted'
        ? '当前账户访问受限'
        : value?.state === 'unavailable'
          ? '额度暂不可用'
          : value?.advisory
            ? '服务返回的参考余额'
            : null;
  const reset = value ? value.resetAt !== null : percentage;
  const metrics: { label: string; amount: number | null }[] = reset
    ? []
    : value
      ? [
          ...(value.used !== null && value.unit !== 'percent'
            ? [{ label: '已用', amount: value.used }]
            : []),
          ...(value.remaining !== null && value.remainingPercent !== null
            ? [{ label: '剩余', amount: value.remaining }]
            : []),
        ]
      : percentage
        ? []
        : ['已用', '剩余'].map((label) => ({ label, amount: null }));
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
            t('剩余 {0}%', [
              value.remainingPercent.toLocaleString(uiLocale(), { maximumFractionDigits: 2 }),
            ])
          ) : value ? (
            `${value.advisory ? t('参考可用') : t('剩余')} ${quantity(value.remaining, value.unit)}`
          ) : null}
        </span>
      </div>
      {state && (
        <span
          className={`account-quota-state${
            !loading && (value?.state === 'exhausted' || value?.state === 'restricted')
              ? ' danger-text'
              : ''
          }`}
        >
          {loading ? <SkeletonLine className="quota-skeleton-hint" /> : t(state)}
        </span>
      )}
      {value?.unit === 'unknown' && (
        <p>
          {loading ? <SkeletonLine /> : t('官方未提供明确的计量单位，具体用量请查看官方页面。')}
        </p>
      )}
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
  percentage,
  now,
}: {
  usage: AccountUsage | null;
  percentage: boolean;
  now: number;
}) {
  const quotas = usage?.status === 'available' && usage.quotas.length ? usage.quotas : [undefined];
  return (
    <div role="status" aria-label={t('正在读取账户额度')}>
      <span className="sr-only">{t('正在读取账户额度…')}</span>
      <div className="account-quota-list" aria-hidden="true">
        {quotas.map((value, index) => (
          <Quota key={index} value={value} loading percentage={percentage} now={now} />
        ))}
      </div>
    </div>
  );
}
export function UsagePanel() {
  const state = useChatConnection();
  const [now, setNow] = useState(Date.now);
  const session = useAuth((value) => value.session);
  const copilot = session?.mode === 'copilot';
  const live = session?.mode === 'chatgpt' || copilot;
  const usage = state.usage?.provider === session?.mode ? state.usage : null;
  useEffect(() => {
    setNow(Date.now());
    if (state.loadingUsage || !usage?.quotas.some((quota) => quota.resetAt !== null)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [usage, state.loadingUsage]);
  const usageUrl = copilot
    ? 'https://github.com/settings/copilot'
    : 'https://chatgpt.com/settings/usage';
  useEffect(() => {
    if (live) void state.refreshUsage();
  }, [session?.mode, session?.user.id]);
  return (
    <section
      className="usage-panel settings-usage"
      aria-label={t('账户额度')}
      aria-busy={live && state.loadingUsage}
    >
      <header>
        <div className="account-quota-heading">
          <strong>{t('账户额度')}</strong>
          {live &&
            (state.loadingUsage ? (
              <span className="quota-skeleton-line quota-skeleton-plan" aria-hidden="true" />
            ) : (
              usage && (
                <span className="account-quota-plan">
                  {t(
                    (copilot ? planNames : chatGPTPlans)[usage.plan] ??
                      (copilot ? 'GitHub Copilot' : 'ChatGPT'),
                  )}
                </span>
              )
            ))}
        </div>
        {live && (
          <Button
            variant="ghost"
            disabled={state.loadingUsage}
            onClick={() => void state.refreshUsage()}
            aria-label={t('刷新账户额度')}
          >
            <Refresh size={16} />
            {state.loadingUsage ? t('刷新中…') : t('刷新')}
          </Button>
        )}
      </header>
      {!live ? (
        <p>{t('连接模型服务后可查看账户用量。')}</p>
      ) : state.loadingUsage ? (
        <QuotaSkeleton usage={usage} percentage={!copilot} now={now} />
      ) : usage?.status === 'available' && usage.quotas.length ? (
        <div className="account-quota-list">
          {usage.quotas.map((quota, index) => (
            <Quota key={`${quota.id}-${index}`} value={quota} now={now} />
          ))}
        </div>
      ) : (
        <p>
          {copilot
            ? t('账户额度暂不可用，请刷新或查看 GitHub 官方用量。')
            : t('ChatGPT 账户额度暂不可用，请刷新或查看官方用量。')}
        </p>
      )}
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
      {live && state.usageError && (
        <p className="usage-error" role="alert">
          {t(state.usageError)}
        </p>
      )}
    </section>
  );
}
