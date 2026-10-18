import type { AIService, AuthSession, SignOutResult } from '../../electron/contracts/auth';
export interface AuthenticationService {
  session(): Promise<AuthSession | null>;
  signIn(service?: AIService): Promise<AuthSession>;
  cancel(): Promise<void>;
  demo(): Promise<AuthSession>;
  signOut(): Promise<SignOutResult>;
}
export const authentication: AuthenticationService = {
  session: async () => window.desktop?.authSession() ?? null,
  async signIn() {
    if (!window.desktop) throw new Error('请在桌面应用中登录模型服务。');
    return window.desktop.signInWithChatGPT();
  },
  cancel: async () => {
    await window.desktop?.cancelSignIn();
  },
  demo: async () =>
    window.desktop
      ? window.desktop.enterDemo()
      : { mode: 'demo', user: { id: 'local-demo', name: '本地用户', email: '' }, expiresAt: null },
  signOut: async () => (window.desktop ? window.desktop.signOut() : { warning: null }),
};
