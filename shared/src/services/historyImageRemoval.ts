import { validImageId } from '../../electron/contracts/interviewImages';
import type { InterviewRecord } from './history';

// Kept beside history in the account's own renderer storage partition.
const key = 'voxcue-pending-history-image-removals-v1';
type JournalStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const historyImageIds = (record: InterviewRecord) =>
  record.answers.flatMap(answer => answer.images?.map(image => image.id) ?? []);
// Once a cleanup starts, its last batch may be busy. New arrivals get an independent batch.
const openTail = new WeakMap<JournalStorage, string>();

function pending(storage: JournalStorage): string[][] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  const batches: unknown = JSON.parse(raw);
  if (!Array.isArray(batches) || !batches.every(batch =>
    Array.isArray(batch) && batch.length <= 100 && batch.every(validImageId)))
    throw Error('截图清理记录无法读取。');
  return batches;
}

export function stageHistoryImages(storage: JournalStorage, record: InterviewRecord, replacement?: InterviewRecord) {
  const originals = historyImageIds(record).filter(validImageId);
  if (!originals.length) return;
  const retained = replacement && new Set(historyImageIds(replacement));
  const ids = retained ? originals.filter(id => !retained.has(id)) : originals;
  if (!ids.length) return;
  const batches = pending(storage);
  const queued = new Set(batches.flat());
  const added = [...new Set(ids)].filter(id => !queued.has(id));
  if (!added.length) return;
  const tail = batches.at(-1);
  if (tail?.length && tail[0] === openTail.get(storage))
    tail.push(...added.splice(0, 100 - tail.length));
  for (let offset = 0; offset < added.length; offset += 100) batches.push(added.slice(offset, offset + 100));
  storage.setItem(key, JSON.stringify(batches));
  openTail.set(storage, batches.at(-1)![0]);
}

function acknowledge(ids: string[]) {
  const completed = new Set(ids);
  const batches = pending(localStorage);
  if (!batches.some(batch => batch.some(id => completed.has(id)))) return;
  const remaining = batches.map(batch => batch.filter(id => !completed.has(id))).filter(batch => batch.length);
  if (remaining.length) localStorage.setItem(key, JSON.stringify(remaining));
  else localStorage.removeItem(key);
}

let imageWork = Promise.resolve();
let pendingTransfers = 0;

// A cloud batch can move a reference from an earlier record to a later one.
export function deferHistoryImageCleanup() {
  pendingTransfers++;
  return () => { pendingTransfers--; };
}

function serialize(action: () => Promise<void>): Promise<void> {
  const work = imageWork.then(action);
  imageWork = work.catch(() => {});
  return work;
}

// A restore owns its originals even when the cloud record arrives in a later transfer.
export function restoreHistoryImage(id: string, restore: () => Promise<void>): Promise<void> {
  return serialize(async () => {
    await restore();
    acknowledge([id]);
  });
}

export function commitWithHistoryImages(commit: () => Promise<void>): Promise<void> {
  return serialize(commit);
}

export function recoverHistoryImages(references: (batch: string[]) => ReadonlySet<string> | Promise<ReadonlySet<string>>): Promise<void> {
  return serialize(async () => {
    if (pendingTransfers) return;
    openTail.delete(localStorage);
    let failed = false;
    for (const batch of pending(localStorage)) {
      if (pendingTransfers) break;
      const retained = await references(batch);
      if (pendingTransfers) break;
      const shared = batch.filter(id => retained.has(id));
      // Forget protected IDs synchronously so a subsequent deletion can enqueue them again.
      if (shared.length) acknowledge(shared);
      const unused = batch.filter(id => !retained.has(id));
      if (!unused.length) continue;
      const result = await window.desktop?.interviewImage?.({ op: 'remove', ids: unused }).catch(() => undefined);
      if (!result?.ok) {
        failed = true;
        continue;
      }
      acknowledge(unused);
    }
    if (failed) throw Error('截图清理失败。');
  });
}
