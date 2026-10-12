import { create } from 'zustand';
import { localHistory, type InterviewRecord } from '../services/history';
interface HistoryState {
  records: InterviewRecord[];
  error: string | null;
  load(): void;
  save(record: InterviewRecord): void;
  remove(id: string): boolean;
}
export const useHistory = create<HistoryState>((set) => ({
  records: [],
  error: null,
  load() {
    try {
      set({ records: localHistory.list(), error: null });
    } catch {
      set({ error: '无法读取本地记录，原始数据已保留。' });
    }
  },
  save(record) {
    try {
      localHistory.save(record);
      set({ records: localHistory.list(), error: null });
    } catch {
      set({ error: '记录保存失败，请检查本地存储空间。当前对话仍可查看。' });
    }
  },
  remove(id) {
    try {
      localHistory.remove(id);
      set({ records: localHistory.list(), error: null });
      return true;
    } catch {
      set({ error: '删除失败，本地记录未更改。' });
      return false;
    }
  },
}));
