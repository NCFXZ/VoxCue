import { isApiProvider, type ApiProvider } from '../../electron/contracts/apiConnections';
import { MessageSquare } from './icons';
import openai from '../assets/chatgpt.svg?inline';
import copilot from '../assets/copilot.svg?inline';
import claude from '../assets/ai/claude.svg?inline';
import gemini from '../assets/ai/gemini.svg?inline';
import qwen from '../assets/ai/qwen.svg?inline';
import deepseek from '../assets/ai/deepseek.svg?inline';
import kimi from '../assets/ai/kimi.svg?inline';
import zhipu from '../assets/ai/zhipu.svg?inline';
import doubao from '../assets/ai/doubao.svg?inline';

const icons: Record<ApiProvider | 'chatgpt' | 'copilot', string> = {
  chatgpt: openai, copilot, openai, anthropic: claude, gemini, qwen, deepseek, kimi, glm: zhipu, doubao,
};

export function ProviderIcon({ provider }: { provider: string }) {
  if (provider !== 'chatgpt' && provider !== 'copilot' && !isApiProvider(provider))
    return <MessageSquare size={18} />;
  return <img className="service-brand-icon" src={icons[provider]} alt="" aria-hidden="true" />;
}
