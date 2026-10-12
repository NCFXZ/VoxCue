import chatGPTLogo from '../assets/chatgpt.svg';
import { AppLogo } from './AppLogo';
// A message retains its provider identity when the selected model changes.
const providers: Record<string, { name: string; logo?: string }> = {
  chatgpt: { name: 'ChatGPT', logo: chatGPTLogo },
  mock: { name: 'Mock' },
};
export function ProviderIdentity({ provider, detail }: { provider: string; detail?: string }) {
  const identity = providers[provider] ?? { name: provider };
  return (
    <>
      <span className="ai-avatar provider-avatar">
        {identity.logo ? (
          <img src={identity.logo} alt="" aria-hidden="true" />
        ) : (
          <AppLogo size={18} />
        )}
      </span>
      <strong>{identity.name}</strong>
      {detail && <span>{detail}</span>}
    </>
  );
}
