import { create } from 'zustand';
import type { UpdateAction, UpdateCall, UpdateState } from '../../electron/contracts/updates';
import { recordUpdateLaunch, saveUpdateNotice, updateCall } from '../services/updates';

interface UpdatesStore {
  state: UpdateState | null;
  error: string | null;
  noticeVersion: string | null;
  noticeError: string | null;
  dismissNotice(): void;
  connect(): () => void;
  run(call: UpdateAction | UpdateCall): Promise<void>;
}

export const useUpdates = create<UpdatesStore>((set, get) => {
  const receive = (state: UpdateState) => {
    if (get().state && state.revision < get().state!.revision) return;
    if (get().state?.currentVersion !== state.currentVersion) {
      try {
        set({ noticeVersion: recordUpdateLaunch(localStorage, state.currentVersion), noticeError: null });
      } catch {
        set({ noticeVersion: null, noticeError: null });
      }
    }
    set({ state, error: null });
  };
  return {
    state: null,
    error: null,
    noticeVersion: null,
    noticeError: null,
    dismissNotice() {
      const version = get().noticeVersion;
      if (!version) return;
      try {
        saveUpdateNotice(localStorage, version, false);
        set({ noticeVersion: null, noticeError: null });
      } catch {
        set({ noticeError: '无法保存提示设置，请重试。' });
      }
    },
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
