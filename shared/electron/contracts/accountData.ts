import { validKnowledgeDocumentName } from './knowledge';
import { profileFields } from './profile';
import { maxRestoreItems } from './restoreData';

/** Each selected profile field comes from the same source manifest item. */
export function withinImportItemLimit<T>(rows: readonly T[], getKey: (row: T) => unknown) {
  if (rows.length <= maxRestoreItems) return true;
  if (rows.length > maxRestoreItems + profileFields.length) return false;
  const fields = rows.filter(row => {
    const key = getKey(row);
    return typeof key === 'string' && key.startsWith('profile:');
  });
  return rows.length - fields.length + Number(fields.length > 0) <= maxRestoreItems;
}
/** Main chooses every filesystem path. Renderer sends bounded original-file chunks only. */
export interface ImportDocumentInfo {
  id: string;
  baseId: string;
  name: string;
  size: number;
  type: string;
  createdAt: number;
}
export function validImportDocument(key: string, info: ImportDocumentInfo): boolean {
  const id = (v: unknown) => typeof v === 'string' && /^[\w-]{1,100}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
  return !!info && id(info.id) && id(info.baseId) &&
    (key === 'resume:main' ? info.baseId === 'personal-resume' : key === 'file:' + info.id && info.baseId !== 'personal-resume') &&
    validKnowledgeDocumentName(info.name) &&
    typeof info.type === 'string' && info.type.length <= 120 && Number.isSafeInteger(info.size) && info.size >= 0 &&
    info.size <= 64 * 1024 ** 2 && Number.isSafeInteger(info.createdAt) && info.createdAt >= 0;
}
export interface AccountImportItem {
  key: string;
  /** Images and records with preview titles can defer envelope sizing until needed. */
  size: number;
  /** Immutable screenshot references of an interview in the unlocked source snapshot. */
  imageIds?: string[];
  document?: ImportDocumentInfo;
  recordTitle?: string;
  /** Present for generated titles longer than 80 characters, including the library prefix. */
  recordLibraryName?: string;
}
export function validImportRecordTitle(key: string, title: unknown, libraryName?: unknown): title is string {
  if (!key.startsWith('record:') || typeof title !== 'string' || title.length > 142 || /[\u0000-\u001f\u007f]/.test(title)) return false;
  if (title.length <= 80) return libraryName === undefined;
  if (typeof libraryName !== 'string' || !libraryName.trim() || libraryName.length > 60) return false;
  const prefix = '「' + libraryName + '」';
  const caption = title.slice(prefix.length);
  return title.startsWith(prefix) && !!caption.trim() && caption.length <= 80 && !/[<>`]/.test(caption);
}
export function validImportEnvelopeSize(size: unknown): size is number {
  return typeof size === 'number' && Number.isSafeInteger(size) && size >= 8 && size <= 64 * 1024 ** 2;
}
export function validImportItemSize(key: string, size: unknown, title?: unknown, libraryName?: unknown): size is number {
  return validImportEnvelopeSize(size) ||
    (size === 0 && (key.startsWith('image:') || validImportRecordTitle(key, title, libraryName)));
}
export interface AccountImportSource {
  id: string;
  email?: string;
}
export interface SourceRemovalPlan {
  items: { key: string; hash: string; documentId?: string; baseId?: string; imageIds?: string[] }[];
}
export interface SourceRemovalResult {
  imageIds: string[];
  recordIds: string[];
  documentIds: string[];
  localRevision: string | null;
}
export type AccountImportCall =
  | { action: 'listImportSources' }
  | { action: 'openImport'; sourceId: string }
  | { action: 'unlockImport'; token: string; password?: string }
  | { action: 'readImport'; token: string; key: string; offset: number }
  | { action: 'digestImportItem'; token: string; key: string }
  | {
      action: 'prepareImportCommit';
      token: string;
      keys: string[];
      recordIds: string[];
      imageIds: string[];
    }
  | { action: 'closeImport'; token: string; committed?: boolean };
export type AccountExportCall =
  | { action: 'begin'; files: number }
  | { action: 'stageImage'; token: string; id: string; bytes: Uint8Array }
  | { action: 'base'; token: string; baseId: string; baseName: string }
  | {
      action: 'file';
      token: string;
      kind: 'personal' | 'record' | 'document';
      name: string;
      size: number;
      baseId?: string;
      baseName?: string;
      images?: string[];
    }
  | { action: 'chunk'; token: string; bytes: Uint8Array }
  | { action: 'end' | 'finish' | 'cancel'; token: string };
export type AccountDataCall = AccountExportCall | AccountImportCall;
export type AccountDataResult =
  | {
      ok: true;
      token?: string;
      canceled?: boolean;
      saved?: boolean;
      requiresPassword?: boolean;
      sourceEmail?: string;
      localRevision?: string;
      recoveredMove?: true;
      items?: AccountImportItem[];
      sources?: AccountImportSource[];
      bytes?: Uint8Array;
      /** Total validated envelope length on its first chunk. */
      size?: number;
      digest?: string;
    }
  | { ok: false; error: string };
