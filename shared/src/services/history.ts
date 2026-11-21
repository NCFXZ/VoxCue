import type { Answer, Transcript } from './contracts';
import { localChanged } from './localChanges';
import { validInterviewImages } from '../../electron/contracts/interviewImages';
import { historyImageIds, recoverHistoryImages, stageHistoryImages } from './historyImageRemoval';
import { hasDocumentsDatabase, historyStoreNames, openDocumentsDatabase } from './documentsDatabase';
import { sameValue } from './storedEqual';
import { CloudDataConflict } from './localChanges';
export { historyStoreNames } from './documentsDatabase';
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
  transcriptTailIncomplete?: true;
  recordingError?: string;
  transcripts: Transcript[];
  answers: Answer[];
  mock: boolean;
  titleStatus?: 'pending' | 'ready' | 'failed';
  titleError?: string;
  titleSource?: 'manual' | 'generated';
}
export interface HistoryService {
  list(): InterviewRecord[];
  save(record: InterviewRecord): { record: InterviewRecord; records: InterviewRecord[] };
  remove(id: string): void;
  rename(id: string, title: string): void;
}
export const historyStorageKey = 'copilot-interview-history-v1';
const key = historyStorageKey;
export function validHistoryRecord(record: unknown): record is InterviewRecord {
  return storedObject(record) &&
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    Number.isFinite(record.startedAt) &&
    Number.isFinite(record.endedAt) &&
    ['ended', 'interrupted'].includes(record.status) &&
    (record.transcriptTailIncomplete === undefined || record.transcriptTailIncomplete === true) &&
    (record.recordingError === undefined || (typeof record.recordingError === 'string' && record.recordingError.length <= 200)) &&
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
        (answer.questionSource === undefined || answer.questionSource === 'microphone' || answer.questionSource === 'system') &&
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
      ['manual', 'generated'].includes(record.titleSource));
}
export function readHistorySnapshot(raw: string | null): InterviewRecord[] {
  if (!raw) return [];
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || !records.every(validHistoryRecord)) throw new Error('历史记录数据无法读取');
  return records.sort((a, b) => b.startedAt - a.startedAt);
}
export function recoverLocalHistoryImages(checkOwner?: () => void) {
  let previous: string | null | undefined;
  let referenced = new Set<string>();
  return recoverHistoryImages((batch) => {
    checkOwner?.();
    if (typeof indexedDB !== 'undefined') return withHistoryDatabase(async db => {
      const ids = await readStore(db, 'readonly', async tx => {
        const index = tx.objectStore(historyStoreNames[1]).index('imageIds');
        const references = await Promise.all(batch.map(id => readRequest(index.getKey(id))));
        return new Set(batch.filter((_, i) => references[i] !== undefined));
      });
      checkOwner?.();
      return ids;
    });
    const raw = localStorage.getItem(key);
    if (raw !== previous) {
      referenced = new Set(readHistorySnapshot(raw).flatMap(historyImageIds));
      previous = raw;
    }
    return referenced;
  });
}
function keepTitle(record: InterviewRecord, previous?: InterviewRecord) {
  if (previous?.titleSource === 'manual')
    return { ...record, title: previous.title, titleSource: 'manual', titleStatus: 'ready', titleError: undefined } as InterviewRecord;
  if (previous?.titleStatus === 'ready' && record.titleStatus !== 'ready')
    return { ...record, title: previous.title, titleStatus: 'ready', titleError: undefined } as InterviewRecord;
  if (previous?.titleStatus && !record.titleStatus)
    return { ...record, title: previous.title, titleStatus: previous.titleStatus, titleError: previous.titleError };
  return record;
}
function normalizedTitle(value: string) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title))
    throw Error('标题须为 1–80 字，不能包含换行或控制字符。');
  return title;
}
export function createHistoryService(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
) {
  const list = () => readHistorySnapshot(storage.getItem(key));
  return {
    list,
    save(record, preserveTitle = true) {
      const records = list();
      const previous = records.find((item) => item.id === record.id);
      if (preserveTitle) record = keepTitle(record, previous);
      if (!validHistoryRecord(record)) throw new Error('历史记录数据无法读取');
      const next = [record, ...records.filter(item => item.id !== record.id)];
      if (previous) stageHistoryImages(storage, previous, record);
      storage.setItem(key, JSON.stringify(next));
      return { record, records: next.sort((a, b) => b.startedAt - a.startedAt) };
    },
    remove(id) {
      const records = list();
      for (const record of records) if (record.id === id) stageHistoryImages(storage, record);
      storage.setItem(key, JSON.stringify(records.filter((item) => item.id !== id)));
    },
    rename(id, value) {
      const title = normalizedTitle(value);
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
  } satisfies HistoryService;
}
// Resolve storage lazily so tests and the service interface remain browser independent.
export const localHistory: HistoryService = {
  list: () => createHistoryService(localStorage).list(),
  save: (record) => {
    const result = createHistoryService(localStorage).save(record);
    localChanged('history', ['record:' + record.id]);
    return result;
  },
  remove: (id) => {
    createHistoryService(localStorage).remove(id);
    localChanged('history', ['record:' + id]);
  },
  rename: (id, title) => {
    createHistoryService(localStorage).rename(id, title);
    localChanged('history', ['record:' + id]);
  },
};

export type HistorySummary = Omit<InterviewRecord, 'answers' | 'transcripts'> & {
  answerCount: number;
  imageIds: string[];
  embeddedPreviewIds?: string[];
  revision: string;
  modifiedAt?: number;
};
export type HistoryChange = { id: string; previous?: InterviewRecord; next?: InterviewRecord };

function directoryEntry(record: InterviewRecord, revision: string): HistorySummary {
  const { answers, transcripts: _transcripts, ...metadata } = record;
  return { ...metadata, answerCount: answers.filter(answer => answer.provider !== 'mock').length,
    imageIds: [...new Set(historyImageIds(record))],
    embeddedPreviewIds: [...new Set(answers.flatMap(answer => answer.images?.filter(image => image.preview).map(image => image.id) ?? []))],
    revision };
}
const byDate = <T extends { startedAt: number }>(records: T[]) => records.sort((a, b) => b.startedAt - a.startedAt);
const invalid = () => Error('历史记录数据无法读取');
function checkedRecord(value: unknown): InterviewRecord {
  if (!validHistoryRecord(value)) throw invalid();
  return value;
}
function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readStore<T>(
  db: IDBDatabase, mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>,
) {
  const tx = db.transaction([...historyStoreNames], mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? Error('历史记录事务未完成。'));
  });
  try {
    const [result] = await Promise.all([work(tx), done]);
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* Already committed or aborted. */ }
    await done.catch(() => {});
    throw error;
  }
}
function writeRecord(tx: IDBTransaction, id: string, previous?: InterviewRecord, next?: InterviewRecord) {
  if (next && (next.id !== id || !validHistoryRecord(next))) throw invalid();
  if (sameValue(previous, next)) return false;
  if (previous) stageHistoryImages(localStorage, previous, next);
  const records = tx.objectStore(historyStoreNames[0]);
  const directory = tx.objectStore(historyStoreNames[1]);
  if (next) {
    records.put(next);
    directory.put(directoryEntry(next, crypto.randomUUID()));
  } else {
    records.delete(id);
    directory.delete(id);
  }
  return true;
}

