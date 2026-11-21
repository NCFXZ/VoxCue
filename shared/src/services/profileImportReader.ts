import {
  maxRestoreItems,
  restoreChunkSize,
  restoreLimit,
  validRestoreKey,
} from '../../electron/contracts/restoreData';
import { digestCloudBlob, digestImportRecord, localCloudItems, packRecord } from './cloudData';
import { syncKnowledgeSnapshot } from './knowledge';
import { readImportHistory, type HistorySummary } from './history';
import { profileStorageKey } from './storedValues';
import { planSourceRemoval, removeSourceSelection } from './profileImportRemoval';
import { validImportRecordTitle, type SourceRemovalPlan } from '../../electron/contracts/accountData';

type Entry = { key: string; blob?: Blob; record?: HistorySummary; imageIds?: string[]; parent?: string };

export async function captureImportSource() {
  const snapshot = await syncKnowledgeSnapshot(true);
  snapshot.bases = snapshot.bases.filter(base => base.id !== 'personal-resume');
  const history = await readImportHistory();
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const previewOwners = new Map<string, HistorySummary[]>();
  let total = 0;
  const add = (entry: Entry) => {
    if (!validRestoreKey(entry.key) || seen.has(entry.key) || seen.size >= maxRestoreItems)
      throw Error('来源资料的条目无效或过多。');
    if (entry.blob && (entry.blob.size < 8 || entry.blob.size > 64 * 1024 ** 2 ||
        (total += entry.blob.size) > restoreLimit)) throw Error('来源资料超过迁移大小限制。');
    seen.add(entry.key);
    entries.push(entry);
  };
  const profile = localStorage.getItem(profileStorageKey);
  for (const kind of ['profile', 'history', 'knowledgebase'] as const) {
    if (kind === 'history') {
      for (const row of history.rows) {
        for (const id of row.imageIds) {
          const key = 'image:' + id;
          if (!seen.has(key)) add({ key });
        }
        for (const id of row.embeddedPreviewIds ?? row.imageIds) {
          const owners = previewOwners.get(id) ?? [];
          owners.push(row);
          previewOwners.set(id, owners);
        }
      }
      for (const row of history.rows) {
        const key = 'record:' + row.id;
        const library = row.title.length > 80 && row.titleSource === 'generated' ? row.knowledgeBaseName : undefined;
        if (!validImportRecordTitle(key, row.title, library)) throw Error('云端面试标题无效。');
        add({ key, record: row, imageIds: row.imageIds });
      }
    } else {
      for (const item of await localCloudItems(kind, snapshot))
        add({ key: item.key, blob: await item.blob(), parent: item.parent });
    }
  }
  if (profile !== localStorage.getItem(profileStorageKey)) throw Error('来源资料已改变，请重新选择。');
  let lastRecord: { entry: Entry; blob: Blob } | undefined;
  const blobFor = async (entry: Entry) => {
    if (entry.blob) return entry.blob;
    if (!entry.record) throw Error('迁移资料无效。');
    if (lastRecord?.entry === entry) return lastRecord.blob;
    const blob = packRecord(entry.key, await history.read(entry.record));
    lastRecord = { entry, blob };
    return blob;
  };
  return { entries, snapshot, profile, history, blobFor, previewOwners };
}

/** Lives only in the isolated source window. IDB originals remain immutable Blob handles. */
export async function createProfileImportReader() {
  const source = await captureImportSource();
  const { entries } = source;
  const originals = new Map(source.snapshot.documents.map(doc => [doc.baseId === 'personal-resume' ? 'resume:main' : 'file:' + doc.id, doc]));
  return {
    items: entries.map(({ key, blob, imageIds, record }) => {
      const doc = originals.get(key);
      const document = doc && { id: doc.id, baseId: doc.baseId, name: doc.name, type: doc.type, size: doc.size, createdAt: doc.createdAt };
      return { key, size: blob?.size ?? 0, imageIds, ...(document && { document }),
        ...(record && { recordTitle: record.title }),
        ...(record && record.title.length > 80 && { recordLibraryName: record.knowledgeBaseName }) };
    }),
    async recordSize(index: number) {
      const entry = entries[index];
      if (!entry?.record) throw Error('迁移资料无效。');
      return (await source.blobFor(entry)).size;
    },
    async itemDigest(index: number) {
      const entry = entries[index];
      if (entry?.record) return digestImportRecord(await source.history.read(entry.record));
      const doc = originals.get(entry?.key);
      if (!doc) throw Error('迁移资料无效。');
      return digestCloudBlob(doc.blob);
    },
    async preview(index: number) {
      const id = entries[index]?.key.slice('image:'.length);
      const owners = source.previewOwners.get(id) ?? [];
      for (let i = owners.length - 1; i >= 0; i--) {
        const preview = await source.history.preview(owners[i], id);
        if (preview) return preview;
      }
      return null;
    },
    planRemoval: (keys: string[]) => planSourceRemoval(source, keys),
    async removeSelected(plan: SourceRemovalPlan, owner: string) {
      return removeSourceSelection(await captureImportSource(), plan, owner);
    },
    async read(index: number, offset: number) {
      const entry = entries[index];
      if (!entry) throw Error('迁移资料无效。');
      const blob = await source.blobFor(entry);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= blob.size)
        throw Error('迁移资料偏移量无效。');
      const reader = new FileReader();
      return new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(Error('读取来源资料失败。'));
        reader.readAsDataURL(blob.slice(offset, offset + restoreChunkSize));
      });
    },
  };
}
