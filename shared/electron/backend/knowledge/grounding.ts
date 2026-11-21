import { setImmediate as yieldToWorker } from 'node:timers/promises';
import { KnowledgeError } from './errors';
import { MAX_EVIDENCE_ROOTS } from '../../contracts/retrievalContext';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const fillers = /嗯+|呃+|额+|哎+|唉+|就是说|我想问一下|我想问|问一下|你给我|你说说|你讲讲|说说|讲讲|聊聊|说一下|讲一下|聊一下|大概|一下|对吧|是吧|的话|这个东西|那个东西|那个|这个|就是/g;
const followCue = /^(?:那|那么|这|这个|那个|它|他|她|如果|要是|假如|所以|然后|还有|另外)|刚才|刚刚|之前|前面|回到|说回|上一个|上个问题|你说的|你刚说|这种情况|这样做|这么做|这招|这个结果/;
const returnCue = /回到|说回|刚才那|之前那|前面那|最开始|一开始|最早|第一个/;

export function cleanGroundingQuery(text: string) {
  const repaired = text
    .replace(/(?<![A-Za-z])([A-Za-z])((?:\s[A-Za-z])+)(?![A-Za-z])/g, match => match.replace(/\s/g, ''))
    .replace(/([A-Za-z])\s*加加/g, '$1++')
    .replace(/\b([A-Za-z]{2,})\s*(?:二|two)\b/gi, '$12')
    .replace(/\b([A-Za-z]{2,})\s*二(?=[^一-鿿]|[的里中，,])/g, '$12');
  return repaired.replace(fillers, ' ').replace(/^[\s，,。！？!?、啊哦呀吧那]+/, '').replace(/\s+/g, ' ').trim() || repaired;
}

export function isGroundingFollowUp(raw: string) {
  return followCue.test(raw.trim()) || raw.replace(/[\s\p{P}]/gu, '').length <= 10;
}

export function unitVector(values: ArrayLike<number> | undefined) {
  if (values?.length !== 384) throw new KnowledgeError('integrity', '知识检索向量格式无效。');
  let squared = 0;
  for (let i = 0; i < values.length; i++) squared += values[i] * values[i];
  if (!Number.isFinite(squared) || squared === 0) throw new KnowledgeError('integrity', '知识检索向量格式无效。');
  const inverse = 1 / Math.sqrt(squared);
  const vector = new Float32Array(values.length);
  for (let i = 0; i < vector.length; i++) vector[i] = values[i] * inverse;
  return vector;
}

function dot(a: Float32Array, b: Float32Array) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export interface GroundQuery { text: string; vector: Float32Array }

// Candidates are newest first. An exact tie stays with the more recent question.
export function selectHistory(raw: string, current: GroundQuery, recent: GroundQuery[]) {
  let best: GroundQuery | undefined, high = -Infinity;
  const bonus = returnCue.test(raw) ? 0 : 0.06;
  for (const [position, question] of recent.entries()) {
    const score = dot(current.vector, question.vector) + (position === 0 ? bonus : 0);
    if (score > high) { best = question; high = score; }
  }
  return best;
}

function wordCounts(text: string) {
  const counts = new Map<string, number>();
  let length = 0;
  for (const token of segmenter.segment(text.toLowerCase())) {
    if (!token.isWordLike) continue;
    counts.set(token.segment, (counts.get(token.segment) ?? 0) + 1);
    length++;
  }
  return { counts, length };
}

export interface GroundRow {
  chunkId: string;
  documentId: string;
  rootItemId: string;
  itemId: string;
  text: string;
  vector: ArrayLike<number>;
}
type Reference = Omit<GroundRow, 'vector'>;
type Slice = ReturnType<typeof compile>;
type StoredSlice = Omit<Slice, 'counts'>;
function compile(row: GroundRow) {
  const { vector, text, ...identity } = row;
  return { ref: { ...identity, text: text.slice(0, 1600) }, vector: unitVector(vector), ...wordCounts(text) };
}

type ReadRows = () => AsyncIterable<GroundRow>;
async function* compiledRows(read: ReadRows, signal: AbortSignal) {
  let count = 0;
  for await (const row of read()) {
    if (++count % 128 === 0) await yieldToWorker();
    signal.throwIfAborted();
    yield compile(row);
  }
}

interface Family {
  row: Reference;
  cosine: number;
  lexical: number;
  historyCosine: number;
  historyLexical: number;
}

export class GroundingIndex {
  private df = new Map<string, number>();
  private count = 0;
  private averageLength = 0;
  // Large libraries retain only corpus statistics. Their slices stream from the pinned table.
  private cached?: { slices: StoredSlice[]; postings: Map<string, number[]> } = { slices: [], postings: new Map() };

