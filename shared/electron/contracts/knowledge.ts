export const knowledgeDocumentAccept = '.pdf,.doc,.docx,.txt,.md';
const knowledgeExtensions = new Set(knowledgeDocumentAccept.split(',').map((ext) => ext.slice(1)));
export const isKnowledgeFileName = (name: string) =>
  knowledgeExtensions.has(name.split('.').pop()?.toLowerCase() ?? '');

export type KnowledgeMode = 'keyword' | 'vector' | 'hybrid';
export type KnowledgePhase =
  'queued' | 'parsing' | 'embedding' | 'indexing' | 'ready' | 'failed' | 'cancelled';
export interface KnowledgeDocument {
  documentId: string;
  baseId: string;
  name: string;
  format: string;
  title: string;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
  itemCount: number;
  chunkCount: number;
  indexVersion?: string;
  available?: boolean;
  schemaVersion: 1;
  modelVersion: string;
  originalReference: string;
}
export interface KnowledgeItem {
  source?: Pick<
    KnowledgeDocument,
    'name' | 'format' | 'updatedAt' | 'contentHash' | 'modelVersion' | 'indexVersion'
  > & { baseId?: string; revision?: string };
  /** Original root body, before getItem appends the compatible full follow-ups. */
  rootContent?: string;
  itemId: string;
  documentId: string;
  kind: 'qa' | 'text';
  title: string;
  content: string;
  question?: string;
  answer?: string;
  parentId?: string;
  followUpIds: string[];
  section: string;
  page?: number;
  endPage?: number;
  startLine?: number;
  endLine?: number;
  followUps?: KnowledgeItem[];
}
export interface KnowledgeHit {
  chunkId: string;
  itemId: string;
  matchedItemId?: string;
  /** Read-time selection, tied to the same root/revision; no index schema change. */
  matchedItemIds?: string[];
  grounding?: { contrast: number; contextual: boolean };
  revision?: string;
  documentId: string;
  name: string;
  title: string;
  baseId?: string;
  excerpt: string;
  similarity?: number;
  score: number;
  mode: KnowledgeMode;
  page?: number;
  section: string;
}
export interface KnowledgeItemExpectation {
  baseId: string;
  documentId: string;
  revision: string;
}
export interface KnowledgeStatus {
  requestId?: string;
  documentId: string;
  phase: KnowledgePhase;
  completed: number;
  total: number;
  error?: string;
}
export interface KnowledgeState {
  documents: KnowledgeDocument[];
  tasks: KnowledgeStatus[];
  modelReady: boolean;
  error?: string;
}
export type KnowledgeCall =
  | { op: 'status' }
  | {
      op: 'import';
      requestId: string;
      documentId: string;
      baseId: string;
      name: string;
      bytes: Uint8Array;
      force?: boolean;
    }
  | { op: 'invalidate'; requestId: string; documentId: string }
  | { op: 'remove'; requestId: string; documentId: string }
  | { op: 'cancel'; requestId: string }
  | {
      op: 'search';
      requestId: string;
      query: string;
      topK?: number;
      mode?: KnowledgeMode;
      baseId?: string;
    }
  | { op: 'item'; requestId: string; itemId: string; expected?: KnowledgeItemExpectation };
export type KnowledgeValue =
  KnowledgeState | KnowledgeDocument | KnowledgeHit[] | KnowledgeItem | null;
export type KnowledgeResult = { ok: true; value: KnowledgeValue } | { ok: false; error: string };
