import type { AccountUsage } from '../../electron/contracts/accountUsage';
import { apiProviders, type ApiBalance, type ApiProvider } from '../../electron/contracts/apiConnections';
import { Fragment } from 'react';
import { t } from '../i18n';
import { accountUsageSummaryParts } from '../services/accountUsageSummary';

export function InterviewApiBillingRow({
  provider,
  balances,
}: {
  provider: ApiProvider;
  balances?: readonly ApiBalance[] | null;
}) {
  const name = t(apiProviders[provider].name).replace(/ API$/, '') + ' API';
  let label = t('API计费');
  if (balances?.length) {
    const nonzero = balances.filter(({ total }) => Number(total) !== 0);
    const amount = (nonzero.length ? nonzero : balances)
      .map(({ currency, total }) => `${total} ${currency}`).join(' · ');
    label = t('剩余 {0}', [amount]);
  }
  return (
    <div>
      <dt>{name}</dt>
      <dd aria-live={provider === 'deepseek' ? 'polite' : undefined}>{label}</dd>
    </div>
  );
}

export function AccountUsageSummary({
  usage,
  showHeading = true,
  mode = 'summary',
}: {
  usage: AccountUsage | null;
  showHeading?: boolean;
  mode?: 'summary' | 'all' | 'sidebar';
}) {
  const summary = accountUsageSummaryParts(usage, mode);
  if (!summary) return t('AI 服务用量暂不可用');
  return (
    <span
      className={`account-usage-summary${summary.low && !summary.inline ? ' is-low' : ''}${summary.inline ? ' is-inline' : ''}${mode === 'all' ? ' is-all' : ''}${mode === 'sidebar' ? ' is-sidebar' : ''}`}
    >
      {showHeading && (
        <>
          <span className="account-usage-heading">
            {summary.low && !summary.inline ? summary.title : summary.provider}
          </span>{' '}
        </>
      )}
      <span className="account-usage-values">
        {summary.values.map((value, index) => (
          <Fragment key={index}>
            {index > 0 ? ' · ' : null}
            <span className={`account-usage-value${value.low && !value.percent ? ' is-low' : ''}`}>
              {value.percent ? (
                <>
                  {value.text.slice(0, value.text.indexOf(value.percent))}
                  <span className="account-usage-percent is-low">{value.percent}</span>
                  {value.text.slice(value.text.indexOf(value.percent) + value.percent.length)}
                </>
              ) : (
                value.text
              )}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