  static async load(read: ReadRows, signal: AbortSignal) {
    const index = new GroundingIndex();
    let retained = 0, totalLength = 0;
    for await (const { counts, ...slice } of compiledRows(read, signal)) {
      index.count++;
      totalLength += slice.length;
      retained += slice.vector.byteLength + 512 + 2 * slice.ref.text.length + 24 * counts.size;
      if (retained > 64 * 1024 * 1024) index.cached = undefined;
      const row = index.cached?.slices.length ?? 0;
      index.cached?.slices.push(slice);
      for (const [term, count] of counts) {
        index.df.set(term, (index.df.get(term) ?? 0) + 1);
        if (index.cached) {
          const posting = index.cached.postings.get(term);
          if (posting) posting.push(row, count);
          else index.cached.postings.set(term, [row, count]);
        }
      }
    }
    signal.throwIfAborted();
    index.averageLength = totalLength / index.count || 1;
    return index;
  }

  private weightedTerms(text: string) {
    const terms: [string, number][] = [];
    for (const term of wordCounts(text).counts.keys()) {
      const df = this.df.get(term);
      if (df) terms.push([term, 2.2 * Math.log1p((this.count - df + 0.5) / (df + 0.5))]);
    }
    return terms;
  }

  private lexicalScores(terms: [string, number][], cache: NonNullable<GroundingIndex['cached']>) {
    const scores = new Float32Array(cache.slices.length);
    for (const [term, weight] of terms) {
      const posting = cache.postings.get(term)!;
      for (let i = 0; i < posting.length; i += 2) {
        const row = posting[i], tf = posting[i + 1];
        const denominator = 1.2 * (0.25 + 0.75 * cache.slices[row].length / this.averageLength);
        scores[row] += weight * tf / (tf + denominator);
      }
    }
    return scores;
  }

  async rank(read: ReadRows, current: GroundQuery, history: GroundQuery | undefined, signal: AbortSignal) {
    const families = new Map<string, Family>();
    const terms = this.weightedTerms(current.text);
    const priorTerms = history && this.weightedTerms(history.text);
    let maxLexical = 0, maxPriorLexical = 0;
    const score = (slice: StoredSlice, lexical: number, historyLexical: number) => {
      const cosine = dot(current.vector, slice.vector);
      const historyCosine = history ? dot(history.vector, slice.vector) : 0;
      maxLexical = Math.max(maxLexical, lexical);
      maxPriorLexical = Math.max(maxPriorLexical, historyLexical);
      const family = families.get(slice.ref.rootItemId);
      if (!family) {
        families.set(slice.ref.rootItemId, { row: slice.ref, cosine, lexical, historyCosine, historyLexical });
      } else {
        if (cosine > family.cosine) { family.row = slice.ref; family.cosine = cosine; }
        family.lexical = Math.max(family.lexical, lexical);
        family.historyCosine = Math.max(family.historyCosine, historyCosine);
        family.historyLexical = Math.max(family.historyLexical, historyLexical);
      }
    };
    if (this.cached) {
      const lexical = this.lexicalScores(terms, this.cached);
      const prior = priorTerms && this.lexicalScores(priorTerms, this.cached);
      for (let i = 0; i < this.cached.slices.length; i++) {
        if (i && i % 512 === 0) { await yieldToWorker(); signal.throwIfAborted(); }
        score(this.cached.slices[i], lexical[i], prior?.[i] ?? 0);
      }
    } else {
      for await (const slice of compiledRows(read, signal)) {
        const denominator = 1.2 * (0.25 + 0.75 * slice.length / this.averageLength);
        score(slice, bm25(slice, terms, denominator), priorTerms ? bm25(slice, priorTerms, denominator) : 0);
      }
    }
    signal.throwIfAborted();
    const currentWeight = maxLexical ? 0.05 / maxLexical : 0;
    const priorWeight = maxPriorLexical ? 0.05 / maxPriorLexical : 0;
    return Array.from(families.values(), family => ({
      row: family.row, cosine: family.cosine,
      score: family.cosine + currentWeight * family.lexical + family.historyCosine + priorWeight * family.historyLexical,
    })).sort((a, b) => b.score - a.score).slice(0, MAX_EVIDENCE_ROOTS);
  }
}

function bm25(slice: Slice, terms: [string, number][], denominator: number) {
  let score = 0;
  for (const [term, weight] of terms) {
    const tf = slice.counts.get(term);
    if (tf) score += weight * tf / (tf + denominator);
  }
  return score;
}
