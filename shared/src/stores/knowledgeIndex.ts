import { create } from 'zustand';
import type {
  KnowledgeHit,
  KnowledgeItem,
  KnowledgeState,
  KnowledgeStatus,
  RagMode,
} from '../../electron/contracts/knowledge';
import type { LocalDocument } from '../services/knowledgeTypes';
import { knowledgeCall, indexOriginal, hasKnowledgeEngine } from '../services/knowledgeIndex';
interface IndexState {
  state: KnowledgeState | null;
  tasks: Record<string, KnowledgeStatus>;
  requests: Record<string, string>;
  error: string | null;
  hits: KnowledgeHit[];
  searching: boolean;
  refresh(): Promise<void>;
  connect(): () => void;
  index(doc: LocalDocument, force?: boolean): Promise<void>;
  cancel(documentId: string): Promise<void>;
  search(query: string, baseId: string, mode?: 'keyword' | 'vector' | 'hybrid'): Promise<void>;
  item(id: string): Promise<KnowledgeItem | null>;
  setMode(mode: RagMode): Promise<void>;
}
const message = (e: unknown) => (e instanceof Error ? e.message : '知识库操作失败。');
let searchVersion = 0,
  subscriptions = 0,
  refreshVersion = 0,
  eventVersion = 0;
let unsubscribe: (() => void) | undefined;
export const useKnowledgeIndex = create<IndexState>((set, get) => ({
  state: null,
  tasks: {},
  requests: {},
  error: null,
  hits: [],
  searching: false,
  async refresh() {
    if (!hasKnowledgeEngine()) return;
    const version = ++refreshVersion,
      events = eventVersion;
    try {
      const state = (await knowledgeCall({ op: 'status' })) as KnowledgeState;
      if (version !== refreshVersion) return;
      set({
        state,
        ...(events === eventVersion
          ? {
              tasks: Object.fromEntries(state.tasks.map((t) => [t.documentId, t])),
              requests: Object.fromEntries(
                state.tasks
                  .filter(
                    (t) =>
                      t.requestId &&
                      ['queued', 'parsing', 'embedding', 'indexing'].includes(t.phase),
                  )
                  .map((t) => [t.documentId, t.requestId!]),
              ),
            }
          : {}),
        error: null,
      });
    } catch (e) {
      if (version === refreshVersion) set({ error: message(e) });
    }
  },
  connect() {
    if (!hasKnowledgeEngine()) return () => {};
    if (subscriptions++ === 0)
      unsubscribe = window.desktop!.onKnowledgeEvent((status) => {
        eventVersion++;
        set((s) => {
          const requests = { ...s.requests };
          if (
            status.requestId &&
            ['queued', 'parsing', 'embedding', 'indexing'].includes(status.phase)
          )
            requests[status.documentId] = status.requestId;
          else delete requests[status.documentId];
          return { tasks: { ...s.tasks, [status.documentId]: status }, requests };
        });
        if (['ready', 'failed', 'cancelled'].includes(status.phase)) void get().refresh();
      });
    void get().refresh();
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      if (--subscriptions === 0) {
        unsubscribe?.();
        unsubscribe = undefined;
      }
    };
  },
  async index(doc, force = false) {
    if (!hasKnowledgeEngine()) return;
    if (get().requests[doc.id]) return;
    const requestId = crypto.randomUUID();
    set((s) => ({ requests: { ...s.requests, [doc.id]: requestId }, error: null }));
    try {
      await indexOriginal(doc, requestId, force);
    } catch (e) {
      if (get().requests[doc.id] === requestId)
        set((s) => ({
          tasks: {
            ...s.tasks,
            [doc.id]: {
              documentId: doc.id,
              phase: 'failed',
              completed: 0,
              total: 0,
              error: message(e),
            },
          },
        }));
    } finally {
      set((s) => {
        if (s.requests[doc.id] !== requestId) return {};
        const requests = { ...s.requests };
        delete requests[doc.id];
        return { requests };
      });
      await get().refresh();
    }
  },
  async cancel(documentId) {
    const requestId = get().requests[documentId];
    if (requestId) await knowledgeCall({ op: 'cancel', requestId });
  },
  async search(query, baseId, mode = 'hybrid') {
    const version = ++searchVersion;
    set({ searching: true, error: null, hits: [] });
    try {
      const hits = (await knowledgeCall({
        op: 'search',
        requestId: crypto.randomUUID(),
        query,
        baseId,
        mode,
        topK: 5,
      })) as KnowledgeHit[];
      if (version === searchVersion) set({ hits });
    } catch (e) {
      if (version === searchVersion) set({ error: message(e) });
    } finally {
      if (version === searchVersion) set({ searching: false });
    }
  },
  async item(itemId) {
    return (await knowledgeCall({
      op: 'item',
      requestId: crypto.randomUUID(),
      itemId,
    })) as KnowledgeItem | null;
  },
  async setMode(mode) {
    try {
      await knowledgeCall({ op: 'settings', mode });
      await get().refresh();
    } catch (e) {
      set({ error: message(e) });
    }
  },
}));
