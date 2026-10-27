import { validProfile, type PersonalInfo } from '../../electron/contracts/profile';
import type { SyncKind } from '../../electron/contracts/cloudSync';
import { createHistoryService, historyStorageKey, localHistory } from './history';
import {
  syncKnowledgeSnapshot,
  restoreSyncedBase,
  restoreSyncedDocument,
  validateFiles,
  documentRevision,
} from './knowledge';
import type { KnowledgeBase, LocalDocument } from './knowledgeTypes';
import { validImagePreview } from '../../electron/contracts/interviewImages';

export interface LocalSyncItem {
  key: string;
  kind: SyncKind;
  parent?: string;
  dependencies?: string[];
  localRevision?: string | null;
  blob(): Promise<Blob>;
}
export class CloudDataConflict extends Error {}
const id = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[\w-]{1,100}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const profileKey = 'copilot-personal-info-v1';
const emptyProfile: PersonalInfo = { name: '', jobDescription: '', background: '' };
type Header = { v: number; key: string; metadata?: unknown };
export function packCloudItem(key: string, payload: BlobPart, metadata?: unknown): Blob {
  const json = new TextEncoder().encode(
    JSON.stringify({ v: 1, key, ...(metadata ? { metadata } : {}) }),
  );
  const head = new Uint8Array(8);
  head.set([86, 67, 83, 49]);
  new DataView(head.buffer).setUint32(4, json.length);
  return new Blob([head, json, payload]);
}
export async function unpackCloudItem(
  key: string,
  blob: Blob,
): Promise<{ payload: Blob; metadata: any }> {
  if (blob.size < 8 || blob.size > 64 * 1024 ** 2) throw Error('云端数据大小无效。');
  const prefix = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const size = new DataView(prefix.buffer).getUint32(4);
  if (prefix.slice(0, 4).join() !== '86,67,83,49' || size > 16384 || size + 8 > blob.size)
    throw Error('云端数据格式无效。');
  const header: Header = JSON.parse(await blob.slice(8, 8 + size).text());
  if (header.v !== 1 || header.key !== key) throw Error('云端数据归属不符。');
  return { payload: blob.slice(8 + size), metadata: header.metadata };
}
export async function digestCloudBlob(blob: Blob): Promise<string> {
  if (blob.size > 64 * 1024 ** 2) throw Error('单项同步数据超过64 MiB。');
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
}
function jsonItem(key: string, kind: SyncKind, value: unknown): LocalSyncItem {
  const blob = packCloudItem(key, JSON.stringify(value));
  return { key, kind, blob: async () => blob };
}
export async function localCloudItems(kind: SyncKind): Promise<LocalSyncItem[]> {
  if (kind === 'profile') {
    const raw = localStorage.getItem(profileKey);
    const value = JSON.parse(raw || JSON.stringify(emptyProfile));
    if (!validProfile(value)) throw Error('本地个人信息格式无效，未上传。');
    const snapshot = await syncKnowledgeSnapshot();
    return [
      ...(raw ? [jsonItem('profile:main', 'profile', value)] : []),
      ...snapshot.documents.filter((d) => d.baseId === 'personal-resume').map(fileItem),
    ];
  }
  if (kind === 'history') {
    const records = localHistory.list();
    const images = new Map(
      records.flatMap((r) =>
        r.answers.flatMap((a) => (a.images ?? []).map((i) => [i.id, i] as const)),
      ),
    );
    const imageItems: LocalSyncItem[] = [...images.values()].map((image) => ({
      key: 'image:' + image.id,
      kind: 'history' as const,
      blob: async () => {
        const result = await window.desktop!.interviewImage({ op: 'read', id: image.id });
        if (!result.ok || !result.dataUrl) throw Error('无法读取面试截图，未同步该记录。');
        const match = result.dataUrl.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
        if (!match || match[2].length > 12 * 1024 ** 2) throw Error('截图数据无效。');
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        return packCloudItem('image:' + image.id, bytes, {
          id: image.id,
          preview: image.preview,
          type: match[1],
        });
      },
    }));
    return [
      ...imageItems,
      ...records.map((r) => ({
        ...jsonItem('record:' + r.id, 'history', r),
        dependencies: [
          ...new Set(r.answers.flatMap((a) => (a.images ?? []).map((i) => 'image:' + i.id))),
        ],
      })),
    ];
  }
  const snapshot = await syncKnowledgeSnapshot();
  return [
    ...snapshot.bases.map((b) => ({
      ...jsonItem('base:' + b.id, 'knowledgebase', {
        id: b.id,
        name: b.name,
        createdAt: b.createdAt,
      }),
      localRevision: documentRevision(b),
    })),
    ...snapshot.documents.filter((d) => d.baseId !== 'personal-resume').map(fileItem),
  ];
}
function fileItem(doc: LocalDocument): LocalSyncItem {
  const { blob, localRevision: _revision, ...metadata } = doc;
  const resume = doc.baseId === 'personal-resume';
  const key = resume ? 'resume:main' : 'file:' + doc.id;
  return {
    key,
    kind: resume ? 'profile' : 'knowledgebase',
    parent: resume ? 'profile:main' : 'base:' + doc.baseId,
    localRevision: documentRevision(doc),
    blob: async () => packCloudItem(key, blob, metadata),
  };
}
/** Validate every imported value before publishing it to the existing local stores. */
export async function applyCloudItem(
  key: string,
  blob: Blob,
  expectedHash?: string,
  userId?: string,
  guard = () => {},
) {
  const { payload, metadata } = await unpackCloudItem(key, blob);
  const [type, itemId] = key.split(':');
  if (!id(itemId)) throw Error('同步条目标识无效。');
  const assertCurrent = async () => {
    const kind: SyncKind = /^(profile|resume):/.test(key)
      ? 'profile'
      : /^(record|image):/.test(key)
        ? 'history'
        : 'knowledgebase';
    const current = (await localCloudItems(kind)).find((item) => item.key === key);
    if ((current ? await digestCloudBlob(await current.blob()) : undefined) !== expectedHash)
      throw new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
    guard();
    return current;
  };
  if (type === 'file' || type === 'resume') {
    const m = metadata as LocalDocument;
    if (
      !m ||
      (type === 'resume' ? !id(m.id) || key !== 'resume:main' : m.id !== itemId) ||
      !id(m.baseId) ||
      typeof m.name !== 'string' ||
      /[\\/\u0000-\u001f]/.test(m.name) ||
      m.name.length > 240 ||
      m.size !== payload.size ||
      !finite(m.createdAt) ||
      typeof m.type !== 'string' ||
      m.type.length > 120 ||
      (type === 'resume') !== (m.baseId === 'personal-resume')
    )
      throw Error('云端文件元数据无效。');
    validateFiles([{ name: m.name, size: payload.size }]);
    const current = await assertCurrent();
    await restoreSyncedDocument(
      {
        id: m.id,
        baseId: m.baseId,
        name: m.name,
        size: m.size,
        type: m.type,
        createdAt: m.createdAt,
        blob: payload,
      },
      current?.localRevision ?? null,
      guard,
    );
  } else if (type === 'image') {
    if (
      !metadata ||
      metadata.id !== itemId ||
      payload.size > 8 * 1024 ** 2 ||
      !validImagePreview(metadata.preview)
    )
      throw Error('云端截图数据无效。');
    if (!userId) throw Error('请先登录 VoxCue 账号。');
    guard();
    const result = await window.desktop!.cloudSync({
      action: 'restoreImage',
      userId,
      id: itemId,
      bytes: new Uint8Array(await payload.arrayBuffer()),
      preview: metadata.preview,
    });
    if (!result.ok) throw Error(result.error);
  } else {
    if (payload.size > 8 * 1024 ** 2) throw Error('云端文本数据过大。');
    const value = JSON.parse(await payload.text());
    if (type === 'profile') {
      if (key !== 'profile:main' || !validProfile(value)) throw Error('云端个人信息无效。');
      await assertCurrent();
      localStorage.setItem(profileKey, JSON.stringify(value));
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
      const current = await assertCurrent();
      await restoreSyncedBase(
        { id: itemId, name: b.name, createdAt: b.createdAt },
        current?.localRevision ?? null,
        guard,
      );
    } else if (type === 'record') {
      if (!value || value.id !== itemId) throw Error('云端面试记录无效。');
      const raw = JSON.stringify([value]);
      const records = createHistoryService({
        getItem: (k) => (k === historyStorageKey ? raw : null),
        setItem: () => {},
      }).list();
      if (value.title.length > 80 || /[\u0000-\u001f\u007f]/.test(value.title))
        throw Error('云端面试标题无效。');
      const images = [
        ...new Set(
          records[0].answers.flatMap((answer) => (answer.images ?? []).map((image) => image.id)),
        ),
      ];
      if (images.length > 512) throw Error('单条记录的截图超过同步保护上限，本地记录已保留。');
      for (const id of images) {
        const image = await window.desktop!.interviewImage({ op: 'preview', id });
        if (!image.ok) throw Error('此记录的截图尚未全部恢复，本地记录已保留。');
      }
      await assertCurrent();
      localHistory.save(records[0]);
    } else throw Error('不支持的云端数据类型。');
  }
  window.dispatchEvent(new CustomEvent('voxcue-sync-applied', { detail: type }));
}
