import type { AIService, AuthSession, SignOutResult } from '../../electron/contracts/auth';
import { isApiProvider } from '../../electron/contracts/apiConnections';
export interface AuthenticationService {
  session(service?: AuthSession['mode'] | 'startup'): Promise<AuthSession | null>;
  signIn(service?: AIService): Promise<AuthSession>;
  cancel(): Promise<void>;
  signOut(): Promise<SignOutResult>;
}
export const authentication: AuthenticationService = {
  session: async (service) => window.desktop?.authSession(service) ?? null,
  async signIn(service = 'chatgpt') {
    if (!window.desktop) throw new Error('请在桌面应用中登录模型服务。');
    if (isApiProvider(service)) throw new Error('请先添加 API 密钥。');
    return service === 'copilot'
      ? window.desktop.signInWithCopilot()
      : window.desktop.signInWithChatGPT();
  },
  cancel: async () => {
    await window.desktop?.cancelSignIn();
  },
  signOut: async () => (window.desktop ? window.desktop.signOut() : { warning: null }),
};
