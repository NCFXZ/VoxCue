import { create } from 'zustand';
import { authentication } from '../services/auth';
import type { AuthSession } from '../../electron/contracts/auth';
interface AuthState {
  session: AuthSession | null;
  loading: boolean;
  waiting: boolean;
  error: string | null;
  notice: string | null;
  load(): Promise<void>;
  signIn(): Promise<void>;
  cancel(): Promise<void>;
  demo(): Promise<void>;
  signOut(): Promise<boolean>;
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : '登录操作失败，请重试。';
export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  loading: true,
  waiting: false,
  error: null,
  notice: null,
  async load() {
    try {
      set({ session: await authentication.session(), error: null });
    } catch {
      set({ error: '无法读取本地登录信息，请检查应用数据后重试。' });
    } finally {
      set({ loading: false });
    }
  },
  async signIn() {
    if (get().waiting) return;
    set({ waiting: true, error: null, notice: null });
    try {
      set({ session: await authentication.signIn() });
    } catch (error) {
      set({ error: message(error) });
    } finally {
      set({ waiting: false });
    }
  },
  async cancel() {
    try {
      await authentication.cancel();
    } catch {
      set({ error: '取消登录失败，请稍后重试。' });
    }
  },
  async demo() {
    if (get().waiting) return;
    set({ waiting: true, error: null, notice: null });
    try {
      set({ session: await authentication.demo() });
    } catch (error) {
      set({ error: message(error) });
    } finally {
      set({ waiting: false });
    }
  },
  async signOut() {
    if (get().waiting) return false;
    set({ waiting: true, error: null });
    try {
      const result = await authentication.signOut();
      set({ session: null, notice: result.warning });
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    } finally {
      set({ waiting: false });
    }
  },
}));