// Called inside the originals transaction so an account move either commits every store or none.
export function applyHistoryChanges(
  tx: IDBTransaction, changes: HistoryChange[], onReady: () => void, onError: (error: unknown) => void,
) {
  if (!changes.length) { onReady(); return; }
  if (new Set(changes.map(change => change.id)).size !== changes.length) {
    onError(invalid());
    return;
  }
  const store = tx.objectStore(historyStoreNames[0]);
  let remaining = changes.length;
  for (const { id, previous, next } of changes) {
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        if (!sameValue(request.result, previous)) throw Error('迁移期间本地资料已更改，请重试。');
        writeRecord(tx, id, previous, next);
        if (--remaining === 0) onReady();
      } catch (error) { onError(error); }
    };
  }
}

async function mergeRows(db: IDBDatabase, rows: InterviewRecord[], verifyLegacy?: string) {
  if (new Set(rows.map(record => record.id)).size !== rows.length) throw invalid();
  return readStore(db, 'readwrite', async tx => {
    const records = tx.objectStore(historyStoreNames[0]);
    const directory = tx.objectStore(historyStoreNames[1]);
    const added: string[] = [];
    if (verifyLegacy !== undefined) {
      // Another window may already have migrated and edited a record while this transaction waited.
      await readRequest(records.count());
      const raw = localStorage.getItem(key);
      if (raw === null) return added;
      if (raw !== verifyLegacy) throw Error('迁移期间本地资料已更改，请重试。');
    }
    for (const row of rows) {
      const current = await readRequest(records.get(row.id));
      if (!current) {
        writeRecord(tx, row.id, undefined, checkedRecord(row));
        added.push(row.id);
      } else if (verifyLegacy !== undefined && !sameValue(current, row)) {
        throw Error('新旧面试记录内容不一致，原始记录已保留。');
      }
    }
    if (verifyLegacy !== undefined) {
      for (const row of rows) {
        const [saved, summary] = await Promise.all([
          readRequest(records.get(row.id)), readRequest(directory.get(row.id)),
        ]);
        if (!sameValue(saved, row) || typeof summary?.revision !== 'string' ||
            !sameValue(summary, { ...directoryEntry(row, summary.revision), modifiedAt: summary.modifiedAt })) throw invalid();
      }
      const raw = localStorage.getItem(key);
      if (raw !== null && raw !== verifyLegacy) throw Error('迁移期间本地资料已更改，请重试。');
    }
    return added;
  });
}
async function withHistoryDatabase<T>(work: (db: IDBDatabase) => Promise<T>) {
  const db = await openDocumentsDatabase();
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      await mergeRows(db, readHistorySnapshot(raw), raw);
      // A failed transaction leaves the complete source in place. A concurrent change also stays intact.
      if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
    }
    return await work(db);
  } finally { db.close(); }
}

