import { validProfile, type PersonalInfo } from '../../electron/contracts/profile';
import { CLOUD_ITEM_MAX_BYTES, CLOUD_RECORD_MAX_IMAGES, type SyncKind } from '../../electron/contracts/cloudSync';
import {
  validHistoryRecord,
  historyRepository,
  type HistorySummary,
  type InterviewRecord,
} from './history';
import { CloudDataConflict, localChanged } from './localChanges';
import { SyncYield } from './cloudLifecycle';
export { CloudDataConflict } from './localChanges';
import { commitWithHistoryImages, historyImageIds, restoreHistoryImage } from './historyImageRemoval';
import { removeHistoryRecord } from './historyRecordingRemoval';
import { hasSavedProfile, legacyProfileModificationKey, profileStorageKey, readStoredProfile } from './storedValues';
import {
  localKnowledge,
  readKnowledgeOriginal,
  syncKnowledgeSnapshot,
  restoreSyncedBase,
  restoreSyncedDocument,
  removeSyncedKnowledgeOriginal,
  validateFiles,
  documentRevision,
} from './knowledge';
import type { KnowledgeBase, LocalDocument } from './knowledgeTypes';
import { validImagePreview } from '../../electron/contracts/interviewImages';
import { validImportRecordTitle, type ImportDocumentInfo } from '../../electron/contracts/accountData';
import { validKnowledgeDocumentName } from '../../electron/contracts/knowledge';
import { packCloudItem } from '../../electron/contracts/restoreData';
export { packCloudItem } from '../../electron/contracts/restoreData';

