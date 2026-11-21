import type {
  ApiConnectionConfig,
  ApiKeyField,
  ApiKeyPromptCommand,
  ApiProvider,
} from '../../electron/contracts/apiConnections';
import { failureText } from './chat';

function desktop() {
  if (!window.desktop?.apiConnections) throw Error('请在桌面应用中连接模型服务。');
  return window.desktop;
}

export const apiConnections = {
  list: async () => desktop().apiConnections.list(),
  configure: (config: ApiConnectionConfig, requestId: string, field: ApiKeyField) =>
    desktop().apiConnections.configure(config, requestId, field),
  control: (requestId: string, command: ApiKeyPromptCommand) =>
    desktop().apiConnections.control(requestId, command),
  onTab: (callback: (requestId: string, backwards: boolean) => void) =>
    desktop().apiConnections.onTab(callback),
  remove: (provider: ApiProvider) => desktop().apiConnections.remove(provider),
  balance: (provider: ApiProvider) => desktop().apiConnections.balance(provider),
  open: (provider: ApiProvider, destination: 'keys' | 'billing') =>
    desktop().apiConnections.open(provider, destination),
  async localUsage() {
    const result = await desktop().chatUsage();
    if (!result.ok) throw Error(failureText(result.error));
    return result.usage;
  },
};