/** Read-only migration manifest. Keep the original legacy snapshot until the move is committed. */
export async function readImportHistory() {
  const previous = readHistorySnapshot(localStorage.getItem(key));
  const legacy = new Map(previous.map(row => [row.id, row]));
  if (legacy.size !== previous.length) throw invalid();
  let rows: HistorySummary[] = [];
  if (typeof indexedDB !== 'undefined' && await hasDocumentsDatabase()) {
    const db = await openDocumentsDatabase(true);
    try {
      if (db.objectStoreNames.contains(historyStoreNames[0])) {
        rows = await readStore(db, 'readonly', async tx => {
          const records = tx.objectStore(historyStoreNames[0]);
          const summaries: HistorySummary[] = await readRequest(tx.objectStore(historyStoreNames[1]).getAll());
          if (summaries.length !== await readRequest(records.count())) throw invalid();
          for (const summary of summaries) {
            const old = legacy.get(summary.id);
            if (!old) continue;
            if (!sameValue(old, await readRequest(records.get(summary.id))))
              throw Error('新旧面试记录内容不一致，原始记录已保留。');
            legacy.delete(summary.id);
          }
          return summaries;
        });
      }
    } finally { db.close(); }
  }
  for (const row of legacy.values()) rows.push(directoryEntry(row, ''));
  async function withCurrentRecord<T>(summary: HistorySummary, select: (load: () => Promise<InterviewRecord>) => Promise<T>) {
    const old = legacy.get(summary.id);
    if (old) return select(async () => old);
    const db = await openDocumentsDatabase(true);
    try {
      return await readStore(db, 'readonly', async tx => {
        const current = await readRequest(tx.objectStore(historyStoreNames[1]).get(summary.id));
        if (!current || current.revision !== summary.revision) throw Error('来源资料已改变，请重新选择。');
        return select(async () => checkedRecord(await readRequest(tx.objectStore(historyStoreNames[0]).get(summary.id))));
      });
    } finally { db.close(); }
  }
  let previews: { summary: HistorySummary; byId: Map<string, string> } | undefined;
  return {
    rows: byDate(rows),
    read: (summary: HistorySummary) => withCurrentRecord(summary, load => load()),
    preview(summary: HistorySummary, id: string) {
      return withCurrentRecord(summary, async load => {
        if (previews?.summary !== summary) {
          const byId = new Map<string, string>();
          for (const answer of (await load()).answers)
            for (const image of answer.images ?? [])
              if (image.preview) byId.set(image.id, image.preview);
          previews = { summary, byId };
        }
        return previews.byId.get(id);
      });
    },
  };
}

