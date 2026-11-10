import { create } from 'zustand';
import {
  defaultShortcuts,
  type ShortcutSettingsCall,
  type ShortcutSettingsResult,
  type ShortcutSettingsState,
} from '../../electron/contracts/shortcuts';

export const useShortcuts = create<{
  state: ShortcutSettingsState;
  loading: boolean;
  error: string | null;
  call(call: ShortcutSettingsCall): Promise<ShortcutSettingsResult | undefined>;
  connect(): () => void;
}>((set, get) => {
  let pending = 0;
  const receive = (state: ShortcutSettingsState) => {
    if (state.revision >= get().state.revision) set({ state });
  };
  return {
    state: {
      revision: 0,
      bindings: defaultShortcuts(),
      conflicts: [],
      capturing: false,
      error: null,
    },
    loading: false,
    error: null,
    async call(call) {
      ++pending;
      set({ loading: true, ...(call.op === 'capture' && !call.active ? {} : { error: null }) });
      try {
        if (!window.desktop?.shortcutSettings) throw Error('快捷键设置需要桌面应用。');
        const result = await window.desktop.shortcutSettings(call);
        receive(result.state);
        return result;
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
              : '快捷键操作失败，请重试。',
        });
      } finally {
        set({ loading: --pending > 0 });
      }
    },
    connect() {
      if (!window.desktop?.shortcutSettings || !window.desktop.onShortcutSettings) return () => {};
      let active = true;
      const stop = window.desktop.onShortcutSettings((state) => {
        if (active) receive(state);
      });
      void window.desktop.shortcutSettings({ op: 'status' }).then(
        (result) => {
          if (active) receive(result.state);
        },
        () => {
          if (active) set({ error: '无法读取快捷键设置，请重试。' });
        },
      );
      return () => {
        active = false;
        stop();
      };
    },
  };
});
