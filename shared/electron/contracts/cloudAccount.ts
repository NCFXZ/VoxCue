export const CLOUD_PASSWORD_MIN = 8;
export const CLOUD_PASSWORD_MAX = 128;
/** Preserve spaces and symbols; reject malformed UTF-16 rather than silently replacing bytes. */
export function normalizeCloudPassword(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    Array.from(value).some(
      (c) => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff,
    )
  )
    return;
  return value.normalize('NFC');
}
export function validCloudEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_{}|~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      email,
    )
  )
    return false;
  const [local, domain] = email.split('@');
  return (
    local.length <= 64 &&
    !local.startsWith('.') &&
    !local.endsWith('.') &&
    !local.includes('..') &&
    domain.split('.').every((label) => label.length <= 63)
  );
}
export interface CloudUser {
  id: string;
  email: string;
  createdAt: number;
}
export interface CloudAccountState {
  configured: boolean;
  user: CloudUser | null;
  verified: boolean;
}
export interface CloudSession {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}
export type CloudAccountCall =
  | { action: 'status' | 'logout' | 'sessions' }
  | { action: 'delete'; password: string; confirm: 'DELETE' }
  | { action: 'code'; email: string; purpose: 'register' | 'reset' }
  | { action: 'login'; email: string; password: string }
  | {
      action: 'register' | 'reset';
      email: string;
      password: string;
      code: string;
      challengeId: string;
    }
  | { action: 'revoke'; sessionId: string };
export type CloudAccountResult =
  | {
      ok: true;
      state: CloudAccountState;
      sessions?: CloudSession[];
      challenge?: { id: string; expiresInSeconds: number; retryAfterSeconds: number };
      message?: string;
    }
  | { ok: false; error: string; retryAfterSeconds?: number; state: CloudAccountState };