// Read a source partition without opening it for upgrade or removing the previous format.
export async function readExistingHistory(): Promise<InterviewRecord[]> {
  const previous = readHistorySnapshot(localStorage.getItem(key));
  if (typeof indexedDB === 'undefined' || !(await hasDocumentsDatabase())) return previous;
  const db = await openDocumentsDatabase(true);
  try {
    if (!db.objectStoreNames.contains(historyStoreNames[0])) return previous;
    const records = await readStore(db, 'readonly', async tx =>
      (await readRequest(tx.objectStore(historyStoreNames[0]).getAll())).map(checkedRecord));
    const seen = new Map(records.map(row => [row.id, row]));
    for (const old of previous) {
      const current = seen.get(old.id);
      if (current && !sameValue(current, old)) throw Error('新旧面试记录内容不一致，原始记录已保留。');
      if (!current) { records.push(old); seen.set(old.id, old); }
    }
    return byDate(records);
  } finally { db.close(); }
}

const channelName = 'voxcue-interview-history';
export function historyChanged(ids: string[], notify = true) {
  if (!ids.length || typeof window === 'undefined') return;
  if (notify) localChanged('history', ids.map(id => 'record:' + id));
  window.dispatchEvent?.(new Event('voxcue-history-changed'));
  if (typeof window.BroadcastChannel === 'function') {
    const channel = new window.BroadcastChannel(channelName);
    channel.postMessage(null);
    channel.close();
  }
}
export function subscribeHistoryChanges(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) listener(); };
  window.addEventListener('storage', storage);
  window.addEventListener('voxcue-history-changed', listener);
  const channel = typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel(channelName) : undefined;
  if (channel) channel.onmessage = listener;
  return () => {
    channel?.close();
    window.removeEventListener('storage', storage);
    window.removeEventListener('voxcue-history-changed', listener);
  };
}

