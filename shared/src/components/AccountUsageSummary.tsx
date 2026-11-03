import type { AccountUsage } from '../../electron/contracts/accountUsage';
import { Fragment } from 'react';
import { t } from '../i18n';
import { accountUsageSummaryParts } from '../services/accountUsageSummary';

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
      className={`account-usage-summary${summary.low ? ' is-low' : ''}${mode === 'all' ? ' is-all' : ''}${mode === 'sidebar' ? ' is-sidebar' : ''}`}
    >
      {showHeading && (
        <>
          <span className="account-usage-heading">
            {summary.low ? summary.title : summary.provider}
          </span>{' '}
        </>
      )}
      <span className="account-usage-values">
        {summary.values.map((value, index) => (
          <Fragment key={index}>
            {index > 0 ? ' · ' : null}
            <span className={`account-usage-value${value.low ? ' is-low' : ''}`}>{value.text}</span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
