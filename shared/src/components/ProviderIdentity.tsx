import { t } from '../i18n';
import chatGPTLogo from '../assets/chatgpt.svg?inline';
import copilotLogo from '../assets/copilot.svg?inline';
import { MessageSquare } from './icons';
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
  const logo =
    info.id === 'chatgpt' ? chatGPTLogo : info.id === 'copilot' ? copilotLogo : undefined;
  return (
    <>
      <span className="ai-avatar provider-avatar">
        {logo ? (
          <img className="service-brand-icon" src={logo} alt="" aria-hidden="true" />
        ) : (
          <MessageSquare size={18} />
        )}
      </span>
      <strong className="provider-name">{name}</strong>
      {detail && <span>{detail}</span>}
    </>
  );
}
