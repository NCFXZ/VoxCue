import type { KnowledgeItem } from '../../contracts/knowledge';

// Read-time profiles only: the existing catalog, revisions and vectors remain
// authoritative. No new model, persisted annotation or index migration.
export interface GroundDocument {
  id: string;
  items: KnowledgeItem[];
  title: string;
}
export interface GroundRow {
  chunkId: string;
  itemId: string;
  rootItemId: string;
  documentId: string;
  text: string;
  vector: number[];
}
export const GROUNDING = {
  standaloneContrast: 0.1,
  semanticContrast: 0.55,
  lexicalCosine: 0.84,
  continuationCosine: 0.92,
  followupContrast: 0.1,
  backgroundRows: 20000,
  historyProbes: 3,
};
const terms = (text: string) => {
  const result = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z][a-z0-9_+/-]*|[\u4e00-\u9fff]{2,}/g)) {
    if (/^[a-z]/.test(m[0])) result.add(m[0]);
    else for (let i = 0; i < m[0].length - 1; i++) result.add(m[0].slice(i, i + 2));
  }
  return result;
};
const contains = (text: string, term: string) =>
  /^[a-z]/.test(term)
    ? new RegExp(
        `(^|[^a-z0-9_+/-])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_+/-])`,
        'i',
      ).test(text)
    : text.includes(term);
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const unit = (v: number[]) => {
  const length = Math.sqrt(dot(v, v)) || 1;
  return v.map((n) => n / length);
};

