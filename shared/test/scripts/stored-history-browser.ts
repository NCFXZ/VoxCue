import { applyHistoryChanges, historyChanged, historyRepository, type InterviewRecord } from '../../src/services/history';
import { historyStoreNames, openDocumentsDatabase } from '../../src/services/documentsDatabase';

export const read = () => historyRepository.list();

/** Seed synthetic committed rows using the application's atomic directory/body writer. */
export async function replace(records: InterviewRecord[]) {
  await historyRepository.ready();
  const db = await openDocumentsDatabase();
  try {
    const ids = await new Promise<string[]>((resolve, reject) => {
      let ids: string[] = [];
      const tx = db.transaction([...historyStoreNames], 'readwrite');
      tx.oncomplete = () => resolve(ids);
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('Synthetic history transaction failed'));
      const get = tx.objectStore(historyStoreNames[0]).getAll();
      get.onsuccess = () => {
        const before = new Map<string, InterviewRecord>(get.result.map(row => [row.id, row]));
        const after = new Map(records.map(row => [row.id, row]));
        ids = [...new Set([...before.keys(), ...after.keys()])];
        const changes = ids.map(id => ({
          id, previous: before.get(id), next: after.get(id),
        }));
        applyHistoryChanges(tx, changes, () => {}, (error) => { tx.abort(); reject(error); });
      };
    });
    historyChanged(ids, false);
  } finally { db.close(); }
}

/** Abort one history mutation; reads and all other databases behave normally. */
export function failNextWrite() {
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
    const tx = original.apply(this, args);
    if (this.name === 'copilot-local-documents' && tx.mode === 'readwrite' &&
        tx.objectStoreNames.contains(historyStoreNames[0])) {
      IDBDatabase.prototype.transaction = original;
      queueMicrotask(() => tx.abort());
    }
    return tx;
  };
}
