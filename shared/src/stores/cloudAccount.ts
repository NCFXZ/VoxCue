import { create } from 'zustand';
import { stopCloudWork } from '../services/cloudLifecycle';
import type {
  CloudAccountCall,
  CloudAccountResult,
  CloudAccountState,
} from '../../electron/contracts/cloudAccount';

interface AccountStore {
  state: CloudAccountState;
  loaded: boolean;
  revision: number;
  call(call: CloudAccountCall): Promise<CloudAccountResult>;
  load(): Promise<void>;
}
let loading: Promise<void> | undefined;
export const useCloudAccount = create<AccountStore>((set, get) => ({
  state: { configured: false, verified: false, user: null },
  loaded: false,
  revision: 0,
  async call(call) {
    if (call.action === 'logout') await stopCloudWork();
    const result = window.desktop?.cloudAccount
      ? await window.desktop.cloudAccount(call)
      : { ok: false as const, state: get().state, error: '请在桌面应用中使用账号服务。' };
    set({
      state: result.state,
      loaded: true,
      revision: get().revision + (call.action === 'logout' ? 1 : 0),
    });
    return result;
  },
  async load() {
    loading ??= get()
      .call({ action: 'status' })
      .then(() => {})
      .catch(() => set({ loaded: true }))
      .finally(() => {
        loading = undefined;
      });
    await loading;
  },
}));