export class GroundingProfile {
  private center: number[];
  private vocabulary = new Map<string, Set<string>>();
  private headingVocabulary = new Map<string, Set<string>>();
  private aliases = new Map<string, string[]>();
  private projects = new Set<string>();
  private rootOwners = new Map<string, string>();
  readonly stems: string[];
  private stemVectors: number[][] = [];
  constructor(
    readonly documents: GroundDocument[],
    rows: GroundRow[],
  ) {
    this.center = Array.from(
      { length: 384 },
      (_, i) => rows.reduce((s, r) => s + r.vector[i], 0) / Math.max(1, rows.length),
    );
    const ownership = new Map<string, Set<string>>();
    for (const doc of documents) {
      const roots = doc.items.filter((i) => !i.parentId);
      const headings = roots.slice(0, 64).map((i) => i.title.toLowerCase().slice(0, 240));
      const identifiers = new Set(
        roots.slice(0, 64).flatMap((item) =>
          [...item.title.slice(0, 240).matchAll(/[a-z][a-z0-9_+/-]+/gi)]
            .map((m) => m[0])
            .filter((value) => /[a-z][A-Z]|[A-Z].*[A-Z]/.test(value))
            .map((value) => value.toLowerCase()),
        ),
      );
      if (headings.some((h) => /项目|\bproject\b/i.test(h)) || /项目|\bproject\b/i.test(doc.title))
        this.projects.add(doc.id);
      const corpus = terms(doc.items.map((i) => i.content).join('\n'));
      for (const term of terms(headings.join('\n'))) {
        const ids = this.headingVocabulary.get(term) ?? new Set<string>();
        ids.add(doc.id);
        this.headingVocabulary.set(term, ids);
      }
      for (const term of corpus) {
        const ids = this.vocabulary.get(term) ?? new Set<string>();
        ids.add(doc.id);
        this.vocabulary.set(term, ids);
      }
      // A name is a conserved heading span belonging to this document, rather
      // than a mention somewhere in a retrieved excerpt. Prefix prose is free.
      const spans = new Map<string, number>();
      for (const h of headings) {
        const local = new Set<string>();
        for (const m of h.matchAll(/[a-z][a-z0-9_+/-]+|[\u4e00-\u9fff]{2,}/g)) {
          const value = m[0];
          if (/^[a-z]/.test(value)) local.add(value);
          else
            for (let size = 2; size <= Math.min(10, value.length); size++)
              for (let start = 0; start + size <= value.length; start++)
                local.add(value.slice(start, start + size));
        }
        for (const span of local) spans.set(span, (spans.get(span) ?? 0) + 1);
      }
      const names = [...spans]
        .filter(
          ([span, count]) =>
            (count >= Math.min(2, headings.length) ||
              (!this.projects.has(doc.id) && identifiers.has(span))) &&
            (/^[a-z]/.test(span) || this.projects.has(doc.id) || span.length >= 3),
        )
        .map(([span]) => span);
      this.aliases.set(doc.id, names);
      for (const span of spans.keys()) {
        const ids = ownership.get(span) ?? new Set<string>();
        ids.add(doc.id);
        ownership.set(span, ids);
      }
    }
    for (const [id, names] of this.aliases) {
      const body = documents
        .find((d) => d.id === id)!
        .items.map((i) => i.content.split('\n').slice(1).join('\n'))
        .join('\n')
        .toLowerCase();
      this.aliases.set(
        id,
        names.filter((name) => {
          const owners = [...(ownership.get(name) ?? [])];
          const unique = this.projects.has(id)
            ? owners.length === 1
            : owners.filter((owner) => !this.projects.has(owner)).length === 1;
          const parts = [...terms(name)];
          const textOwners = documents.filter(
            (d) =>
              !this.projects.has(d.id) &&
              parts.every((part) => this.vocabulary.get(part)?.has(d.id)),
          );
          return (
            unique &&
            (contains(body, name) || /^[a-z]/.test(name)) &&
            (this.projects.has(id) || /^[a-z]/.test(name) || textOwners.length === 1)
          );
        }),
      );
    }
    for (const doc of documents.filter((d) => this.projects.has(d.id))) {
      const owners: string[] = [];
      for (const root of doc.items.filter((i) => !i.parentId)) {
        const body = root.content.split('\n').slice(1).join('\n').trim().toLowerCase().slice(0, 80);
        const heading = root.title.toLowerCase();
        const candidates: { name: string; position: number }[] = [];
        for (const m of body.matchAll(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g)) {
          const value = m[0],
            position = m.index!;
          if (position > 24) break;
          if (/^[a-z]/.test(value) && contains(heading, value))
            candidates.push({ name: value, position });
          else
            for (let start = 0; start < Math.min(value.length, 24); start++)
              for (let size = 2; size <= Math.min(12, value.length - start); size++) {
                const name = value.slice(start, start + size).split('项目')[0];
                if (name.length >= 2 && heading.includes(name) && ownership.get(name)?.size === 1)
                  candidates.push({ name, position: position + start });
              }
        }
        candidates.sort((a, b) => a.position - b.position || b.name.length - a.name.length);
        const name = candidates[0]?.name;
        if (name) {
          this.rootOwners.set(root.itemId, name);
          owners.push(name);
        }
      }
      this.aliases.set(doc.id, [...new Set([...(this.aliases.get(doc.id) ?? []), ...owners])]);
    }
    // Mine repeated source question acts. No evaluation questions or manually
    // enumerated colloquial triggers participate in this read-time view.
    const suffixes = new Map<string, Set<string>>();
    for (const doc of documents)
      for (const item of doc.items.slice(0, 128)) {
        const tail = item.title.match(/[\u4e00-\u9fff]{4,}/g)?.at(-1);
        if (!tail) continue;
        for (let size = 4; size <= Math.min(32, tail.length); size++) {
          const stem = tail.slice(-size),
            owners = suffixes.get(stem) ?? new Set<string>();
          owners.add(doc.id);
          suffixes.set(stem, owners);
        }
      }
    const repeated = [...suffixes].filter(([, owners]) => owners.size >= 2);
    this.stems = repeated
      .filter(
        ([stem, owners]) =>
          !repeated.some(
            ([longer, other]) =>
              longer.length > stem.length && longer.endsWith(stem) && other.size === owners.size,
          ),
      )
      .sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length)
      .slice(0, 64)
      .map(([stem]) => stem);
  }
  mentions(text: string) {
    const value = text.toLowerCase();
    return this.documents
      .filter((d) => this.aliases.get(d.id)?.some((a) => contains(value, a)))
      .map((d) => d.id);
  }
  // Technical requests may name several sources across punctuation. Project
  // corrections retain the last subject, unless multiple clauses each ask a
  // question. This is closed interrogative grammar, not a topic/phrase table.
  subjects(text: string) {
    const clauses = text
      .split(/[，,；;。！？!?\n]/)
      .map((part) => ({
        ids: this.mentions(part),
        question:
          /什么|怎么|如何|哪|多少|是否|[吗么]|\b(?:what|how|why|which|where|when|whether)\b/i.test(
            part,
          ),
      }))
      .filter((part) => part.ids.length);
    const technical = clauses.flatMap((part) => part.ids.filter((id) => !this.isProject(id)));
    const projectClauses = clauses.filter((part) => part.ids.some((id) => this.isProject(id)));
    const projects =
      projectClauses.filter((part) => part.question).length > 1
        ? projectClauses.flatMap((part) => part.ids.filter((id) => this.isProject(id)))
        : (projectClauses.at(-1)?.ids.filter((id) => this.isProject(id)) ?? []);
    return [...new Set([...technical, ...projects])];
  }
  isProject(id: string) {
    return this.projects.has(id);
  }
  unknownProject(text: string) {
    const words = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(text.toLowerCase())]
      .filter((s) => s.isWordLike)
      .map((s) => s.segment);
    return words.some((word, i) => {
      if (!/^(?:项目|project)$/.test(word) || i === 0) return false;
      let name = words[i - 1];
      const deictic = /^(?:这|那|该|本|你|我|咱|他|她|它|this\b|that\b|the\b)/;
      if (deictic.test(name)) return false;
      // Segmenter may split a previously unseen Chinese name into single
      // characters. Recover the bounded adjacent span instead of discarding it.
      for (let j = i - 2; name.length < 2 && j >= 0; j--) name = words[j] + name;
      return (
        name.length >= 2 &&
        !deictic.test(name) &&
        !this.mentions(name).some((id) => this.isProject(id))
      );
    });
  }
  restrictRoots(current: string, previous: string[], ids: string[]) {
    const restricted = new Set<string>();
    let needed = false;
    for (const doc of this.documents.filter((d) => ids.includes(d.id) && this.projects.has(d.id))) {
      const roots = doc.items.filter((i) => !i.parentId);
      const owners = new Set(
        roots.map((r) => this.rootOwners.get(r.itemId)).filter((v): v is string => !!v),
      );
      if (owners.size <= 1) {
        for (const root of roots) restricted.add(root.itemId);
        continue;
      }
      needed = true;
      let names = [...owners].filter((name) => contains(current.toLowerCase(), name));
      if (!names.length && !this.mentions(current).includes(doc.id))
        for (const prior of [...previous].reverse()) {
          names = [...owners].filter((name) => contains(prior.toLowerCase(), name));
          if (names.length) break;
        }
      for (const root of roots)
        if (names.includes(this.rootOwners.get(root.itemId)!)) restricted.add(root.itemId);
    }
    for (const doc of this.documents.filter((d) => ids.includes(d.id) && !this.projects.has(d.id)))
      for (const root of doc.items.filter((i) => !i.parentId)) restricted.add(root.itemId);
    return needed ? [...restricted] : undefined;
  }
  lexical(text: string, id: string) {
    const informative = [...terms(text)].filter(
      (t) => (this.vocabulary.get(t)?.size ?? Infinity) <= Math.max(1, this.documents.length / 4),
    );
    return informative.filter((t) => this.vocabulary.get(t)?.has(id)).length;
  }
  identifies(text: string, id: string) {
    const shared = [...terms(text)].filter((term) => {
      const owners = this.headingVocabulary.get(term);
      return owners?.has(id) && owners.size <= Math.max(1, this.documents.length / 4);
    });
    return shared.some((term) => /^[a-z]/.test(term)) || shared.length >= 2;
  }
  setStemVectors(vectors: number[][]) {
    this.stemVectors = vectors.map(unit);
  }
  continuation(text: string, vector: number[]) {
    const query = unit(vector);
    return (
      this.stems.some((stem) => text.includes(stem)) ||
      this.stemVectors.some((stem) => dot(query, stem) >= GROUNDING.continuationCosine)
    );
  }
  accepts(text: string, id: string, contrast: number, cosine: number) {
    return (
      !this.isProject(id) &&
      contrast >= GROUNDING.standaloneContrast &&
      ((this.lexical(text, id) >= 1 && cosine >= GROUNDING.lexicalCosine) ||
        contrast >= GROUNDING.semanticContrast)
    );
  }
  rank(vector: number[], rows: GroundRow[]) {
    const q = unit(vector),
      residual = unit(q.map((n, i) => n - this.center[i]));
    return rows.map((row) => ({
      row,
      cosine: dot(q, row.vector),
      contrast: dot(residual, unit(row.vector.map((n, i) => n - this.center[i]))),
    }));
  }
}

// Preserve independently requested sources before filling the remaining budget.
// Scores remain comparable within each source; no extra score is manufactured.
export function interleaveSources<T>(rows: T[], key: (row: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row),
      group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  const result: T[] = [];
  for (let i = 0; result.length < rows.length; i++)
    for (const group of groups.values()) if (i < group.length) result.push(group[i]);
  return result;
}