export interface LocalSyncItem {
  key: string;
  kind: SyncKind;
  parent?: string;
  dependencies?: string[];
  imagePreview?: string;
  localRevision?: string | null;
  digest?(): Promise<string>;
  blob(): Promise<Blob>;
}
const id = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[\w-]{1,100}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
type Header = { v: number; key: string; metadata?: unknown };
export async function unpackCloudItem(
  key: string,
  blob: Blob,
): Promise<{ payload: Blob; metadata: any }> {
  if (blob.size < 8 || blob.size > CLOUD_ITEM_MAX_BYTES) throw Error('云端数据大小无效。');
  const prefix = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const size = new DataView(prefix.buffer).getUint32(4);
  const headerLimit = key.startsWith('image:') ? 132 * 1024 : 16384;
  if (prefix.slice(0, 4).join() !== '86,67,83,49' || size > headerLimit || size + 8 > blob.size)
    throw Error('云端数据格式无效。');
  const header: Header = JSON.parse(await blob.slice(8, 8 + size).text());
  if (header.v !== 1 || header.key !== key) throw Error('云端数据归属不符。');
  return { payload: blob.slice(8 + size), metadata: header.metadata };
}
/** A verified first transport chunk contains the complete bounded envelope header. */
export async function cloudFileParent(key: string, firstChunk: Blob): Promise<string> {
  const { metadata } = await unpackCloudItem(key, firstChunk);
  if (
    !key.startsWith('file:') ||
    !metadata ||
    metadata.id !== key.slice(5) ||
    !id(metadata.baseId) ||
    metadata.baseId === 'personal-resume'
  )
    throw Error('云端文件所属知识库无效。');
  return 'base:' + metadata.baseId;
}
export async function digestCloudBlob(blob: Blob): Promise<string> {
  if (blob.size > CLOUD_ITEM_MAX_BYTES) throw Error('单项同步数据超过64 MiB。');
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
}
export function digestImportRecord(record: InterviewRecord) {
  // Compare stored values independent of object-key order, preserving array order.
  const text = JSON.stringify(record, (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return digestCloudBlob(new Blob([text]));
}
function jsonItem(key: string, kind: SyncKind, value: unknown): LocalSyncItem {
  let blob: Blob | undefined;
  return { key, kind, blob: async () => blob ??= packCloudItem(key, JSON.stringify(value)) };
}
function cloudRecord(key: string, value: unknown) {
  if (!validHistoryRecord(value) || !id(value.id) || key !== 'record:' + value.id)
    throw Error('云端面试记录无效。');
  if (!validImportRecordTitle(key, value.title, value.title.length > 80 && value.titleSource === 'generated' ? value.knowledgeBaseName : undefined))
    throw Error('云端面试标题无效。');
  const images = [...new Set(historyImageIds(value))];
  if (images.length > CLOUD_RECORD_MAX_IMAGES) throw Error('单条记录的截图超过同步保护上限，本地记录已保留。');
  return { type: 'record' as const, record: value, images };
}
export function packRecord(key: string, record: InterviewRecord) {
  cloudRecord(key, record);
  const blob = packCloudItem(key, JSON.stringify(record));
  if (blob.size > CLOUD_ITEM_MAX_BYTES) throw Error('单项同步数据超过64 MiB。');
  return blob;
}
function recordCloudItem(record: InterviewRecord): LocalSyncItem {
  const key = 'record:' + record.id;
  let packed: Blob | undefined;
  return {
    key, kind: 'history', blob: async () => packed ??= packRecord(key, record),
    dependencies: [...new Set(historyImageIds(record))].map(id => 'image:' + id),
  };
}
function cloudImage(image: { id: string; preview?: string }, lookupPreview = false): LocalSyncItem {
  const preview = async () => lookupPreview ? (await historyRepository.imageReference(image.id))?.preview : image.preview;
  return {
    key: 'image:' + image.id,
    kind: 'history' as const,
    imagePreview: image.preview,
    digest: async () => {
      const result = await window.desktop!.interviewImage({ op: 'syncDigest', id: image.id, preview: await preview() });
      if (!result.ok || !result.hash || !/^[0-9a-f]{64}$/.test(result.hash))
        throw Error('无法读取面试截图，未同步该记录。');
      return result.hash;
    },
    blob: async () => {
      const result = await window.desktop!.interviewImage({ op: 'syncBytes', id: image.id, preview: await preview() });
      if (!result.ok || !result.bytes?.length) throw Error('无法读取面试截图，未同步该记录。');
      return new Blob([result.bytes]);
    },
  };
}
function historyCloudItems(records: InterviewRecord[]) {
  const images = new Map<string, { id: string; preview?: string }>();
  for (const record of records)
    for (const answer of record.answers)
      for (const image of answer.images ?? [])
        if (image.preview || !images.has(image.id)) images.set(image.id, image);
  return [...Array.from(images.values(), image => cloudImage(image)), ...records.map(recordCloudItem)];
}
// Keep at most one packed record for consecutive reads of the same committed revision.
let lastCloudRecord: { storage: Storage; id: string; revision: string; blob: Blob } | undefined;

function listedRecord({ id, revision, imageIds }: HistorySummary): LocalSyncItem {
  const key = 'record:' + id;
  return {
    key, kind: 'history', localRevision: revision,
    dependencies: imageIds.map(imageId => 'image:' + imageId),
    blob: async () => {
      const cached = lastCloudRecord;
      if (cached?.storage === localStorage && cached.id === id && cached.revision === revision) {
        if ((await historyRepository.summary(id))?.revision !== revision)
          throw new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
        return cached.blob;
      }
      const record = await historyRepository.get(id, revision);
      if (!record) throw new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
      const blob = packRecord(key, record);
      lastCloudRecord = { storage: localStorage, id, revision, blob };
      return blob;
    },
  };
}

export async function localCloudItems(
  kind: SyncKind,
  source?: Awaited<ReturnType<typeof syncKnowledgeSnapshot>>,
  sourceHistory?: InterviewRecord[],
): Promise<LocalSyncItem[]> {
  if (kind === 'profile') {
    const raw = localStorage.getItem(profileStorageKey);
    const profile = raw ? readStoredProfile(raw) : undefined;
    const resumes = source
      ? source.documents.filter((d) => d.baseId === 'personal-resume')
      : await localKnowledge.listDocuments('personal-resume');
    return [
      ...(profile && (!source || hasSavedProfile(profile)) ? [jsonItem('profile:main', 'profile', profile)] : []),
      ...resumes.map(fileItem),
    ];
  }
  if (kind === 'history') {
    if (sourceHistory) return historyCloudItems(sourceHistory);
    const summaries = await historyRepository.summaries();
    const ids = new Set(summaries.flatMap(row => row.imageIds));
    const embedded = new Set(summaries.flatMap(row => row.embeddedPreviewIds ?? row.imageIds));
    return [...Array.from(ids, id => cloudImage({ id }, embedded.has(id))), ...summaries.map(listedRecord)];
  }
  const snapshot = source ?? await syncKnowledgeSnapshot();
  return [
    ...snapshot.bases.map(baseItem),
    ...snapshot.documents.filter((d) => d.baseId !== 'personal-resume').map(fileItem),
  ];
}
function baseItem(base: KnowledgeBase): LocalSyncItem {
  const { id, name, createdAt } = base;
  return { ...jsonItem('base:' + id, 'knowledgebase', { id, name, createdAt }),
    localRevision: documentRevision(base) };
}
export async function localCloudItem(kind: SyncKind, key: string): Promise<LocalSyncItem | undefined> {
  if (kind === 'history') {
    if (key.startsWith('image:')) {
      const image = await historyRepository.imageReference(key.slice(6));
      return image && cloudImage(image);
    }
    if (!key.startsWith('record:')) return;
    const id = key.slice(7);
    const summary = await historyRepository.summary(id);
    return summary && listedRecord(summary);
  }
  if (kind === 'profile') return (await localCloudItems(kind)).find((entry) => entry.key === key);
  if (key.startsWith('base:')) {
    const base = await readKnowledgeOriginal('bases', key.slice(5));
    return base && baseItem(base);
  }
  if (key.startsWith('file:')) {
    const doc = await readKnowledgeOriginal('documents', key.slice(5));
    if (doc && doc.baseId !== 'personal-resume') return fileItem(doc);
  }
}
const documentFields = new Set(['id', 'baseId', 'name', 'size', 'type', 'createdAt']);
function documentMetadata(doc: ImportDocumentInfo): ImportDocumentInfo {
  // The cloud digest covers JSON key order. Retain the order of validated wire fields on restore.
  return Object.fromEntries(Object.entries(doc).filter(([key]) => documentFields.has(key))) as ImportDocumentInfo;
}
function fileItem(doc: LocalDocument): LocalSyncItem {
  const resume = doc.baseId === 'personal-resume';
  const key = resume ? 'resume:main' : 'file:' + doc.id;
  return {
    key,
    kind: resume ? 'profile' : 'knowledgebase',
    parent: resume ? 'profile:main' : 'base:' + doc.baseId,
    localRevision: documentRevision(doc),
    blob: async () => packCloudItem(key, doc.blob, documentMetadata(doc)),
  };
}
type DecodedItem =
  | { type: 'file' | 'resume'; document: LocalDocument }
  | { type: 'image'; id: string; preview: string; payload: Blob }
  | { type: 'profile'; profile: PersonalInfo }
  | { type: 'base'; base: KnowledgeBase }
  | { type: 'record'; record: InterviewRecord; images: string[] };

async function readRecordJson(payload: Blob): Promise<unknown> {
  if (payload.size <= 8 * 1024 ** 2 || typeof Worker === 'undefined') return JSON.parse(await payload.text());
  const worker = new Worker(new URL('./cloudRecordJson.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(Error('云端面试记录无效。'));
      worker.onmessage = ({ data }) => data?.ok ? resolve(data.value) : fail();
      worker.onerror = worker.onmessageerror = fail;
      worker.postMessage(payload);
    });
  } finally { worker.terminate(); }
}

/** The same reader validates cloud downloads and portable account archives before any writes. */
export async function decodeCloudItem(key: string, blob: Blob): Promise<DecodedItem> {
  const { payload, metadata } = await unpackCloudItem(key, blob);
  const [type, itemId, extra] = key.split(':');
  if (!id(itemId) || extra !== undefined) throw Error('同步条目标识无效。');
  if (type === 'file' || type === 'resume') {
    const m = metadata as LocalDocument;
    if (
      !m ||
      (type === 'resume' ? !id(m.id) || key !== 'resume:main' : m.id !== itemId) ||
      !id(m.baseId) ||
      !validKnowledgeDocumentName(m.name) ||
      m.size !== payload.size ||
      !finite(m.createdAt) ||
      typeof m.type !== 'string' ||
      m.type.length > 120 ||
      (type === 'resume') !== (m.baseId === 'personal-resume')
    )
      throw Error('云端文件元数据无效。');
    validateFiles([{ name: m.name, size: payload.size }]);
    return { type, document: { ...documentMetadata(m), blob: payload } };
  } else if (type === 'image') {
    if (
      !metadata ||
      metadata.id !== itemId ||
      payload.size > 8 * 1024 ** 2 ||
      !validImagePreview(metadata.preview)
    )
      throw Error('云端截图数据无效。');
    return { type, id: itemId, payload, preview: metadata.preview };
  } else if (type === 'record') {
    // The complete envelope was bounded before reading its header. Parse this record once.
    return cloudRecord(key, await readRecordJson(payload));
  } else {
    if (payload.size > 8 * 1024 ** 2) throw Error('云端文本数据过大。');
    const value = JSON.parse(await payload.text());
    if (type === 'profile') {
      if (key !== 'profile:main' || !validProfile(value)) throw Error('云端个人信息无效。');
      return { type, profile: value };
    } else if (type === 'base') {
      const b = value as KnowledgeBase;
      if (
        !b ||
        b.id !== itemId ||
        typeof b.name !== 'string' ||
        !b.name.trim() ||
        b.name.length > 60 ||
        !finite(b.createdAt)
      )
        throw Error('云端知识库无效。');
      return { type, base: { id: itemId, name: b.name, createdAt: b.createdAt } };
    } else throw Error('不支持的云端数据类型。');
  }
}

async function writeCloudImage(item: Extract<DecodedItem, { type: 'image' }>, userId: string | undefined, guard: () => void) {
  if (!userId) throw Error('请先登录 VoxCue 账号。');
  const bytes = new Uint8Array(await item.payload.arrayBuffer());
  guard();
  const result = await window.desktop!.cloudSync({
    action: 'restoreImage', userId, id: item.id, bytes, preview: item.preview,
  });
  if (!result.ok) {
    if (result.deferred === 'interview') throw new SyncYield(result.error);
    throw Error(result.error);
  }
  guard();
}

const localConflict = () => new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');

export async function removeLocalSyncItem(key: string, expectedHash: string, guard: () => void, root: string) {
  guard();
  const [kind, itemId, extra] = key.split(':');
  if (!id(itemId) || extra !== undefined) throw Error('同步条目标识无效。');
  if (kind === 'image') {
    // Replacing/removing the owning record journals orphan cleanup. A shared image stays
    // live until the last reference is removed, including references added in another window.
    if (!/^record:[\w-]{1,100}$/.test(root) || (await historyRepository.imageOwners(itemId)).length)
      throw localConflict();
    guard();
    return;
  }
  if (kind === 'record') {
    if (root !== key) throw localConflict();
    const before = await historyRepository.get(itemId);
    if (!before || await digestCloudBlob(await recordCloudItem(before).blob()) !== expectedHash) throw localConflict();
    await commitWithHistoryImages(async () => {
      const pending = await removeHistoryRecord(itemId, { expected: before, guard, notify: false });
      if (pending) throw Error(pending);
    });
  } else if (key === 'profile:main') {
    if (root !== key) throw localConflict();
    const raw = localStorage.getItem(profileStorageKey);
    if (!raw || await digestCloudBlob(await jsonItem(key, 'profile', readStoredProfile(raw)).blob()) !== expectedHash)
      throw localConflict();
    guard();
    if (localStorage.getItem(profileStorageKey) !== raw) throw localConflict();
    localStorage.removeItem(profileStorageKey);
    localStorage.removeItem(legacyProfileModificationKey);
  } else if (kind === 'file' || kind === 'base' || (kind === 'resume' && key === 'resume:main')) {
    const resume = kind === 'resume';
    const source = await localCloudItem(resume ? 'profile' : 'knowledgebase', key);
    if (!source?.localRevision || (source.parent ?? key) !== root) throw localConflict();
    const blob = await source.blob();
    if (await digestCloudBlob(blob) !== expectedHash) throw localConflict();
    const baseId = resume ? 'personal-resume' : root.slice('base:'.length);
    const originalId = resume ? (await unpackCloudItem(key, blob)).metadata.id : itemId;
    if (!id(originalId) || !id(baseId) || (!resume && baseId === 'personal-resume'))
      throw Error('同步条目标识无效。');
    await removeSyncedKnowledgeOriginal(kind, originalId, baseId, source.localRevision, guard);
  } else throw Error('同步条目标识无效。');
  window.dispatchEvent(new CustomEvent('voxcue-sync-applied', { detail: kind }));
}

export async function applyCloudItem(
  key: string,
  blob: Blob,
  expectedHash?: string,
  userId?: string,
  guard = () => {},
  readMissingImage?: (id: string) => Promise<Blob | undefined>,
  groupKey?: string,
  reviewedImageOwners?: readonly string[],
) {
  const item = await decodeCloudItem(key, blob);
  let restoredDocument: LocalDocument | undefined;
  const assertCurrent = async () => {
    const kind: SyncKind = /^(profile|resume):/.test(key)
      ? 'profile'
      : /^(record|image):/.test(key)
        ? 'history'
        : 'knowledgebase';
    const current = await localCloudItem(kind, key);
    if ((current ? await digestCloudBlob(await current.blob()) : undefined) !== expectedHash)
      throw new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
    guard();
    return current;
  };
  if (item.type === 'file' || item.type === 'resume') {
    const current = await assertCurrent();
    restoredDocument = await restoreSyncedDocument(
      item.document,
      current?.localRevision ?? null,
      guard,
    );
  } else if (item.type === 'image') {
    await restoreHistoryImage(item.id, async () => {
      if (groupKey) {
        const current = await localCloudItem('history', key);
        if ((await current?.digest?.()) !== expectedHash) throw localConflict();
        const owners = new Set(reviewedImageOwners ?? [groupKey]);
        if ((await historyRepository.imageOwners(item.id)).some(owner => !owners.has('record:' + owner)))
          throw localConflict();
      }
      await writeCloudImage(item, userId, guard);
    });
  } else if (item.type === 'profile') {
    const before = localStorage.getItem(profileStorageKey);
    await assertCurrent();
    guard();
    if (localStorage.getItem(profileStorageKey) !== before)
      throw new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
    localStorage.setItem(profileStorageKey, JSON.stringify(item.profile));
  } else if (item.type === 'base') {
    const current = await assertCurrent();
    await restoreSyncedBase(item.base, current?.localRevision ?? null, guard);
  } else if (item.type === 'record') {
    await commitWithHistoryImages(async () => {
      guard();
      for (const id of item.images) {
        // Omitting the embedded thumbnail verifies both files, even on a warm digest cache.
        const image = await window.desktop!.interviewImage({ op: 'syncDigest', id });
        if (image.ok) continue;
        // Cleanup may have completed between two record transfers before a restart.
        guard();
        const blob = await readMissingImage?.(id);
        const missing = blob && await decodeCloudItem('image:' + id, blob);
        if (missing?.type !== 'image') throw Error('此记录的截图尚未全部恢复，本地记录已保留。');
        await writeCloudImage(missing, userId, guard);
      }
      const before = await historyRepository.get(item.record.id);
      const currentHash = before ? await digestCloudBlob(await recordCloudItem(before).blob()) : undefined;
      if (currentHash !== expectedHash)
        throw new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
      const restored = await historyRepository.save(item.record, { expected: before ?? null, guard, notify: false,
        replaceTitle: groupKey === key });
      if (restored !== item.record && JSON.stringify(restored) !== JSON.stringify(item.record))
        localChanged('history', [key]);
    });
  }
  window.dispatchEvent(new CustomEvent('voxcue-sync-applied', { detail: item.type }));
  return restoredDocument;
}
