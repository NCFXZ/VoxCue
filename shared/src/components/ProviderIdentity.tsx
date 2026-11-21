import { t } from '../i18n';
import { ProviderIcon } from './ProviderIcon';
import type { ModelProvider } from '../../electron/contracts/chat';
import { providerInfo } from '../services/providers';
// A message retains its provider identity when the selected model changes.
export function ProviderIdentity({
  provider,
  detail,
}: {
  provider: string | ModelProvider;
  detail?: string;
}) {
  const info = providerInfo(provider);
  const name = info.id === 'unknown' ? t('服务来源未记录') : info.name;
  return (
    <>
      <span className="provider-avatar">
        <ProviderIcon provider={info.id} />
      </span>
      <strong className="provider-name">{name}</strong>
      {detail && <span>{detail}</span>}
    </>
  );
}
