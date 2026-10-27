import { validImagePreview } from './interviewImages';
export type SyncKind = 'profile' | 'history' | 'knowledgebase';
export const syncKinds: SyncKind[] = ['profile', 'history', 'knowledgebase'];
export const CLOUD_CHUNK_BYTES = 1048576;
export const KNOWLEDGE_MAX_BYTES = 100_000_000;
export interface CloudResource {
  id: string;
  kind: SyncKind;
  name: string;
  revision: number;
  headVersion: string | null;
  bytes: number;
  sha256: string | null;
  createdAt: number;
}
export interface CloudStorage {
  currentBytes: Record<SyncKind, number>;
  reservedBytes: Record<SyncKind, number>;
  storedBytes: Record<SyncKind, number>;
  knowledgeCapacityBytes: number;
  capacityBytes: number;
}
export interface CloudResourceList {
  items: CloudResource[];
  nextCursor: string | null;
  storage: CloudStorage;
}
export interface CloudManifest {
  id: string;
  resourceId: string;
  state: string;
  bytes: number;
  sha256: string;
  chunkBytes: number;
  partCount: number;
  expiresAt: number;
  versionId: string | null;
  revision: number | null;
  parts: { index: number; bytes: number; sha256: string }[];
}
type SyncOperation =
  | { action: 'restoreImage'; id: string; bytes: Uint8Array; preview: string }
  | { action: 'list'; cursor?: string }
  | { action: 'create'; id: string; kind: SyncKind; key: string }
  | {
      action: 'begin';
      id: string;
      requestId: string;
      bytes: number;
      sha256: string;
      revision: number;
    }
  | { action: 'put'; id: string; index: number; bytes: Uint8Array }
  | { action: 'complete' | 'abort' | 'upload'; id: string }
  | { action: 'versions'; id: string }
  | { action: 'manifest'; id: string; version: string }
  | { action: 'read'; id: string; version: string; index: number }
  | { action: 'remove'; id: string; revision: number }
  | { action: 'prune'; id: string; version: string };
export type CloudSyncCall = SyncOperation & { userId: string };
export type CloudSyncResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; status: number; retryAfterSeconds?: number };

export function validCloudSyncCall(value: unknown): value is CloudSyncCall {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const uuid = (v: unknown) =>
    typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
  const integer = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
  if (!uuid(row.userId)) return false;
  if (row.action === 'list')
    return row.cursor === undefined || row.cursor === '' || uuid(row.cursor);
  if (!uuid(row.id)) return false;
  switch (row.action) {
    case 'restoreImage':
      return (
        row.bytes instanceof Uint8Array &&
        row.bytes.byteLength > 0 &&
        row.bytes.byteLength <= 8 * 1024 ** 2 &&
        validImagePreview(row.preview)
      );
    case 'create':
      return (
        syncKinds.includes(row.kind as SyncKind) &&
        row.kind ===
          (/^(profile|resume):/.test(String(row.key))
            ? 'profile'
            : /^(record|image):/.test(String(row.key))
              ? 'history'
              : 'knowledgebase') &&
        typeof row.key === 'string' &&
        /^(?:profile|resume|base|file|record|image):[\w-]{1,100}$/.test(row.key)
      );
    case 'begin':
      return (
        uuid(row.requestId) &&
        integer(row.bytes, 64 * 1024 ** 2) &&
        Number(row.bytes) > 0 &&
        typeof row.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(row.sha256) &&
        integer(row.revision, 1_000_000_000)
      );
    case 'put':
      return (
        integer(row.index, 63) &&
        row.bytes instanceof Uint8Array &&
        row.bytes.byteLength > 0 &&
        row.bytes.byteLength <= CLOUD_CHUNK_BYTES
      );
    case 'complete':
    case 'abort':
    case 'upload':
    case 'versions':
      return true;
    case 'remove':
      return integer(row.revision, 1_000_000_000);
    case 'read':
      return uuid(row.version) && integer(row.index, 63);
    case 'manifest':
    case 'prune':
      return uuid(row.version);
    default:
      return false;
  }
}