type SaveOptions = { expected?: InterviewRecord | null; guard?: () => void; notify?: boolean };
type Change = (current?: InterviewRecord) => InterviewRecord | undefined;
async function changeOne(id: string, change: Change, options: SaveOptions = {}, remove = false) {
  const update = (current?: InterviewRecord) => {
    options.guard?.();
    if (Object.hasOwn(options, 'expected') && !sameValue(current, options.expected ?? undefined))
      throw new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
    return change(current);
  };
  let changed = false;
  let next: InterviewRecord | undefined;
  if (typeof indexedDB === 'undefined') {
    const store = createHistoryService(localStorage);
    const current = store.list().find(row => row.id === id);
    next = update(current);
    if (remove || next) {
      changed = !sameValue(current, next);
      if (changed) {
        if (next) store.save(next, false);
        else store.remove(id);
      }
    }
  } else {
    next = await withHistoryDatabase(db => readStore(db, 'readwrite', async tx => {
      const current: InterviewRecord | undefined = await readRequest(tx.objectStore(historyStoreNames[0]).get(id));
      const replacement = update(current);
      if (remove || replacement) changed = writeRecord(tx, id, current, replacement);
      return replacement;
    }));
  }
  if (changed) historyChanged([id], options.notify);
  return next;
}
export const historyRepository = {
  async ready() {
    if (typeof indexedDB !== 'undefined') await withHistoryDatabase(async () => {});
  },
  async get(id: string, expectedRevision?: string): Promise<InterviewRecord | undefined> {
    const check = (actual: string | undefined) => {
      if (expectedRevision !== undefined && actual !== expectedRevision)
        throw new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
    };
    if (typeof indexedDB === 'undefined') {
      const row = localHistory.list().find(item => item.id === id);
      check(row && JSON.stringify(row));
      return row;
    }
    return withHistoryDatabase(db => readStore(db, 'readonly', async tx => {
      if (expectedRevision !== undefined)
        check((await readRequest(tx.objectStore(historyStoreNames[1]).get(id)))?.revision);
      const record = await readRequest(tx.objectStore(historyStoreNames[0]).get(id));
      return record === undefined ? undefined : checkedRecord(record);
    }));
  },
  async list(): Promise<InterviewRecord[]> {
    if (typeof indexedDB === 'undefined') return localHistory.list();
    return withHistoryDatabase(db => readStore(db, 'readonly', async tx =>
      byDate((await readRequest(tx.objectStore(historyStoreNames[0]).getAll())).map(checkedRecord))));
  },
  async summaries(): Promise<HistorySummary[]> {
    if (typeof indexedDB === 'undefined') return localHistory.list().map(row => directoryEntry(row, JSON.stringify(row)));
    return withHistoryDatabase(db => readStore(db, 'readonly', async tx =>
      byDate(await readRequest(tx.objectStore(historyStoreNames[1]).getAll()))));
  },
  async summary(id: string): Promise<HistorySummary | undefined> {
    if (typeof indexedDB === 'undefined') {
      const row = localHistory.list().find(record => record.id === id);
      return row && directoryEntry(row, JSON.stringify(row));
    }
    return withHistoryDatabase(db => readStore(db, 'readonly', tx => readRequest(tx.objectStore(historyStoreNames[1]).get(id))));
  },
  async imageOwners(id: string): Promise<string[]> {
    if (typeof indexedDB === 'undefined')
      return localHistory.list().filter(record => historyImageIds(record).includes(id)).map(record => record.id);
    return withHistoryDatabase(db => readStore(db, 'readonly', async tx =>
      (await readRequest(tx.objectStore(historyStoreNames[1]).index('imageIds').getAllKeys(id))).map(String)));
  },
  async imageReference(id: string): Promise<{ id: string; preview?: string } | undefined> {
    function reference(row: InterviewRecord) {
      let found: { id: string; preview?: string } | undefined;
      for (const answer of row.answers) for (const image of answer.images ?? []) {
        if (image.id !== id) continue;
        found = image;
        if (image.preview) return image;
      }
      return found;
    }
    if (typeof indexedDB === 'undefined') {
      const references = localHistory.list().map(reference);
      return references.find(image => image?.preview) ?? references.find(Boolean);
    }
    return withHistoryDatabase(db => readStore(db, 'readonly', async tx => {
      const owners = await readRequest(tx.objectStore(historyStoreNames[1]).index('imageIds').getAllKeys(id));
      let found: { id: string; preview?: string } | undefined;
      for (const owner of owners) {
        const row = checkedRecord(await readRequest(tx.objectStore(historyStoreNames[0]).get(owner)));
        const image = reference(row);
        if (image?.preview) return image;
        found ??= image;
      }
      return found;
    }));
  },
  async save(record: InterviewRecord, options?: SaveOptions & { replaceTitle?: boolean }): Promise<InterviewRecord> {
    return (await changeOne(record.id, current => options?.replaceTitle ? record : keepTitle(record, current), options))!;
  },
  updateTitle(id: string, change: (current: InterviewRecord) => InterviewRecord | undefined) {
    return changeOne(id, current => current ? change(current) : undefined);
  },
  async rename(id: string, value: string) {
    const title = normalizedTitle(value);
    if (typeof indexedDB === 'undefined') { localHistory.rename(id, title); return; }
    await changeOne(id, current => {
      if (!current) throw Error('这条记录已不存在，请返回列表刷新。');
      return { ...current, title, titleStatus: 'ready', titleSource: 'manual', titleError: undefined };
    });
  },
  async remove(id: string, options?: SaveOptions) { await changeOne(id, () => undefined, options, true); },
  async mergeMissing(rows: InterviewRecord[]) {
    if (typeof indexedDB === 'undefined') {
      const existing = new Set(localHistory.list().map(row => row.id));
      for (const row of rows) if (!existing.has(row.id)) localHistory.save(row);
    } else {
      const added = await withHistoryDatabase(db => mergeRows(db, rows));
      historyChanged(added);
    }
  },
};
