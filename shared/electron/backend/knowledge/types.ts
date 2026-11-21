import type {
  KnowledgeDocument,
  KnowledgeItem,
  KnowledgeHit,
  KnowledgeStatus,
  KnowledgeMode,
  KnowledgeItemExpectation,
} from '../../contracts/knowledge';
import type { EvidenceItem } from './evidence';
export const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export { KNOWLEDGE_INDEX_VERSION as INDEX_VERSION } from '../../contracts/knowledge';
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
  batchId?: string;
}
/** Keep the native database path valid until the owning utility process exits. */
export type PrepareKnowledgeDatabase = (directory: string) => {
  path: string;
  spawned(pid: number): void;
  release(): void;
} | undefined;
export interface Embedder {
  initialize(): Promise<void>;
  count(text: string, kind: 'query' | 'passage'): number;
  encode(texts: string[], kind: 'query' | 'passage', signal: AbortSignal): Promise<number[][]>;
  close(): Promise<void>;
}
export interface KnowledgeSearchOptions {
  rawLimit: 20 | 40 | 60 | 80;
  grounded?: boolean;
  history?: string[];
}
export interface KnowledgePort {
  readonly indexCleanupError?: string;
  initialize(): Promise<void>;
  beginIndexBatch?(id: string, baseId: string, documentIds: string[], signal: AbortSignal): Promise<void>;
  finishIndexBatch?(id: string, commit: boolean, signal: AbortSignal): Promise<void>;
  indexDocument(input: DocumentInput, signal: AbortSignal): Promise<KnowledgeDocument>;
  updateDocument(input: DocumentInput, signal: AbortSignal): Promise<KnowledgeDocument>;
  invalidateDocument(id: string, signal: AbortSignal): Promise<null>;
  removeDocument(id: string, signal: AbortSignal): Promise<null>;
  removeBase(baseId: string, signal: AbortSignal): Promise<null>;
  listDocuments(allowIndexCleanup?: boolean): Promise<KnowledgeDocument[]>;
  search(
    query: string,
    topK: number,
    mode: KnowledgeMode,
    signal: AbortSignal,
    baseId?: string,
    options?: KnowledgeSearchOptions,
  ): Promise<KnowledgeHit[]>;
  getItem(
    id: string,
    signal?: AbortSignal,
    expected?: KnowledgeItemExpectation,
  ): Promise<KnowledgeItem | null>;
  getEvidenceItem?(
    hit: KnowledgeHit, signal: AbortSignal, expected?: KnowledgeItemExpectation,
  ): Promise<EvidenceItem | null>;
  version?(baseId: string, signal: AbortSignal): Promise<string>;
  close(): Promise<void>;
}
/** Test-only observer data: bounded IDs and timings, never queries or excerpts. */
export interface KnowledgeSearchTrace {
  grounding?: { scope: string[]; contextual: boolean; direct: boolean; peakContrast: number };
  raw: Array<{ chunkId: string; itemId: string; rootItemId: string; documentId: string }>;
  distinctRoots: number;
  hits: string[];
  queueMs: number;
  searchMs: number;
}
export type Progress = (status: KnowledgeStatus) => void;
