import { validKnowledgeDocumentName } from './knowledge';
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
  /** Zero for an image whose bounded envelope is materialized only when selected. */
  size: number;
  /** Immutable screenshot references of an interview in the unlocked source snapshot. */
  imageIds?: string[];
  document?: ImportDocumentInfo;
  recordTitle?: string;
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
      items?: AccountImportItem[];
      sources?: AccountImportSource[];
      bytes?: Uint8Array;
      digest?: string;
    }
  | { ok: false; error: string };
