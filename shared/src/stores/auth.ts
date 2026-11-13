import { create } from 'zustand';
import { authentication } from '../services/auth';
import { useChatConnection } from './chatConnection';
import {
  providerCredentialMessages,
  providerCredentialStatus,
  type AIService,
  type AuthSession,
} from '../../electron/contracts/auth';
interface AuthState {
  session: AuthSession | null;
  resolved: boolean;
  startupChecked: boolean;
  loading: boolean;
  waiting: boolean;
  signingIn: AIService | null;
  error: string | null;
  connectionNotice: string | null;
  notice: string | null;
  restoreOnStartup(): Promise<void>;
  ensure(): Promise<void>;
  connect(service: AIService): Promise<void>;
  cancel(): Promise<void>;
  signOut(): Promise<boolean>;
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : '登录操作失败，请重试。';
function failure(error: unknown, fallback?: string) {
  const detail = message(error);
  for (const service of ['chatgpt', 'copilot'] as const) {
    if (Object.values(providerCredentialMessages[service]).includes(detail))
      return { error: providerCredentialStatus[service], connectionNotice: detail };
  }
  return { error: fallback ?? detail, connectionNotice: null };
}
export const useAuth = create<AuthState>((set, get) => {
  let restoring: Promise<void> | undefined;
  let startup: Promise<void> | undefined;
  const applySession = async (session: AuthSession | null) => {
    set({ session, resolved: true, error: null, connectionNotice: null });
    await useChatConnection
      .getState()
      .load(!!session && session.mode !== 'demo', false, session?.mode === 'demo');
  };
  return {
    session: null,
    resolved: false,
    startupChecked: false,
    loading: false,
    waiting: false,
    signingIn: null,
    error: null,
    connectionNotice: null,
    notice: null,
    async restoreOnStartup() {
      if (startup) return startup;
      if (get().startupChecked || get().resolved || get().waiting) return;
      set({ loading: true });
      startup = authentication.session('startup')
        .then(async (session) => {
          if (session) await applySession(session);
        })
        .catch((error) => {
          set(failure(error, '无法读取本地登录信息，请检查应用数据后重试。'));
        })
        .finally(() => {
          startup = undefined;
          set({ loading: false, startupChecked: true });
        });
      return startup;
    },
    async ensure() {
      if (startup) await startup;
      if (restoring) return restoring;
      if (get().resolved || get().waiting) return;
      set({ loading: true });
      restoring = authentication
        .session()
        .then(applySession)
        .catch((error) => {
          set(failure(error, '无法读取本地登录信息，请检查应用数据后重试。'));
        })
        .finally(() => {
          restoring = undefined;
          set({ loading: false });
        });
      return restoring;
    },
    async connect(service) {
      if (get().waiting || get().loading) return;
      set({ waiting: true, error: null, connectionNotice: null, notice: null });
      try {
        let session = await authentication.session(service);
        if (!session) {
          set({ signingIn: service });
          session = await authentication.signIn(service);
        }
        await applySession(session);
      } catch (error) {
        set(failure(error));
      } finally {
        set({ waiting: false, signingIn: null });
      }
    },
    async cancel() {
      try {
        await authentication.cancel();
      } catch {
        set({ error: '取消登录失败，请稍后重试。', connectionNotice: null });
      }
    },
    async signOut() {
      if (get().waiting || get().loading) return false;
      set({ waiting: true, error: null, connectionNotice: null });
      try {
        const result = await authentication.signOut();
        await applySession(null);
        set({ notice: result.warning });
        return true;
      } catch (error) {
        set({ error: message(error) });
        return false;
      } finally {
        set({ waiting: false });
      }
    },
  };
});
