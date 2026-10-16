// Public IPC contract. Credentials must never be added to these renderer-facing types.
export interface AuthUser {
  id: string;
  name: string;
  email: string;
}
export type AIService = 'chatgpt' | 'copilot';
export interface AuthSession {
  mode: AIService | 'demo';
  user: AuthUser;
  expiresAt: number | null;
}
export interface SignOutResult {
  warning: string | null;
}
