import type { ApiProvider } from './apiConnections';
// Public IPC contract. Credentials must never be added to these renderer-facing types.
export interface AuthUser {
  id: string;
  name: string;
  email: string;
}
export type AccountService = 'chatgpt' | 'copilot';
export type AIService = AccountService | ApiProvider;
export type ProviderCredentialReason = 'denied' | 'unavailable';
export const providerCredentialStatus: Record<AccountService, string> = {
  chatgpt: '本次启动已停止访问 ChatGPT 的系统凭据。请重新启动 VoxCue 后重试。',
  copilot: '本次启动已停止访问 GitHub Copilot 的系统凭据。请重新启动 VoxCue 后重试。',
};
export const providerCredentialMessages: Record<
  AccountService,
  Record<ProviderCredentialReason, string>
> = {
  chatgpt: {
    denied: 'ChatGPT 连接被拒绝，请重启 VoxCue 后重试。',
    unavailable: 'ChatGPT 连接失败，请重启 VoxCue 后重试。',
  },
  copilot: {
    denied: 'GitHub Copilot 连接被拒绝，请重启 VoxCue 后重试。',
    unavailable: 'GitHub Copilot 连接失败，请重启 VoxCue 后重试。',
  },
};
export interface AuthSession {
  mode: AIService | 'demo';
  user: AuthUser;
  expiresAt: number | null;
}
export interface SignOutResult {
  warning: string | null;
}
