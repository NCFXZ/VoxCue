import { create } from 'zustand';
import { CHAT_MODEL_CATALOG_TTL_MS, type ChatModel } from '../../electron/contracts/chat';
import type { AccountService, AIService, AuthSession } from '../../electron/contracts/auth';
import { isApiProvider } from '../../electron/contracts/apiConnections';
import type { AccountUsage } from '../../electron/contracts/accountUsage';
import { chatModels } from '../services/chatOptions';
import { failureText } from '../services/chat';
interface UsageState {
  usage: AccountUsage | null;
  usageError: string | null;
  loadingUsage: boolean;
}
interface State extends UsageState {
  service: AIService | null;
  live: boolean;
  models: ChatModel[];
  loading: boolean;
  error: string | null;
  savedUsage: Partial<Record<AccountService, UsageState>>;
  usageLoaded: boolean;
  load(live: boolean, force?: boolean, mode?: AuthSession['mode']): Promise<void>;
  refreshUsage(scope?: 'chat' | 'interview'): Promise<void>;
  refreshSavedUsage(service: AccountService): Promise<void>;
  clearSavedUsage(service: AccountService): void;
  watchUsage(scope?: 'chat' | 'interview'): () => void;
}
let generation = 0;
let usageRevision = 0;
let catalogCheckedAt: number | undefined;
const savedUsageRevision = { chatgpt: 0, copilot: 0 };

async function readModels(force: boolean): Promise<Pick<State, 'models' | 'error'>> {
  try {
    if (!window.desktop) throw new Error('请在桌面应用中连接模型服务。');
    const result = await window.desktop.chatModels(force);
    if (!result.ok) throw new Error(failureText(result.error));
    return {
      models: result.models,
      error: result.models.length ? null : '服务商的目录未返回 VoxCue 支持的对话模型。请尝试刷新模型列表。',
    };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : '模型加载失败，请重试。',
    };
  }
}

export const useChatConnection = create<State>((set, get) => ({
  service: null,
  live: false,
  models: [],
  usage: null,
  loading: false,
  error: null,
  usageError: null,
  loadingUsage: false,
  usageLoaded: false,
  savedUsage: {},
  async load(live, force = false, mode) {
    const current = ++generation;
    const revision = ++usageRevision;
    catalogCheckedAt = undefined;
    set({ loadingUsage: false, usageLoaded: false, savedUsage: {} });
    if (!live) {
      set({
        service: null,
        live: false,
        models: mode === 'demo' ? [...chatModels] : [],
        usage: null,
        loading: false,
        error: null,
        usageError: null,
      });
      return;
    }
    // Refreshes keep their service. A switch publishes its identity together with the empty catalog.
    const service = mode && mode !== 'demo' ? mode : get().service;
    set({ service, live: true, loading: true, error: null, usageError: null, models: [], usage: null });
    const catalog = await readModels(force);
    if (current !== generation) return;
    catalogCheckedAt = Date.now();
    set({ ...catalog, loading: false });
    // A first message can use the models while the sidebar reads the quota.
    if (revision === usageRevision) void get().refreshUsage();
  },
  watchUsage(scope = 'chat') {
    let watching = true;
    let checkingCatalog = false;
    const refreshCatalog = async () => {
      if (
        !watching ||
        checkingCatalog ||
        !get().live ||
        get().loading ||
        catalogCheckedAt === undefined ||
        Date.now() - catalogCheckedAt < CHAT_MODEL_CATALOG_TTL_MS
      )
        return;
      checkingCatalog = true;
      const current = generation;
      try {
        const catalog = await readModels(true);
        if (watching && current === generation) {
          catalogCheckedAt = Date.now();
          set(catalog);
        }
      } finally {
        checkingCatalog = false;
      }
    };
    const refresh = () => {
      void get().refreshUsage(scope);
      if (scope === 'chat') void refreshCatalog();
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      watching = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      ++usageRevision;
      set({ usage: null, loadingUsage: false, usageLoaded: false, usageError: null });
    };
  },
  clearSavedUsage(service) {
    savedUsageRevision[service]++;
    const savedUsage = { ...get().savedUsage };
    delete savedUsage[service];
    set({ savedUsage });
  },
  async refreshSavedUsage(service) {
    if (get().savedUsage[service]?.loadingUsage || !window.desktop) return;
    const current = generation;
    const revision = ++savedUsageRevision[service];
    const apply = (value: Partial<UsageState>) => {
      if (current !== generation || revision !== savedUsageRevision[service]) return;
      set({ savedUsage: { ...get().savedUsage, [service]: {
        usage: null, usageError: null, loadingUsage: false, ...get().savedUsage[service], ...value,
      } } });
    };
    apply({ loadingUsage: true });
    try {
      const result = await window.desktop.chatAccountUsage(service);
      if (!result.ok) throw Error(failureText(result.error));
      if (result.usage && result.usage.provider !== service) throw Error('账户已变更，请重新刷新额度。');
      apply({ usage: result.usage, usageError: null });
    } catch (error) {
      apply({ usage: null, usageError: error instanceof Error ? error.message : '用量暂不可用。' });
    } finally { apply({ loadingUsage: false }); }
  },
  async refreshUsage(scope = 'chat') {
    if ((scope === 'chat' && !get().live) || !window.desktop || get().loadingUsage) return;
    if (isApiProvider(get().service)) {
      set({ usage: null, usageLoaded: true, usageError: null });
      return;
    }
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
