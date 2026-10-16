import type {
  KnowledgeDocument,
  KnowledgeItem,
  KnowledgeHit,
  KnowledgeStatus,
  KnowledgeMode,
} from '../../contracts/knowledge';
export const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const INDEX_VERSION = 'qa-linked-v2';
export interface ParsedDocument {
  title: string;
  items: KnowledgeItem[];
  text: string;
}
export interface DocumentInput {
  documentId: string;
  baseId: string;
  name: string;
  bytes: Uint8Array;
  force?: boolean;
}
export interface Embedder {
  initialize(): Promise<void>;
  count(text: string, kind: 'query' | 'passage'): number;
  encode(texts: string[], kind: 'query' | 'passage', signal: AbortSignal): Promise<number[][]>;
  close(): Promise<void>;
}
export interface KnowledgePort {
  initialize(): Promise<void>;
  indexDocument(input: DocumentInput, signal: AbortSignal): Promise<KnowledgeDocument>;
  updateDocument(input: DocumentInput, signal: AbortSignal): Promise<KnowledgeDocument>;
  invalidateDocument(id: string, signal: AbortSignal): Promise<null>;
  removeDocument(id: string, signal: AbortSignal): Promise<null>;
  listDocuments(): Promise<KnowledgeDocument[]>;
  search(
    query: string,
    topK: number,
    mode: KnowledgeMode,
    signal: AbortSignal,
    baseId?: string,
  ): Promise<KnowledgeHit[]>;
  getItem(id: string, signal?: AbortSignal): Promise<KnowledgeItem | null>;
  close(): Promise<void>;
}
export type Progress = (status: KnowledgeStatus) => void;
