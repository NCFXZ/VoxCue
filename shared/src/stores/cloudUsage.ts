import { create } from 'zustand';
import type { CloudEntitlements, CloudUsageCall } from '../../electron/contracts/cloudUsage';
import { useCloudAccount } from './cloudAccount';

interface UsageState {
  userId?: string;
  value?: CloudEntitlements;
  busy: boolean;
  error?: string;
  bind(userId?: string): void;
  run(call: CloudUsageCall): Promise<boolean>;
}
let generation = 0;
export const useCloudUsage = create<UsageState>((set, get) => ({
  busy: false,
  bind(userId) {
    if (get().userId === userId) return;
    generation++;
    set({ userId, value: undefined, error: undefined, busy: false });
  },
  async run(call) {
    const userId = get().userId,
      epoch = generation;
    if (!userId || get().busy || !window.desktop?.cloudUsage) return false;
    set({ busy: true, error: undefined });
    const current = () =>
      epoch === generation && useCloudAccount.getState().state.user?.id === userId;
    try {
      const result = await window.desktop.cloudUsage(call);
      if (!current()) return false;
      if (!result.ok) {
        set({ error: result.error });
        return false;
      }
      set({ value: result.entitlements });
      return true;
    } catch {
      if (current()) set({ error: '无法读取面试额度，请稍后重试。' });
      return false;
    } finally {
      if (epoch === generation) set({ busy: false });
    }
  },
}));
