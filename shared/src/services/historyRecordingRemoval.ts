import { recordingRecordId } from '../../electron/contracts/recordings';
import { historyRepository } from './history';
import { recoverInterviewDrafts } from './interviewDraft';

const inProgress = new Set<string>();
let recovery: Promise<void> | undefined;
const preserved = '删除失败，面试记录和录音均已保留。请重试。';
const restorePending = '面试记录已保留，录音恢复尚未完成。请重新打开面试记录。';
const cleanupPending = '面试记录已删除，剩余录音将在下次打开时继续清理。';
export class HistoryRemovalError extends Error {}

// The staged directory is the durable intent. The history write decides
// whether a later recovery restores or removes it, even after an app crash.
export function recoverHistoryRecordings() {
  return recovery ??= recoverPending().finally(() => { recovery = undefined; });
}

export async function readHistoryRecordings(recordId: string) {
  // Opening a retained record while a previous deletion rolls back must see the restored directory.
  if (recovery) await recovery.catch(() => {});
  return window.desktop!.recordings({ op: 'list', recordId });
}

async function recoverPending() {
  const desktop = window.desktop;
  if (!desktop?.pendingRecordingRemovals) return;
  let failure: HistoryRemovalError | undefined;
  for (const recordId of await desktop.pendingRecordingRemovals()) {
    if (inProgress.has(recordId)) continue;
    inProgress.add(recordId);
    try {
      const retained = await historyRepository.summary(recordId);
      try { await desktop.recordings({ recordId, op: retained ? 'restore-remove' : 'finish-remove' }); }
      catch { failure ??= new HistoryRemovalError(retained ? restorePending : cleanupPending); }
    } finally {
      inProgress.delete(recordId);
    }
  }
  if (failure) throw failure;
}

export async function removeHistoryRecord(recordId: string) {
  const desktop = window.desktop;
  if (inProgress.has(recordId)) throw new HistoryRemovalError('面试记录正在处理，请稍后重试。');
  inProgress.add(recordId);
  try {
    if (typeof indexedDB !== 'undefined') {
      try { await recoverInterviewDrafts(new Set([recordId])); }
      catch (error) {
        throw new HistoryRemovalError(error instanceof Error && error.message === '请先结束面试。'
          ? error.message : preserved);
      }
    }
    if (!recordingRecordId(recordId) || !desktop?.recordings) {
      await historyRepository.remove(recordId);
      return;
    }
    try {
      await desktop.recordings({ recordId, op: 'stage-remove' });
    } catch {
      throw new HistoryRemovalError('无法准备删除录音，面试记录已保留。请重试。');
    }
    try {
      await historyRepository.remove(recordId);
    } catch {
      try { await desktop.recordings({ recordId, op: 'restore-remove' }); }
      catch { throw new HistoryRemovalError(restorePending); }
      throw new HistoryRemovalError(preserved);
    }
    try { await desktop.recordings({ recordId, op: 'finish-remove' }); }
    catch { return cleanupPending; }
  } finally {
    inProgress.delete(recordId);
  }
}
