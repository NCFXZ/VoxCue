import { create } from 'zustand';
import type {
  ComponentId,
  ComponentState,
  ComponentCall,
} from '../../electron/contracts/components';

interface ComponentsStore {
  state: ComponentState | null;
  error: string | null;
  connect(): () => void;
  run(call: ComponentCall): Promise<boolean>;
}
export const useComponents = create<ComponentsStore>((set, get) => {
  const receive = (state: ComponentState) => {
    if (!get().state || state.revision >= get().state!.revision) set({ state, error: null });
  };
  return {
    state: null,
    error: null,
    connect() {
      const api = window.desktop;
      if (!api?.components) return () => {};
      let active = true;
      const unsubscribe = api.onComponentEvent((state) => {
        if (active) receive(state);
      });
      void api
        .components({ op: 'status' })
        .then((state) => {
          if (active) receive(state);
        })
        .catch(() => {
          if (active) set({ error: '无法读取本地组件状态，请重试。' });
        });
      return () => {
        active = false;
        unsubscribe();
      };
    },
    async run(call) {
      set({ error: null });
      try {
        if (!window.desktop?.components) return false;
        const state = await window.desktop.components(call);
        receive(state);
        return !state.error;
      } catch {
        set({ error: '本地组件操作失败，请重试。' });
        return false;
      }
    },
  };
});
export function componentReady(id: ComponentId) {
  // Browser previews and older synthetic fixtures have no managed desktop components.
  return (
    typeof window === 'undefined' ||
    !window.desktop?.components ||
    useComponents
      .getState()
      .state?.items.some((item) => item.id === id && item.phase === 'ready') === true
  );
}
export function useComponentReady(id: ComponentId) {
  const state = useComponents((value) => value.state);
  return (
    !window.desktop?.components ||
    state?.items.some((item) => item.id === id && item.phase === 'ready') === true
  );
}
