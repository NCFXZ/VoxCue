import {
  maxRestoreItems,
  restoreChunkSize,
  restoreLimit,
  validRestoreKey,
} from '../../electron/contracts/restoreData';
import { digestCloudBlob, digestImportRecord, localCloudItems } from './cloudData';
import { syncKnowledgeSnapshot } from './knowledge';
import { readExistingHistory } from './history';
import { sameValue } from './storedEqual';
import { profileStorageKey } from './storedValues';
import { planSourceRemoval, removeSourceSelection } from './profileImportRemoval';
import type { SourceRemovalPlan } from '../../electron/contracts/accountData';

export async function captureImportSource() {
  const snapshot = await syncKnowledgeSnapshot(true);
  snapshot.bases = snapshot.bases.filter((base) => base.id !== 'personal-resume');
  const entries: {
    key: string;
    blob?: Blob;
    preview?: string;
    imageIds?: string[];
    parent?: string;
  }[] = [];
  const seen = new Set<string>();
  let total = 0;
  const profile = localStorage.getItem(profileStorageKey);
  const history = await readExistingHistory();
  for (const kind of ['profile', 'history', 'knowledgebase'] as const) {
    for (const item of await localCloudItems(kind, snapshot, history)) {
      if (!validRestoreKey(item.key) || seen.has(item.key) || seen.size >= maxRestoreItems)
        throw Error('来源资料的条目无效或过多。');
      seen.add(item.key);
      if (item.key.startsWith('image:')) {
        // Originals and any separately saved preview are resolved by the authorized native source store.
        entries.push({ key: item.key, preview: item.imagePreview });
      } else {
        const blob = await item.blob();
        if (blob.size < 8 || blob.size > 64 * 1024 ** 2 || (total += blob.size) > restoreLimit)
          throw Error('来源资料超过迁移大小限制。');
        const imageIds = item.dependencies?.map((key) => key.slice('image:'.length));
        entries.push({ key: item.key, blob, imageIds, parent: item.parent });
      }
    }
  }
  if (
    profile !== localStorage.getItem(profileStorageKey) ||
    !sameValue(history, await readExistingHistory())
  )
    throw Error('来源资料已改变，请重新选择。');
  return { entries, snapshot, profile, history };
}

/** Lives only in the isolated source window. IDB originals remain immutable Blob handles. */
export async function createProfileImportReader() {
  const source = await captureImportSource();
  const { entries } = source;
  const records = new Map(source.history.map(record => ['record:' + record.id, record]));
  const originals = new Map(source.snapshot.documents.map(doc => [doc.baseId === 'personal-resume' ? 'resume:main' : 'file:' + doc.id, doc]));
  return {
    items: entries.map(({ key, blob, imageIds }) => {
      const doc = originals.get(key);
      const document = doc && { id: doc.id, baseId: doc.baseId, name: doc.name, type: doc.type, size: doc.size, createdAt: doc.createdAt };
      const title = records.get(key)?.title;
      // Old manifests carry only a short title. Read a longer generated title from
      // its complete record so the receiving account can verify the library prefix.
      return { key, size: blob?.size ?? 0, imageIds, ...(document && { document }),
        ...(title !== undefined && title.length <= 80 && { recordTitle: title }) };
    }),
    async itemDigest(index: number) {
      const key = entries[index]?.key;
      const record = records.get(key);
      if (record) return digestImportRecord(record);
      const doc = originals.get(key);
      if (!doc) throw Error('迁移资料无效。');
      return digestCloudBlob(doc.blob);
    },
    preview(index: number) {
      return entries[index]?.preview ?? null;
    },
    planRemoval: (keys: string[]) => planSourceRemoval(source, keys),
    async removeSelected(plan: SourceRemovalPlan, owner: string) {
      return removeSourceSelection(await captureImportSource(), plan, owner);
    },
    async read(index: number, offset: number) {
      const blob = entries[index]?.blob;
      if (!blob || !Number.isSafeInteger(offset) || offset < 0 || offset >= blob.size)
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
