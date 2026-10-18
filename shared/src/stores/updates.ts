import { create } from 'zustand';
import type { UpdateAction, UpdateCall, UpdateState } from '../../electron/contracts/updates';
import { updateCall } from '../services/updates';

interface UpdatesStore {
  state: UpdateState | null;
  error: string | null;
  connect(): () => void;
  run(call: UpdateAction | UpdateCall): Promise<void>;
}

export const useUpdates = create<UpdatesStore>((set, get) => {
  const receive = (state: UpdateState) => {
    if (!get().state || state.revision >= get().state!.revision) set({ state, error: null });
  };
  return {
    state: null,
    error: null,
    connect() {
      let active = true;
      const unsubscribe = window.desktop?.onUpdateEvent((state) => {
        if (active) receive(state);
      });
      void updateCall('status')
        .then((state) => {
          if (active) receive(state);
        })
        .catch(() => {
          if (active) set({ error: '无法读取更新状态，请重新打开设置后重试。' });
        });
      return () => {
        active = false;
        unsubscribe?.();
      };
    },
    async run(op) {
      set({ error: null });
      try {
        receive(await updateCall(op));
      } catch {
        set({ error: '更新操作失败，请稍后重试。' });
      }
    },
  };
});
