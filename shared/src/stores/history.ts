import { create } from 'zustand';
import { historyRepository, recoverLocalHistoryImages, type HistorySummary, type InterviewRecord } from '../services/history';
import type { InterviewTitleEvent } from '../../electron/contracts/history';
import { HistoryRemovalError, recoverHistoryRecordings, removeHistoryRecord } from '../services/historyRecordingRemoval';
import { recoverInterviewDrafts } from '../services/interviewDraft';
import { titleQuestions } from '../services/historyPresentation';
import { useChatConnection } from './chatConnection';
interface HistoryState {
  records: HistorySummary[];
  error: string | null;
  load(): Promise<void>;
  getRecord(id: string): Promise<InterviewRecord | undefined>;
  recoverRecordings(): Promise<void>;
  recoverDrafts(): Promise<void>;
  save(record: InterviewRecord): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  rename(id: string, title: string): Promise<boolean>;
  generateTitle(id: string, modelId?: string): Promise<void>;
  applyTitle(event: InterviewTitleEvent): Promise<void>;
}
const generating = new Set<string>();
let loadRevision = 0;
let recoveringDrafts: Promise<void> | undefined;
const imageCleanupError = '面试记录已删除，但部分截图清理失败，请稍后重试。';
async function retryImageCleanup() {
  try {
    await recoverLocalHistoryImages();
    if (useHistory.getState().error === imageCleanupError) useHistory.setState({ error: null });
  } catch {
    useHistory.setState({ error: imageCleanupError });
  }
}
export const useHistory = create<HistoryState>((set, get) => ({
  records: [],
  error: null,
  async generateTitle(id, modelId) {
    if (generating.has(id) || !window.desktop?.generateInterviewTitle) return;
    const model = modelId || useChatConnection.getState().models[0]?.id;
    if (!model) return;
    generating.add(id);
    let record: InterviewRecord | undefined;
    try {
      record = await historyRepository.updateTitle(id, (current) => {
        if (current.mock || current.titleStatus === 'ready' || !titleQuestions(current).length) return;
        return { ...current, titleStatus: 'pending', titleError: undefined };
      });
    } catch {
      set({ error: '无法读取本地记录，原始数据已保留。' });
    }
    if (!record) { generating.delete(id); return; }
    await get().load();
    try {
      await window.desktop.generateInterviewTitle({ recordId: id, modelId: model, questions: titleQuestions(record) });
    } catch {
      await get().applyTitle({ recordId: id, error: '标题生成失败，可稍后重试。' });
    }
  },
  async applyTitle(event) {
    generating.delete(event.recordId);
    try {
      const updated = await historyRepository.updateTitle(event.recordId, (record) => {
        if (record.titleSource === 'manual' || record.titleStatus === 'ready') return;
        return event.title
          ? {
              ...record, title: record.knowledgeBaseName ? `「${record.knowledgeBaseName}」${event.title}` : event.title,
              titleSource: 'generated', titleStatus: 'ready', titleError: undefined,
            }
          : { ...record, titleStatus: 'failed', titleError: event.error || '标题生成失败，可稍后重试。' };
      });
      if (updated) await get().load();
    } catch {
      set({ error: '标题保存失败，原始面试记录已保留。' });
    }
  },
  async load() {
    const revision = ++loadRevision;
    try {
      const records = await historyRepository.summaries();
      if (revision === loadRevision) set({ records, error: null });
    } catch {
      if (revision === loadRevision) set({ error: '无法读取本地记录，原始数据已保留。' });
    }
  },
  async getRecord(id) {
    try { return await historyRepository.get(id); }
    catch { set({ error: '无法读取本地记录，原始数据已保留。' }); }
  },
  recoverDrafts() {
    return recoveringDrafts ??= recoverInterviewDrafts().then(async (changed) => {
      if (changed) await get().load();
    }).catch(() => {
      set({ error: '无法读取本地记录，原始数据已保留。' });
    }).finally(() => { recoveringDrafts = undefined; });
  },
  async recoverRecordings() {
    try { await recoverHistoryRecordings(); }
    catch (error) {
      set({ error: error instanceof HistoryRemovalError ? error.message : '无法读取本地录音。' });
    }
    await retryImageCleanup();
  },
  async save(record) {
    try {
      await historyRepository.save(record);
      await get().load();
      return true;
    } catch {
      set({ error: '记录保存失败，请检查本地存储空间。当前对话仍可查看。' });
      return false;
    }
  },
  async remove(id) {
    try {
      if (await historyRepository.summary(id)) {
        const cleanupWarning = await removeHistoryRecord(id);
        generating.delete(id);
        await get().load();
        if (cleanupWarning) set({ error: cleanupWarning });
      }
      await retryImageCleanup();
      return true;
    } catch (error) {
      set({ error: error instanceof HistoryRemovalError ? error.message : '删除失败，本地记录未更改。' });
      return false;
    }
  },
  async rename(id, title) {
    try {
      await historyRepository.rename(id, title);
      generating.delete(id);
      await get().load();
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
