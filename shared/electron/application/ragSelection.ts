import type { KnowledgeHit } from '../contracts/knowledge';
import { MAX_EVIDENCE_ROOTS } from '../contracts/retrievalContext';
import type { RagDecision } from './ragDiagnostics';
import { isUnresolvedReference, normalizeRetrievalQuery, retrievalFocus } from './ragQuery';

export const RAG_SELECTION = {
  candidates: 12,
  evidence: MAX_EVIDENCE_ROOTS,
  rawLimit: 60 as const,
  semanticMinimum: 0.84,
  version: 'bplus-selected-history-v1',
};
const generic = new Set(
  'how what does the are you your can why with and for this that which have has describe explain method project approach solution system limitations parameter parameters documented please 请问 介绍 解释 说明 原理 计算 参数 任务 资料 记录 如何 什么 一下 我的 你的 项目 方法 方案 系统 为什么 怎么 哪些 有哪些 有什么 局限 优点 缺点 问题 这个 这种 一个 进行 使用 采用 实现 以及 可以 需要 时候 通过 关于 刚才 上一 当前 追问 你们 咱们 他们 我们 当时 后来 最后 到底 多少 具体 来着 有啥 咋办 咋整 咋改 为啥 说说 讲讲 展开 不行 怎么办 怎么样 好点儿 还能 能不能 大白话 通俗点'.split(
    ' ',
  ),
);
const chineseStops = [...generic]
  .filter((v) => /^[\u4e00-\u9fff]+$/.test(v))
  .sort((a, b) => b.length - a.length);
function anchors(query: string) {
  if (isUnresolvedReference(query)) return [];
  const tokens = new Set<string>();
  for (const match of normalizeRetrievalQuery(query)
    .toLowerCase()
    .matchAll(/[a-z][a-z0-9_+-]{2,}|[\u4e00-\u9fff]{2,}/g)) {
    const word = match[0];
    if (generic.has(word)) continue;
    if (/^[a-z]/.test(word)) tokens.add(word);
    else {
      // Remove complete question stems before forming character pairs. A single
      // generic pair such as 项目/方法 must never qualify an unrelated document.
      let value = word
        .replace(/^(?:那|那么|它|这个|嗯|呃|哎)+/, '')
        .replace(/[啊呀吧呢呗嘛啦哦]+$/, '');
      for (const stop of chineseStops) value = value.split(stop).join(' ');
      for (const part of value.split(/\s+/)) {
        if (part.length < 2) continue;
        for (let i = 0; i < part.length - 1; i++)
          if (!generic.has(part.slice(i, i + 2))) tokens.add(part.slice(i, i + 2));
      }
    }
  }
  return [...tokens];
}
function matches(token: string, text: string) {
  return /^[a-z]/.test(token)
    ? new RegExp(
        `(^|[^a-z0-9_+-])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_+-])`,
        'i',
      ).test(text)
    : text.includes(token);
}
export function lexicalMatch(query: string, text: string) {
  return anchors(query).some((token) => matches(token, text.toLowerCase()));
}

function projectIdentity(hit: KnowledgeHit) {
  const title = hit.title
    .replace(/^(?:Q[\d.]+(?:-[A-Z])?[.：:]?\s*|追问\s*\d+[：:]?\s*)/i, '')
    .trim();
  const prefix = title.match(
    /^([\u4e00-\u9fff]{2,24}|[A-Za-z][A-Za-z0-9_-]{1,60})\s*(?:项目|\bproject\b)/i,
  )?.[1];
  return prefix && !/^(?:如何|怎么|什么|其他|这个|我的|介绍|请|基于|本次)/.test(prefix)
    ? prefix.toLowerCase()
    : null;
}

