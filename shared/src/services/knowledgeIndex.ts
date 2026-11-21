import type {
  KnowledgeCall,
  KnowledgeDocument,
  KnowledgeStatus,
  KnowledgeValue,
} from '../../electron/contracts/knowledge';
import { KNOWLEDGE_INDEX_VERSION } from '../../electron/contracts/knowledge';
import type { LocalDocument } from './knowledgeTypes';

export function knowledgeStatusLabel(status: KnowledgeStatus): string {
  if (status.phase === 'ready') return '索引完成';
  if (status.phase === 'failed') return '索引失败';
  if (status.phase === 'cancelled') return '已取消';
  // The embedding counter finishes before the separate index commit starts.
  // That commit has no incremental counter, so its zero is not a task restart.
  if (status.phase === 'indexing') return '正在写入索引…';
  const percent = status.total
    ? Math.min(100, Math.max(0, Math.floor((status.completed / status.total) * 100)))
    : 0;
  return `索引中 ${percent}%`;
}

export function documentIndexLabel(doc?: Pick<KnowledgeDocument, 'indexVersion' | 'available'>, task?: KnowledgeStatus,
  { requestId, deleting = false, hasSnapshot = true }: { requestId?: string; deleting?: boolean; hasSnapshot?: boolean } = {}) {
  if (deleting) return '正在删除旧索引…';
  if (task && task.phase !== 'ready') return knowledgeStatusLabel(task);
  if (doc?.available === false) return '索引已停用';
  if (doc?.indexVersion === KNOWLEDGE_INDEX_VERSION ||
      (requestId && task?.requestId === requestId && task.indexVersion === KNOWLEDGE_INDEX_VERSION)) return '索引完成';
  return hasSnapshot ? '尚未索引' : undefined;
}

export const hasKnowledgeEngine = () =>
  typeof window !== 'undefined' && typeof window.desktop?.knowledge === 'function';
export async function knowledgeCall(call: KnowledgeCall): Promise<KnowledgeValue> {
  if (!hasKnowledgeEngine()) throw Error('知识库引擎不可用，请在桌面应用中重试。');
  const result = await window.desktop!.knowledge(call);
  if (!result.ok) throw Error(result.error);
  return result.value;
}
const reading = new Map<string, { baseId: string }>();
const replacing = new Map<string, Set<Promise<void>>>();
const removing = new Map<string, number>();
const removalJournal = 'voxcue-pending-knowledge-base-removals-v1';
const validRemovalBase = (id: unknown): id is string =>
  typeof id === 'string' && /^[\w-]{1,100}$/.test(id) && !['personal-resume', '__proto__', 'constructor', 'prototype'].includes(id);
export function pendingBaseRemovals(): string[] {
  const raw = globalThis.localStorage?.getItem(removalJournal);
  if (!raw) return [];
  const ids: unknown = JSON.parse(raw);
  if (!Array.isArray(ids) || !ids.every(validRemovalBase))
    throw Error('无法读取本地记录，原始数据已保留。');
  return ids;
}
export function markBaseRemoval(id: string, pending: boolean) {
  if (!validRemovalBase(id)) throw Error('知识库无效。');
  const ids = new Set(pendingBaseRemovals());
  if (pending) ids.add(id);
  else ids.delete(id);
  if (ids.size) localStorage.setItem(removalJournal, JSON.stringify([...ids]));
  else localStorage.removeItem(removalJournal);
}
export function assertLibrariesWritable(ids: Iterable<string>) {
  const pending = pendingBaseRemovals();
  if (!pending.length) return;
  for (const id of ids)
    if (pending.includes(id)) throw Error('这个知识库正在删除，暂时无法写入资料。');
}
/** A retry must read the committed winner of a replacement, including a failed transaction. */
export function holdOriginalReplacements(ids: string[]) {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  for (const id of ids) {
    reading.delete(id);
    const locks = replacing.get(id) ?? new Set<Promise<void>>();
    locks.add(held);
    replacing.set(id, locks);
  }
  return () => {
    for (const id of ids) {
      const locks = replacing.get(id);
      locks?.delete(held);
      if (!locks?.size) replacing.delete(id);
    }
    release();
  };
}
export async function indexOriginal(
  { id: documentId, baseId }: Pick<LocalDocument, 'id' | 'baseId'>,
  original: () => Promise<LocalDocument | undefined>,
  requestId: string,
  force: boolean,
  current: () => boolean,
  batchId?: string,
) {
  while (replacing.has(documentId)) await Promise.all(replacing.get(documentId)!);
  if (!current()) return;
  if (removing.has('file:' + documentId) || removing.has('base:' + baseId) || pendingBaseRemovals().includes(baseId)) return;
  const owner = { baseId };
  const live = () => reading.get(documentId) === owner && current() && !pendingBaseRemovals().includes(baseId);
  reading.set(documentId, owner);
  try {
    const doc = await original();
    if (!doc || !live()) return;
    const bytes = new Uint8Array(await doc.blob.arrayBuffer());
    if (!live()) return;
    await knowledgeCall({ op: 'import', requestId, documentId, baseId: doc.baseId, name: doc.name, force, bytes,
      ...(batchId && { batchId }) });
    return true;
  } finally {
    if (reading.get(documentId) === owner) reading.delete(documentId);
  }
}
export async function removeIndexedOriginals(scope: { baseId: string } | { documentId: string }, remove: () => Promise<void>) {
  const key = 'baseId' in scope ? 'base:' + scope.baseId : 'file:' + scope.documentId;
  removing.set(key, (removing.get(key) ?? 0) + 1);
  for (const [id, owner] of reading)
    if ('baseId' in scope ? owner.baseId === scope.baseId : id === scope.documentId) reading.delete(id);
  try {
    await remove();
  } finally {
    const remaining = removing.get(key)! - 1;
    if (remaining) removing.set(key, remaining);
    else removing.delete(key);
  }
}
export async function deactivateOriginal(documentId: string, remove = false) {
  reading.delete(documentId);
  if (hasKnowledgeEngine())
    await knowledgeCall({
      op: remove ? 'remove' : 'invalidate',
      requestId: crypto.randomUUID(),
      documentId,
    });
}
