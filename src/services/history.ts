import type { Answer, Transcript } from './contracts';

export interface InterviewRecord {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number;
  status: 'ended' | 'interrupted';
  transcripts: Transcript[];
  answers: Answer[];
  mock: boolean;
  titleStatus?: 'pending' | 'ready' | 'failed';
  titleError?: string;
}
export interface HistoryService {
  list(): InterviewRecord[];
  save(record: InterviewRecord): void;
  remove(id: string): void;
}
export const historyStorageKey = 'copilot-interview-history-v1';
const key = historyStorageKey;
export function createHistoryService(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): HistoryService {
  const list = (): InterviewRecord[] => {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const records: unknown = JSON.parse(raw);
    if (
      !Array.isArray(records) ||
      !records.every(
        (record) =>
          record &&
          typeof record.id === 'string' &&
          typeof record.title === 'string' &&
          Number.isFinite(record.startedAt) &&
          Number.isFinite(record.endedAt) &&
          ['ended', 'interrupted'].includes(record.status) &&
          Array.isArray(record.transcripts) &&
          Array.isArray(record.answers) &&
          typeof record.mock === 'boolean',
      )
    )
      throw new Error('历史记录数据无法读取');
    return records.sort((a, b) => b.startedAt - a.startedAt);
  };
  return {
    list,
    save(record) {
      const previous = list().find((item) => item.id === record.id);
      if (previous?.titleStatus === 'ready' && record.titleStatus !== 'ready')
        record = { ...record, title: previous.title, titleStatus: 'ready', titleError: undefined };
      if (previous?.titleStatus && !record.titleStatus)
        record = {
          ...record,
          title: previous.title,
          titleStatus: previous.titleStatus,
          titleError: previous.titleError,
        };
      storage.setItem(
        key,
        JSON.stringify([record, ...list().filter((item) => item.id !== record.id)]),
      );
    },
    remove(id) {
      storage.setItem(key, JSON.stringify(list().filter((item) => item.id !== id)));
    },
  };
}
// Resolve storage lazily so tests and the service interface remain browser independent.
export const localHistory: HistoryService = {
  list: () => createHistoryService(localStorage).list(),
  save: (record) => createHistoryService(localStorage).save(record),
  remove: (id) => createHistoryService(localStorage).remove(id),
};
