import type { Answer, Transcript } from './contracts';
import { validInterviewImages } from '../../electron/contracts/interviewImages';
import {
  storedObject,
  storedProvider,
  storedActivity,
  optionalString,
  optionalNumber,
} from './storedValues';

export interface InterviewRecord {
  id: string;
  title: string;
  knowledgeBaseName?: string;
  startedAt: number;
  endedAt: number;
  status: 'ended' | 'interrupted';
  transcripts: Transcript[];
  answers: Answer[];
  mock: boolean;
  titleStatus?: 'pending' | 'ready' | 'failed';
  titleError?: string;
  titleSource?: 'manual' | 'generated';
}
export interface HistoryService {
  list(): InterviewRecord[];
  save(record: InterviewRecord): void;
  remove(id: string): void;
  rename(id: string, title: string): void;
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
          record.transcripts.every(
            (row: unknown) =>
              storedObject(row) &&
              ['id', 'text', 'time'].every((key) => typeof row[key] === 'string') &&
              typeof row.final === 'boolean' &&
              (row.source === undefined || ['system', 'microphone'].includes(row.source)) &&
              optionalNumber(row.startMs) &&
              optionalNumber(row.endMs) &&
              optionalString(row.reason),
          ) &&
          Array.isArray(record.answers) &&
          record.answers.every(
            (answer: unknown) =>
              storedObject(answer) &&
              ['id', 'question', 'content'].every((key) => typeof answer[key] === 'string') &&
              storedProvider(answer.provider) &&
              storedActivity(answer.activity) &&
              (answer.images === undefined || validInterviewImages(answer.images)) &&
              optionalString(answer.error) &&
              optionalString(answer.reasoningSummary) &&
              (answer.screenshot === undefined || ['attach', 'only'].includes(answer.screenshot)) &&
              optionalNumber(answer.createdAt) &&
              (answer.status === undefined ||
                ['streaming', 'completed', 'stopped', 'failed'].includes(answer.status)) &&
              (answer.sourceTranscriptIds === undefined ||
                (Array.isArray(answer.sourceTranscriptIds) &&
                  answer.sourceTranscriptIds.every((id: unknown) => typeof id === 'string'))),
          ) &&
          typeof record.mock === 'boolean' &&
          optionalString(record.knowledgeBaseName) &&
          optionalString(record.titleError) &&
          (record.titleStatus === undefined ||
            ['pending', 'ready', 'failed'].includes(record.titleStatus)) &&
          (record.titleSource === undefined ||
            ['manual', 'generated'].includes(record.titleSource)),
      )
    )
      throw new Error('历史记录数据无法读取');
    return records.sort((a, b) => b.startedAt - a.startedAt);
  };
  return {
    list,
    save(record) {
      const previous = list().find((item) => item.id === record.id);
      if (previous?.titleSource === 'manual')
        record = {
          ...record,
          title: previous.title,
          titleSource: 'manual',
          titleStatus: 'ready',
          titleError: undefined,
        };
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
    rename(id, value) {
      const title = typeof value === 'string' ? value.trim() : '';
      if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title))
        throw Error('标题须为 1–80 字，不能包含换行或控制字符。');
      const records = list();
      if (!records.some((record) => record.id === id))
        throw Error('这条记录已不存在，请返回列表刷新。');
      storage.setItem(
        key,
        JSON.stringify(
          records.map((record) =>
            record.id === id
              ? {
                  ...record,
                  title,
                  titleSource: 'manual',
                  titleStatus: 'ready',
                  titleError: undefined,
                }
              : record,
          ),
        ),
      );
    },
  };
}
// Resolve storage lazily so tests and the service interface remain browser independent.
export const localHistory: HistoryService = {
  list: () => createHistoryService(localStorage).list(),
  save: (record) => createHistoryService(localStorage).save(record),
  remove: (id) => createHistoryService(localStorage).remove(id),
  rename: (id, title) => createHistoryService(localStorage).rename(id, title),
};
