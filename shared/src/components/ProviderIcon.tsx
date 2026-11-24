import { isApiProvider, type ApiProvider } from '../../electron/contracts/apiConnections';
import { MessageSquare } from './icons';
import openai from '../assets/chatgpt.svg?inline';
import copilot from '../assets/copilot.svg?inline';
import deepseek from '../assets/ai/deepseek.svg?inline';

const icons: Record<ApiProvider | 'chatgpt' | 'copilot', string> = {
  chatgpt: openai, copilot, openai, deepseek,
};

export function ProviderIcon({ provider }: { provider: string }) {
  if (provider !== 'chatgpt' && provider !== 'copilot' && !isApiProvider(provider))
    return <MessageSquare size={18} />;
  return <img className="service-brand-icon" src={icons[provider]} alt="" aria-hidden="true" />;
}