function projectScope(query: string, hits: KnowledgeHit[]) {
  const focus = retrievalFocus(normalizeRetrievalQuery(query)).toLowerCase();
  const previous = query.includes('\n当前追问：')
    ? query.split('\n当前追问：')[0].toLowerCase()
    : '';
  const identities = hits.map((hit) => ({ hit, name: projectIdentity(hit) }));
  const mentioned = (text: string) =>
    identities.flatMap(({ hit, name }) => {
      if (!name) return [];
      // Chinese headings can append a descriptive noun before 项目. Match a
      // stable leading name, never a mention of another project inside the body.
      const sizes = /^[a-z]/.test(name)
        ? [name.length]
        : Array.from({ length: name.length - 1 }, (_, i) => name.length - i);
      const match = sizes.map((size) => name.slice(0, size)).find((value) => matches(value, text));
      return match
        ? [
            {
              documentId: hit.documentId,
              name,
              position: text.lastIndexOf(match),
              length: match.length,
            },
          ]
        : [];
    });
  const matchesInFocus = mentioned(focus);
  const namedProject = focus.match(
    /([\u4e00-\u9fff]{2,24}|[a-z][a-z0-9_-]{1,60})\s*(?:项目|\bproject\b)/i,
  )?.[1];
  const explicitProject =
    namedProject && !/^(?:这个|那个|我的|你的|如何|怎么|什么|介绍|请)/.test(namedProject);
  const mentions = matchesInFocus.length
    ? matchesInFocus
    : explicitProject
      ? []
      : mentioned(previous);
  if (!mentions.length) {
    return explicitProject ? (hit: KnowledgeHit) => !projectIdentity(hit) : () => true;
  }
  const comparison = /对比|比较|区别|[和与、]|以及|\b(?:compare|versus|vs|and)\b/i.test(focus);
  const position = Math.max(...mentions.map((item) => item.position));
  const longest = mentions.filter(
    (item) =>
      !mentions.some((other) => other.position === item.position && other.length > item.length),
  );
  const names = new Set(
    longest.filter((item) => comparison || item.position === position).map((item) => item.name),
  );
  const documents = new Set(
    mentions.filter((item) => names.has(item.name)).map((item) => item.documentId),
  );
  return (hit: KnowledgeHit) => !projectIdentity(hit) || documents.has(hit.documentId);
}
function relevantTerms(terms: string[], hit: KnowledgeHit, minimum: number) {
  const text = (hit.title + '\n' + hit.section + '\n' + hit.excerpt).toLowerCase();
  const overlap = terms.filter((term) => matches(term, text));
  const lexical =
    overlap.some((term) => /^[a-z]/.test(term)) ||
    overlap.length >= 2 ||
    (terms.length === 1 && overlap.length === 1);
  // A two-character coincidence alone cannot qualify a long Chinese question.
  // Legacy ports without cosine retain a lexical fallback; the real Hybrid
  // service supplies cosine and must support the match semantically as well.
  return (
    (lexical &&
      (hit.similarity === undefined ||
        (Number.isFinite(hit.similarity) && hit.similarity >= 0.7))) ||
    (terms.length > 0 && Number.isFinite(hit.similarity) && hit.similarity! >= minimum)
  );
}
export function candidateGuard(query: string, minimum = RAG_SELECTION.semanticMinimum) {
  const terms = anchors(query);
  return (hit: KnowledgeHit) =>
    hit.grounding
      ? Number.isFinite(hit.grounding.contrast) && Number.isFinite(hit.similarity)
      : relevantTerms(terms, hit, minimum);
}
export function relevantCandidate(
  query: string,
  hit: KnowledgeHit,
  minimum = RAG_SELECTION.semanticMinimum,
) {
  return relevantTerms(anchors(query), hit, minimum);
}
export function selectRagCandidates(
  query: string,
  hits: KnowledgeHit[],
  limit = RAG_SELECTION.evidence,
  minimum = RAG_SELECTION.semanticMinimum,
) {
  if (hits.length && hits.every((hit) => hit.grounding)) {
    const seen = new Set<string>();
    const ordered = hits.filter((hit) => !seen.has(hit.itemId) && !!seen.add(hit.itemId));
    return {
      shortlist: ordered.slice(0, limit),
      decisions: ordered
        .slice(limit)
        .map((hit) => ({ itemId: hit.itemId, reason: 'not_in_shortlist' as const })),
    };
  }
  const terms = anchors(query),
    decisions: RagDecision[] = [],
    seen = new Set<string>();
  const withinProject = projectScope(query, hits);
  const compared = new Set<string>();
  const similarities = hits
    .filter((hit) => {
      if (!withinProject(hit) || compared.has(hit.itemId)) return false;
      compared.add(hit.itemId);
      return true;
    })
    .map((hit) => hit.similarity)
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
    .sort((a, b) => b - a);
  // E5 can give unrelated short questions several nearly tied, moderately high
  // cosine values. With no lexical support that cluster is uncertainty, not a
  // reason to inject all those documents. Compare cosine only, never RRF/BM25.
  const uncertainSemantic =
    similarities.length > 1 &&
    similarities[0] >= minimum &&
    similarities[0] < minimum + 0.02 &&
    similarities[0] - similarities[1] < 0.005;
  const texts = hits.map((hit) =>
    (hit.title + ' ' + hit.section + ' ' + hit.excerpt).toLowerCase(),
  );
  // Whole technical/entity tokens can constrain scope. Chinese bigrams remain
  // ranking signals; their rarity must not veto a semantic paraphrase.
  const frequencies = terms
    .filter((term) => /^[a-z]/.test(term))
    .map((term) => ({ term, count: texts.filter((text) => matches(term, text)).length }))
    .filter((value) => value.count > 0);
  const least = frequencies.length ? Math.min(...frequencies.map((value) => value.count)) : 0;
  const specific = frequencies.filter((value) => value.count === least).map((value) => value.term);
  const ranked = hits.flatMap((hit, rank) => {
    if (seen.has(hit.itemId)) {
      decisions.push({ itemId: hit.itemId, reason: 'duplicate' });
      return [];
    }
    seen.add(hit.itemId);
    if (
      !withinProject(hit) ||
      (uncertainSemantic && !terms.some((term) => matches(term, texts[rank]))) ||
      !relevantTerms(terms, hit, minimum) ||
      (specific.length > 0 && !specific.some((term) => matches(term, texts[rank])))
    ) {
      decisions.push({ itemId: hit.itemId, reason: 'filtered_by_relevance' });
      return [];
    }
    const title = (hit.title + ' ' + hit.section).toLowerCase(),
      text = hit.excerpt.toLowerCase();
    return [
      {
        hit,
        rank,
        titleMatches: terms.filter((t) => matches(t, title)).length,
        textMatches: terms.filter((t) => matches(t, text)).length,
      },
    ];
  });
  // Scores from BM25/RRF/cosine are never added or compared across modes.
  ranked.sort(
    (a, b) => b.titleMatches - a.titleMatches || b.textMatches - a.textMatches || a.rank - b.rank,
  );
  for (const entry of ranked.slice(limit))
    decisions.push({ itemId: entry.hit.itemId, reason: 'not_in_shortlist' });
  return { shortlist: ranked.slice(0, limit).map((v) => v.hit), decisions };
}
