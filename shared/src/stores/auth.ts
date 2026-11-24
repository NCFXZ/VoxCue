import { create } from 'zustand';
import { authentication } from '../services/auth';
import { startServiceModelSwitch } from '../services/serviceModelPreferences';
import { useChatConnection } from './chatConnection';
import {
  providerCredentialMessages,
  providerCredentialStatus,
  type AccountService,
  type AIService,
  type AuthSession,
  type AuthUser,
} from '../../electron/contracts/auth';
interface AuthState {
  session: AuthSession | null;
  accounts: AccountService[];
  accountUsers: Partial<Record<AccountService, Pick<AuthUser, 'name' | 'email'>>>;
  accountsLoaded: boolean;
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
  loadAccounts(): Promise<void>;
  connect(service: AIService): Promise<void>;
  disable(): Promise<boolean>;
  cancel(): Promise<void>;
  signOut(service?: AccountService): Promise<boolean>;
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
  let accountRevision = 0;
  let accountRequest = 0;
  const applySession = async (session: AuthSession | null) => {
    const mode = session?.mode;
    set({
      session, resolved: true, error: null, connectionNotice: null,
      ...(session && (mode === 'chatgpt' || mode === 'copilot')
        ? { accounts: [...get().accounts.filter((item) => item !== mode), mode],
            accountUsers: { ...get().accountUsers, [mode]: { name: session.user.name, email: session.user.email } },
          } : {}),
    });
    await useChatConnection
      .getState()
      .load(!!session && session.mode !== 'demo', false, session?.mode);
  };
  return {
    session: null,
    accounts: [],
    accountUsers: {},
    accountsLoaded: false,
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
    async loadAccounts() {
      const revision = accountRevision;
      const request = ++accountRequest;
      try {
        const connections = await authentication.accounts();
        if (revision === accountRevision && request === accountRequest)
          set({ accounts: connections.map(entry => entry.service),
            accountUsers: Object.fromEntries(connections.map(({ service, name, email }) => [service, { name, email }])),
            accountsLoaded: true });
      } catch (error) {
        if (revision === accountRevision && request === accountRequest)
          set(failure(error, '无法读取本地登录信息，请检查应用数据后重试。'));
      }
    },
    async connect(service) {
      if (get().waiting || get().loading) return;
      accountRevision++;
      set({ waiting: true, error: null, connectionNotice: null, notice: null });
      try {
        let session = await authentication.session(service);
        if (!session) {
          set({ signingIn: service });
          session = await authentication.signIn(service);
        }
        if (session && session.mode !== 'demo' && session.mode !== get().session?.mode)
          startServiceModelSwitch(session.mode);
        await applySession(session);
        await get().loadAccounts();
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
    async disable() {
      if (get().waiting || get().loading) return false;
      accountRevision++;
      set({ waiting: true, error: null, connectionNotice: null, notice: null });
      try {
        await authentication.disable();
        await applySession(null);
        await get().loadAccounts();
        return true;
      } catch (error) {
        set({ error: message(error) });
        return false;
      } finally {
        set({ waiting: false });
      }
    },
    async signOut(service) {
      if (get().waiting || get().loading) return false;
      accountRevision++;
      set({ waiting: true, error: null, connectionNotice: null });
      try {
        const target = service ?? get().session?.mode;
        const result = await authentication.signOut(service);
        if (target === 'chatgpt' || target === 'copilot') useChatConnection.getState().clearSavedUsage(target);
        if (!service || get().session?.mode === service) await applySession(null);
        const accountUsers = { ...get().accountUsers };
        if (target === 'chatgpt' || target === 'copilot') delete accountUsers[target];
        set({ accounts: get().accounts.filter((item) => item !== target), accountUsers });
        await get().loadAccounts();
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
