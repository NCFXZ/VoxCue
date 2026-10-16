export type KnowledgeMode = 'keyword' | 'vector' | 'hybrid';
export type RagMode = 'local' | 'function';
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
  >;
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
  mode: RagMode;
  functionCalling: { supported: boolean | null; reason: string };
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
  | { op: 'item'; requestId: string; itemId: string }
  | { op: 'settings'; mode: RagMode };
export type KnowledgeValue =
  KnowledgeState | KnowledgeDocument | KnowledgeHit[] | KnowledgeItem | null;
export type KnowledgeResult = { ok: true; value: KnowledgeValue } | { ok: false; error: string };
