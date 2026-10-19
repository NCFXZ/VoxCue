import { create } from 'zustand';
import { localHistory, type InterviewRecord } from '../services/history';
import type { InterviewTitleEvent } from '../../electron/contracts/history';
import { titleQuestions } from '../services/historyPresentation';
import { useChatConnection } from './chatConnection';
interface HistoryState {
  records: InterviewRecord[];
  error: string | null;
  load(): void;
  save(record: InterviewRecord): void;
  remove(id: string): boolean;
  rename(id: string, title: string): boolean;
  generateTitle(id: string, modelId?: string): Promise<void>;
  applyTitle(event: InterviewTitleEvent): void;
}
const generating = new Set<string>();
export const useHistory = create<HistoryState>((set) => ({
  records: [],
  error: null,
  async generateTitle(id, modelId) {
    if (generating.has(id) || !window.desktop?.generateInterviewTitle) return;
    let record: InterviewRecord | undefined;
    try {
      record = localHistory.list().find((r) => r.id === id);
    } catch {
      set({ error: '无法读取本地记录，原始数据已保留。' });
      return;
    }
    if (!record || record.mock || record.titleStatus === 'ready') return;
    const questions = titleQuestions(record);
    const model = modelId || useChatConnection.getState().models[0]?.id;
    if (!questions.length || !model) return;
    generating.add(id);
    try {
      localHistory.save({ ...record, titleStatus: 'pending', titleError: undefined });
      set({ records: localHistory.list() });
      await window.desktop.generateInterviewTitle({ recordId: id, modelId: model, questions });
    } catch {
      generating.delete(id);
      try {
        const current = localHistory.list().find((r) => r.id === id);
        if (current && current.titleSource !== 'manual' && current.titleStatus !== 'ready') {
          localHistory.save({
            ...current,
            titleStatus: 'failed',
            titleError: '标题生成失败，可稍后重试。',
          });
          set({ records: localHistory.list() });
        }
      } catch {
        set({ error: '标题状态保存失败，原始面试记录已保留。' });
      }
    }
  },
  applyTitle(event) {
    generating.delete(event.recordId);
    try {
      const record = localHistory.list().find((r) => r.id === event.recordId);
      if (!record || record.titleSource === 'manual' || record.titleStatus === 'ready') return;
      localHistory.save({
        ...record,
        ...(event.title
          ? {
              title: record.knowledgeBaseName
                ? `「${record.knowledgeBaseName}」${event.title}`
                : event.title,
              titleSource: 'generated' as const,
              titleStatus: 'ready' as const,
              titleError: undefined,
            }
          : {
              titleStatus: 'failed' as const,
              titleError: event.error || '标题生成失败，可稍后重试。',
            }),
      });
      set({ records: localHistory.list() });
    } catch {
      set({ error: '标题保存失败，原始面试记录已保留。' });
    }
  },
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
      generating.delete(id);
      set({ records: localHistory.list(), error: null });
      return true;
    } catch {
      set({ error: '删除失败，本地记录未更改。' });
      return false;
    }
  },
  rename(id, title) {
    try {
      localHistory.rename(id, title);
      generating.delete(id);
      set({ records: localHistory.list(), error: null });
      return true;
    } catch (error) {
      set({
        error:
          error instanceof Error && /^(标题|这条记录)/.test(error.message)
            ? error.message
            : '重命名失败，原始标题已保留，请检查本地存储后重试。',
      });
      return false;
    }
  },
}));
