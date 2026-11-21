import type { KnowledgeHit, KnowledgeItem } from '../../contracts/knowledge';
import { passagePrefix, sha } from './chunks';
import { KnowledgeError } from './errors';

export const RAG_CONTEXT_BYTES = 48000;

/** A lookup result for answer generation. Full items remain available to detail views. */
export function projectEvidence(
  hit: KnowledgeHit,
  item: KnowledgeItem,
  budget = RAG_CONTEXT_BYTES,
) {
  const revision = item.source?.revision,
    baseId = item.source?.baseId;
  const current = revision === hit.revision && baseId === hit.baseId;
  const child = (id: string) =>
    item.followUps?.find(
      (c) =>
        c.itemId === id &&
        c.parentId === item.itemId &&
        c.documentId === item.documentId &&
        item.followUpIds.includes(id),
    );
  const mismatch = () => new KnowledgeError('integrity', '知识库追问身份不匹配。');
  let content = item.content,
    excerpt = false;
  if (current && item.rootContent !== undefined) {
    if (hit.matchedItemIds) {
      if (
        hit.matchedItemIds.length > 5 ||
        new Set(hit.matchedItemIds).size !== hit.matchedItemIds.length
      )
        throw mismatch();
      const parts = [item.rootContent];
      for (const id of hit.matchedItemIds) {
        const match = child(id);
        if (!match) throw mismatch();
        parts.push(match.content);
      }
      content = parts.join('\n\n');
      excerpt = true;
    } else if (hit.matchedItemId && hit.matchedItemId !== item.itemId) {
      const match = child(hit.matchedItemId);
      if (!match) throw mismatch();
      content = item.rootContent + '\n\n' + match.content;
      excerpt = true;
    }
  }
  let passage: string | undefined;
  const metadataFits =
    item.title.length + item.section.length <= budget &&
    Buffer.byteLength(item.title) + Buffer.byteLength(item.section) <= budget;
  if (
    metadataFits &&
    current &&
    hit.revision &&
    hit.baseId &&
    item.itemId === hit.itemId &&
    item.documentId === hit.documentId &&
    hit.matchedItemId
  ) {
    const matched = hit.matchedItemId === item.itemId ? item : child(hit.matchedItemId);
    if (matched) {
      const prefix = passagePrefix(matched, matched === item ? undefined : item);
      const text = hit.excerpt.slice(0, 1600).replace(/[\uD800-\uDBFF]$/, '');
      const body = text.startsWith(prefix) ? text.slice(prefix.length) : text;
      const original = matched === item ? (item.rootContent ?? item.content) : matched.content;
      if (body.trim() && original.includes(body)) passage = body;
    }
  }
  return {
    itemId: item.itemId,
    documentId: item.documentId,
    source: { revision, baseId },
    title: metadataFits ? item.title : '',
    section: metadataFits ? item.section : '',
    page: item.page,
    available: !!item.content.trim(),
    hash: sha(content.replace(/\s+/g, ' ')),
    excerpt,
    passage,
    // UTF-8 cannot fit a string whose UTF-16 length already exceeds the byte budget.
    content:
      metadataFits && content.length <= budget && Buffer.byteLength(content) <= budget
        ? content
        : undefined,
  };
}
export type EvidenceItem = ReturnType<typeof projectEvidence>;
