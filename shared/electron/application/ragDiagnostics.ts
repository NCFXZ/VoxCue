export type RagDecisionReason =
  | 'not_in_shortlist'
  | 'filtered_by_relevance'
  | 'fetch_unavailable'
  | 'over_budget'
  | 'used_as_evidence'
  | 'duplicate';
export interface RagDecision {
  itemId: string;
  reason: RagDecisionReason;
}
/** An explicitly injected offline observer only. No question, text, filename or content. */
export interface RagTrace {
  candidates: string[];
  shortlist: string[];
  fetched: string[];
  decisions: RagDecision[];
  state: 'complete' | 'partial' | 'unavailable';
  retrievalMs: number;
  reused: boolean;
}
