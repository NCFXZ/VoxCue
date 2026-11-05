import type {
  KnowledgeCall,
  KnowledgeStatus,
  KnowledgeValue,
} from '../../electron/contracts/knowledge';
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

export const hasKnowledgeEngine = () =>
  typeof window !== 'undefined' && typeof window.desktop?.knowledge === 'function';
export async function knowledgeCall(call: KnowledgeCall): Promise<KnowledgeValue> {
  if (!hasKnowledgeEngine()) throw Error('本地知识库引擎不可用，请在 VoxCue 桌面应用中重试。');
  const result = await window.desktop!.knowledge(call);
  if (!result.ok) throw Error(result.error);
  return result.value;
}
export async function indexOriginal(
  doc: LocalDocument,
  requestId: string = crypto.randomUUID(),
  force = false,
) {
  return knowledgeCall({
    op: 'import',
    requestId,
    documentId: doc.id,
    baseId: doc.baseId,
    name: doc.name,
    force,
    bytes: new Uint8Array(await doc.blob.arrayBuffer()),
  });
}
export async function deactivateOriginal(documentId: string, remove = false) {
  if (hasKnowledgeEngine())
    await knowledgeCall({
      op: remove ? 'remove' : 'invalidate',
      requestId: crypto.randomUUID(),
      documentId,
    });
}
