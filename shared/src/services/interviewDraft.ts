import type { Answer, Transcript } from './contracts';
import { historyRepository, type InterviewRecord } from './history';

// IndexedDB and Web Locks share the renderer's account-specific storage partition.
const databaseName = 'voxcue-interview-drafts';
type Header = Pick<InterviewRecord, 'id' | 'title' | 'knowledgeBaseName' | 'startedAt' | 'endedAt'>;
type Entry = { transcript: Transcript } | { answer: Answer };
const range = (id: string) => IDBKeyRange.bound([id], [id, []]);
function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' });
      request.result.createObjectStore('rows');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function complete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? Error('Interview draft transaction failed'));
  });
}
async function remove(db: IDBDatabase, id: string) {
  const tx = db.transaction(['sessions', 'rows'], 'readwrite');
  tx.objectStore('sessions').delete(id);
  tx.objectStore('rows').delete(range(id));
  await complete(tx);
}

export function startInterviewDraft(header: Omit<Header, 'endedAt'>, onError: () => void) {
  if (typeof indexedDB === 'undefined' || !globalThis.navigator?.locks) return;
  let unlock!: () => void;
  const lifetime = new Promise<void>(resolve => { unlock = resolve; });
  let database: IDBDatabase | undefined;
  let opening: Promise<IDBDatabase> | undefined;
  const connect = () => opening ??= openDatabase().then(db => database = db).finally(() => { opening = undefined; });
  // Unload listeners cannot wait for an open request before starting a write.
  void connect().catch(() => {});
  let tail = new Promise<void>((ready, reject) => {
    void navigator.locks.request(databaseName + header.id, () => {
      ready();
      return lifetime;
    }).catch(reject);
  });
  let closed = false;
  function write(endedAt: number, entry?: { position: number; value: Entry }, failedArchive?: InterviewRecord) {
    if (closed) return tail;
    return tail = tail.then(async () => {
      database ??= await connect();
      const tx = database.transaction(['sessions', 'rows'], 'readwrite');
      tx.objectStore('sessions').put({ ...header, endedAt, failedArchive });
      if (entry) tx.objectStore('rows').put(entry.value, [header.id, 'answer' in entry.value ? 'a' : 't', entry.position]);
      await complete(tx);
    }).catch(onError);
  }
  return {
    put(position?: number, value?: Entry) {
      return write(Date.now(), value && position !== undefined ? { position, value } : undefined);
    },
    checkpoint(record: InterviewRecord) {
      if (closed || !database) return;
      try {
        const tx = database.transaction(['sessions', 'rows'], 'readwrite');
        tx.objectStore('rows').put({ checkpoint: record }, [header.id, 'checkpoint']);
        tx.objectStore('sessions').put({ ...header, endedAt: record.endedAt });
        tx.commit();
      } catch { onError(); }
    },
    keep(record: InterviewRecord) { return write(record.endedAt, undefined, record); },
    drain() { return tail; },
    async close(saved: boolean) {
      closed = true;
      try {
        await tail;
        await opening?.catch(() => {});
        if (database && saved) await remove(database, header.id);
      } finally {
        database?.close();
        unlock();
      }
    },
  };
}

export async function recoverInterviewDrafts(selected?: ReadonlySet<string>) {
  if (typeof indexedDB === 'undefined' || !globalThis.navigator?.locks) return false;
  // Recovery, deletion and migration readers use the same short-lived lock.
  // The floating window keeps a separate per-session lock for its entire lifetime.
  return navigator.locks.request(databaseName + ':recover', () => recover(selected));
}
async function recover(selected?: ReadonlySet<string>) {
  if (selected) {
    const { held, pending } = await navigator.locks.query();
    if ([...(held ?? []), ...(pending ?? [])].some(lock =>
      lock.name?.startsWith(databaseName) && selected.has(lock.name.slice(databaseName.length))))
      throw Error('请先结束面试。');
  }
  if (!(await indexedDB.databases()).some(database => database.name === databaseName)) return false;
  const db = await openDatabase();
  let changed = false;
  try {
    const scan = db.transaction('sessions');
    const keys = scan.objectStore('sessions').getAllKeys();
    await complete(scan);
    for (const id of keys.result as string[]) {
      if (selected && !selected.has(id)) continue;
      await navigator.locks.request(databaseName + id, { ifAvailable: true }, async lock => {
        if (!lock) {
          if (selected) throw Error('请先结束面试。');
          return;
        }
        const tx = db.transaction(['sessions', 'rows']);
        const header = tx.objectStore('sessions').get(id);
        const rows = tx.objectStore('rows').getAll(range(id));
        await complete(tx);
        if (!header.result) return;
        const saved = await historyRepository.get(id);
        if (saved?.status !== 'ended') {
          const { failedArchive, ...metadata } = header.result;
          if (failedArchive) await historyRepository.save(failedArchive);
          else {
            const entries = rows.result as (Entry | { checkpoint: InterviewRecord })[];
            const checkpoint = entries.find(entry => 'checkpoint' in entry)?.checkpoint;
            const latest = checkpoint && (!saved || saved.endedAt <= checkpoint.endedAt) ? checkpoint : saved;
            const transcripts = new Map(latest?.transcripts.map(row => [row.id, row]));
            const answers = new Map(latest?.answers.map(row => [row.id, row]));
            for (const entry of entries) {
              if ('checkpoint' in entry) continue;
              if ('transcript' in entry) transcripts.set(entry.transcript.id, entry.transcript);
              else answers.set(entry.answer.id, entry.answer);
            }
            await historyRepository.save({
              ...metadata, ...latest, endedAt: Math.max(metadata.endedAt, latest?.endedAt ?? 0),
              status: 'interrupted', mock: false, transcripts: [...transcripts.values()], answers: [...answers.values()],
            });
          }
          changed = true;
        }
        await remove(db, id);
      });
    }
  } finally { db.close(); }
  return changed;
}
