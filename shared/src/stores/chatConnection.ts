import { create } from 'zustand';
import type { ChatModel } from '../../electron/contracts/chat';
import type { AccountUsage } from '../../electron/contracts/accountUsage';
import { chatModels } from '../services/chatOptions';
import { failureText } from '../services/chat';
interface State {
  live: boolean;
  models: ChatModel[];
  usage: AccountUsage | null;
  loading: boolean;
  error: string | null;
  usageError: string | null;
  loadingUsage: boolean;
  usageLoaded: boolean;
  load(live: boolean, force?: boolean, demo?: boolean): Promise<void>;
  refreshUsage(scope?: 'chat' | 'interview'): Promise<void>;
  watchUsage(scope?: 'chat' | 'interview'): () => void;
}
let generation = 0;
let usageRevision = 0;
export const useChatConnection = create<State>((set, get) => ({
  live: false,
  models: [],
  usage: null,
  loading: false,
  error: null,
  usageError: null,
  loadingUsage: false,
  usageLoaded: false,
  async load(live, force = false, demo = false) {
    const current = ++generation;
    const revision = ++usageRevision;
    set({ loadingUsage: false, usageLoaded: false });
    if (!live) {
      set({
        live: false,
        models: demo ? [...chatModels] : [],
        usage: null,
        loading: false,
        error: null,
        usageError: null,
      });
      return;
    }
    set({ live: true, loading: true, error: null, usageError: null, models: [], usage: null });
    try {
      if (!window.desktop) throw new Error('请在桌面应用中连接模型服务。');
      const result = await window.desktop.chatModels(force);
      if (current !== generation) return;
      if (!result.ok) throw new Error(failureText(result.error));
      set({ models: result.models });
    } catch (error) {
      if (current === generation)
        set({ error: error instanceof Error ? error.message : '模型加载失败，请重试。' });
    } finally {
      if (current === generation) {
        set({ loading: false });
        // A first message can use the models while the sidebar reads the quota.
        if (revision === usageRevision) void get().refreshUsage();
      }
    }
  },
  watchUsage(scope = 'chat') {
    const refresh = () => void get().refreshUsage(scope);
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      ++usageRevision;
      set({ usage: null, loadingUsage: false, usageLoaded: false, usageError: null });
    };
  },
  async refreshUsage(scope = 'chat') {
    if ((scope === 'chat' && !get().live) || !window.desktop || get().loadingUsage) return;
    const current = generation;
    const revision = ++usageRevision;
    // Background reads keep the last result until success or failure replaces it.
    set({ loadingUsage: true });
    try {
      const result = await (scope === 'interview'
        ? window.desktop.interviewAccountUsage()
        : window.desktop.chatAccountUsage());
      if (current !== generation || revision !== usageRevision) return;
      if (!result.ok) throw new Error(failureText(result.error));
      set({ usage: result.usage, usageError: null });
    } catch (error) {
      if (current === generation && revision === usageRevision)
        set({ usage: null, usageError: error instanceof Error ? error.message : '用量暂不可用。' });
    } finally {
      if (current === generation && revision === usageRevision)
        set({ loadingUsage: false, usageLoaded: true });
    }
  },
}));
