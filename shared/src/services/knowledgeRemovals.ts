import { validKnowledgeId } from '../../electron/contracts/knowledge';

export interface KnowledgeRemoval {
  baseId: string;
  documentId?: string;
  revision: string | null;
}

export const knowledgeRemovalKey = ({ baseId, documentId }: Pick<KnowledgeRemoval, 'baseId' | 'documentId'>) =>
  documentId ? `file:${documentId}` : `base:${baseId}`;

const database = 'voxcue-knowledge-removals';
const store = 'removals';
const failure = () => Error('无法保存或读取后台删除任务，请重试。');
type RemovalSubmission = 'removed' | 'queued' | false;
const saving = new Set<Promise<RemovalSubmission>>();
const journals = new WeakMap<IDBFactory, {
  saved: Map<string, KnowledgeRemoval>;
  accepting: Set<string>;
  ready?: Promise<void>;
}>();

function journal() {
  let current = journals.get(indexedDB);
  if (!current) {
    current = { saved: new Map(), accepting: new Set() };
    journals.set(indexedDB, current);
  }
  return current;
}

async function access<T>(mode: IDBTransactionMode, run: (entries: IDBObjectStore) => IDBRequest<T>) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(failure());
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode, { durability: 'strict' });
      const request = run(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(failure());
    });
  } finally {
    db.close();
  }
}

function valid({ baseId, documentId, revision }: KnowledgeRemoval) {
  return validKnowledgeId(baseId) && baseId !== 'personal-resume' &&
    (documentId === undefined || validKnowledgeId(documentId)) && typeof revision === 'string' && !!revision;
}

export function loadKnowledgeRemovals() {
  const current = journal();
  return current.ready ??= (async () => {
    if (typeof indexedDB.databases === 'function' &&
        !(await indexedDB.databases()).some(entry => entry.name === database)) return;
    const entries = await access<KnowledgeRemoval[]>('readonly', rows => rows.getAll());
    if (entries.some(entry => !entry || !valid(entry))) throw failure();
    for (const entry of entries) current.saved.set(knowledgeRemovalKey(entry), entry);
  })().catch(error => {
    current.ready = undefined;
    throw error;
  });
}

export function pendingKnowledgeRemovals(): KnowledgeRemoval[] {
  return [...journal().saved.values()];
}

export function knowledgeRemovalPending(key: string) {
  if (typeof indexedDB === 'undefined') return false;
  const { saved, accepting } = journal();
  return saved.has(key) || accepting.has(key);
}

export function saveKnowledgeRemoval(removal: KnowledgeRemoval, removeOrVerify: () => Promise<boolean>) {
  const write = commitRemoval(removal, removeOrVerify);
  saving.add(write);
  const settled = () => { saving.delete(write); };
  void write.then(settled, settled);
  return write;
}

export async function flushKnowledgeRemovalRequests() {
  // Normal window close must preserve accepted clicks, even when it arrives during the journal write.
  await Promise.allSettled(saving);
}

async function commitRemoval(removal: KnowledgeRemoval, removeOrVerify: () => Promise<boolean>): Promise<RemovalSubmission> {
  if (!valid(removal)) throw Error('知识库无效。');
  await loadKnowledgeRemovals();
  const current = journal();
  const key = knowledgeRemovalKey(removal);
  if (knowledgeRemovalPending(key) || (removal.documentId && knowledgeRemovalPending(`base:${removal.baseId}`)))
    return false;
  current.accepting.add(key);
  try {
    if (await removeOrVerify()) return 'removed';
    await access('readwrite', rows => rows.put(removal, key));
    current.saved.set(key, removal);
    return 'queued';
  } finally {
    current.accepting.delete(key);
  }
}

export async function finishKnowledgeRemoval(removal: KnowledgeRemoval) {
  const key = knowledgeRemovalKey(removal);
  await access('readwrite', rows => rows.delete(key));
  journal().saved.delete(key);
}
