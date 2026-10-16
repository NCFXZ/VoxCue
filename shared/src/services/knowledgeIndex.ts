import type { KnowledgeCall, KnowledgeValue } from '../../electron/contracts/knowledge';
import type { LocalDocument } from './knowledgeTypes';
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
  requestId = crypto.randomUUID(),
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
