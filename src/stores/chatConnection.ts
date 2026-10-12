import { create } from 'zustand';
import type { ChatModel, AppUsage } from '../../electron/contracts/chat';
import { emptyUsage } from '../../electron/contracts/chat';
import { chatModels } from '../services/chatOptions';
import { failureText } from '../services/chat';
interface State {
  live: boolean;
  models: ChatModel[];
  usage: AppUsage;
  loading: boolean;
  error: string | null;
  usageError: string | null;
  load(live: boolean, force?: boolean): Promise<void>;
  refreshUsage(): Promise<void>;
}
let generation = 0;
export const useChatConnection = create<State>((set, get) => ({
  live: false,
  models: [...chatModels],
  usage: emptyUsage(),
  loading: false,
  error: null,
  usageError: null,
  async load(live, force = false) {
    const current = ++generation;
    if (!live) {
      set({
        live: false,
        models: [...chatModels],
        usage: emptyUsage(),
        loading: false,
        error: null,
        usageError: null,
      });
      return;
    }
    set({ live: true, loading: true, error: null, models: [], usage: emptyUsage() });
    try {
      if (!window.desktop) throw new Error('请在桌面应用中连接 ChatGPT。');
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
        await get().refreshUsage();
      }
    }
  },
  async refreshUsage() {
    if (!get().live || !window.desktop) return;
    const current = generation;
    try {
      const result = await window.desktop.chatUsage();
      if (current !== generation) return;
      if (!result.ok) throw new Error(failureText(result.error));
      set({ usage: result.usage, usageError: null });
    } catch (error) {
      if (current === generation)
        set({ usageError: error instanceof Error ? error.message : '用量暂不可用。' });
    }
  },
}));
