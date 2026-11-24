import { create } from 'zustand';
import type { KnowledgeState, KnowledgeStatus } from '../../electron/contracts/knowledge';
import { isKnowledgeFileName, KNOWLEDGE_INDEX_VERSION, knowledgeBatchChanged, knowledgeBatchLimit, knowledgeIndexCancelled } from '../../electron/contracts/knowledge';
import type { LocalDocument } from '../services/knowledgeTypes';
import { knowledgeCall, indexOriginal, hasKnowledgeEngine, pendingBaseRemovals, documentIndexFraction } from '../services/knowledgeIndex';
import { localKnowledge, readKnowledgeOriginal, syncKnowledgeSnapshot, documentRevision } from '../services/knowledge';
import { knowledgeRemovalPending } from '../services/knowledgeRemovals';
import { componentReady } from './components';
interface IndexState {
  state: KnowledgeState | null;
  deletingDocumentIds: ReadonlySet<string> | null;
  tasks: Record<string, KnowledgeStatus>;
  requests: Record<string, string>;
  error: string | null;
  dismissError(): void;
  libraryProgress: Readonly<Record<string, number>>;
  refresh(): Promise<void>;
  connect(): () => void;
  index(doc: LocalDocument, force?: boolean, selection?: string): Promise<void>;
  indexSelection(documents: LocalDocument[], force?: boolean): Promise<void>;
  restoreBatch(): { add(doc: LocalDocument): void; flush(discard?: boolean): void };
  reconcile(baseId?: string, errorEpoch?: number): Promise<void>;
}
const message = (e: unknown) => (e instanceof Error ? e.message : '知识库操作失败。');
const processing = (status?: KnowledgeStatus) =>
  !!status && ['queued', 'parsing', 'embedding', 'indexing'].includes(status.phase);
interface IndexJob {
  id: string;
  baseId: string;
  revision: string | null;
  requestId: string;
  force: boolean;
  started?: boolean;
  done: Promise<void>;
  selection?: string;
  run(batchId?: string): Promise<boolean>;
  fail(error: unknown): void;
  complete(refresh?: boolean): Promise<void>;
  finish(): void;
}
let subscriptions = 0,
  refreshVersion = 0,
  eventVersion = 0;
let unsubscribe: (() => void) | undefined;
export const useKnowledgeIndex = create<IndexState>((set, get) => {
  const jobs = new Map<string, IndexJob>();
  const heldSelections = new Set<string>();
  // Keep completed members until the last job in their library settles. Only
  // fractions and document IDs survive each file's turn, never its original bytes.
  const batches = new Map<string, { fractions: Map<string, number>; sum: number; pending: number }>();
  function progressFor(baseId: string, documentId: string, fraction: number) {
    const batch = batches.get(baseId);
    const previous = get().libraryProgress;
    if (!batch) return previous;
    batch.sum += fraction - (batch.fractions.get(documentId) ?? 0);
    batch.fractions.set(documentId, fraction);
    // Full embedding/staging is not a completed index until its write commits.
    const percent = Math.max(0, Math.min(99, Math.floor(batch.sum * 100 / batch.fractions.size)));
    if (previous[baseId] === percent) return previous;
    return { ...previous, [baseId]: percent };
  }
  function finishProgress(baseId: string) {
    const batch = batches.get(baseId);
    if (batch && --batch.pending === 0) {
      batches.delete(baseId);
      const next = { ...get().libraryProgress };
      delete next[baseId];
      return next;
    }
    return get().libraryProgress;
  }
  const attempts = new Map<string, { revision: string | null; until: number }>();
  const scans = new Map<string, Promise<void>>();
  let worker: Promise<void> | undefined;
  let activeBase: string | undefined;
  let active: IndexJob | undefined;
  let activeBatch: string | undefined;
  let lifetime = 0;
  let refreshing: Promise<void> | undefined;
  let errorVersion = 0;
  const queued = (job: IndexJob): KnowledgeStatus => ({
    documentId: job.id,
    requestId: job.requestId,
    phase: 'queued',
    completed: 0,
    total: 0,
  });
  function nextJob() {
    const pending = [...jobs.values()].filter(job => !job.started && !(job.selection && heldSelections.has(job.selection)));
    const sameBase = pending.find((job) => job.baseId === activeBase);
    return sameBase ?? pending[0];
  }
  async function runGroup(group: IndexJob[]) {
    const epoch = lifetime;
    const batchId = crypto.randomUUID();
    let failed: IndexJob | undefined;
    const live = (job: IndexJob) => epoch === lifetime && jobs.get(job.id) === job;
    activeBatch = batchId;
    try {
      await knowledgeCall({ op: 'begin-index-batch', requestId: batchId, baseId: group[0].baseId,
        documentIds: group.map(job => job.id) });
      for (const job of group) {
        if (!live(job)) throw Error(knowledgeBatchChanged);
        job.started = true;
        try {
          if (!await job.run(batchId)) throw Error(knowledgeBatchChanged);
        } catch (error) {
          if (message(error) !== knowledgeBatchChanged && message(error) !== knowledgeIndexCancelled && live(job)) {
            failed = job;
            job.fail(error);
          }
          throw error;
        }
      }
      if (!group.every(live)) throw Error(knowledgeBatchChanged);
      await knowledgeCall({ op: 'finish-index-batch', requestId: crypto.randomUUID(), batchId, commit: true });
    } catch (error) {
      // A native write may already have changed its private version. Retire it
      // before replaying healthy originals, rereading their current bytes one at a time.
      try {
        await knowledgeCall({ op: 'finish-index-batch', requestId: crypto.randomUUID(), batchId, commit: false });
      } catch (cleanupError) {
        for (const job of group) if (job !== failed && live(job)) job.fail(cleanupError);
        return;
      }
      if (message(error) === knowledgeIndexCancelled) return;
      for (const job of group) {
        if (!live(job) || job === failed) continue;
        job.started = true;
        try { await job.run(); } catch (error) { job.fail(error); }
      }
    } finally {
      activeBatch = undefined;
      for (const job of group) await job.complete();
    }
  }
  function pump() {
    if (worker || !nextJob()) return;
    worker = Promise.resolve()
      .then(async () => {
        let job: IndexJob | undefined;
        while ((job = nextJob())) {
          activeBase = job.baseId;
          const selection = job.selection;
          const group = selection ? [...jobs.values()].filter(other => !other.started &&
            other.selection === selection && other.baseId === activeBase).slice(0, knowledgeBatchLimit) : [job];
          if (group.length > 1) await runGroup(group);
          else {
            job.started = true;
            try { await job.run(); } catch (error) { job.fail(error); }
            await job.complete();
          }
        }
      })
      .finally(() => {
        worker = undefined;
        if (!jobs.size) activeBase = undefined;
        pump();
      });
  }
  return {
    state: null,
    deletingDocumentIds: null,
    tasks: {},
    requests: {},
    libraryProgress: {},
    error: null,
    dismissError() {
      errorVersion++;
      set({ error: null });
    },
    refresh() {
      if (!hasKnowledgeEngine()) return Promise.resolve();
      if (refreshing) return refreshing;
      const epoch = lifetime,
        version = ++refreshVersion,
        events = eventVersion,
        errorEpoch = errorVersion;
      refreshing = (async () => {
        try {
          const state = (await knowledgeCall({ op: 'status' })) as KnowledgeState;
          if (version !== refreshVersion) return;
          const tasks = Object.fromEntries(state.tasks.map((t) => [t.documentId, t]));
          const requests = Object.fromEntries(
            state.tasks
              .filter((t) => t.requestId && processing(t))
              .map((t) => [t.documentId, t.requestId!]),
          );
          for (const job of jobs.values()) {
            tasks[job.id] =
              get().tasks[job.id]?.requestId === job.requestId ? get().tasks[job.id] : queued(job);
            requests[job.id] = job.requestId;
          }
          set({
            state,
            ...(events === eventVersion
              ? {
                  tasks,
                  requests,
                }
              : {}),
            ...(errorEpoch === errorVersion ? { error: state.error ?? null } : {}),
          });
        } catch (e) {
          if (version === refreshVersion)
            set({ state: null, ...(errorEpoch === errorVersion && { error: message(e) }) });
        }
      })().finally(() => {
        if (epoch !== lifetime) return;
        refreshing = undefined;
        if (version !== refreshVersion && (subscriptions || scans.size)) return get().refresh();
      });
      return refreshing;
    },
    connect() {
      if (!hasKnowledgeEngine()) return () => {};
      const epoch = lifetime;
      if (subscriptions++ === 0)
        unsubscribe = window.desktop!.onKnowledgeEvent((status) => {
          if (epoch !== lifetime) return;
          if ('type' in status) {
            const current = get().deletingDocumentIds;
            if (!status.active) {
              if (current) set({ deletingDocumentIds: null });
            } else if (!current || current.size !== status.documentIds.length ||
                status.documentIds.some(id => !current.has(id))) {
              set({ deletingDocumentIds: new Set(status.documentIds) });
            }
            return;
          }
          const job = jobs.get(status.documentId);
          if (job && status.requestId && job.requestId !== status.requestId) return;
          eventVersion++;
          set((s) => {
            const requests = { ...s.requests };
            if (status.requestId && (processing(status) || !!job))
              requests[status.documentId] = status.requestId;
            else delete requests[status.documentId];
            const libraryProgress = job && status.requestId === job.requestId
              ? progressFor(job.baseId, job.id, documentIndexFraction(status)) : s.libraryProgress;
            return { tasks: { ...s.tasks, [status.documentId]: status }, requests, libraryProgress };
          });
          if (['ready', 'failed', 'cancelled'].includes(status.phase)) void get().refresh();
        });
      void get().refresh();
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        if (--subscriptions === 0) {
          lifetime++;
          refreshVersion++;
          // A new subscriber needs its own status call to replay an ongoing cleanup.
          refreshing = undefined;
          unsubscribe?.();
          unsubscribe = undefined;
          for (const job of jobs.values()) job.finish();
          jobs.clear();
          batches.clear();
          scans.clear();
          attempts.clear();
          const requestId = activeBatch ?? active?.requestId;
          if (requestId) void knowledgeCall({ op: 'cancel', requestId }).catch(() => {});
          set({ state: null, tasks: {}, requests: {}, libraryProgress: {}, deletingDocumentIds: null, error: null });
        }
      };
    },
    async indexSelection(documents, force = false) {
      const selection = crypto.randomUUID();
      await Promise.all(documents.map(doc => get().index(doc, force, selection)));
    },
    restoreBatch() {
      // Register each committed original in the ordinary queue immediately, so an
      // overlapping reconciliation sees it. Release work one library / 20 files at a time.
      let selection: string | undefined, baseId: string | undefined, count = 0;
      const flush = (discard = false) => {
        if (!selection) return;
        heldSelections.delete(selection);
        if (discard) {
          for (const job of jobs.values())
            if (job.selection === selection && !job.started) void job.complete(false);
        }
        selection = undefined;
        count = 0;
        pump();
      };
      return {
        add(doc) {
          if (baseId !== doc.baseId) flush();
          if (!selection) {
            baseId = doc.baseId;
            selection = crypto.randomUUID();
            heldSelections.add(selection);
          }
          void get().index(doc, false, selection);
          if (++count === knowledgeBatchLimit) flush();
        },
        flush,
      };
    },
    index(doc, force = false, selection) {
      if (!isKnowledgeFileName(doc.name)) return Promise.resolve();
      if (!hasKnowledgeEngine() || !componentReady('rag')) return Promise.resolve();
      if (knowledgeRemovalPending('file:' + doc.id) || knowledgeRemovalPending('base:' + doc.baseId))
        return Promise.resolve();
      const revision = documentRevision(doc);
      const existing = jobs.get(doc.id);
      if (existing && existing.baseId === doc.baseId && (!existing.started || existing.revision === revision)) {
        existing.revision = revision;
        existing.force ||= force;
        if (!existing.started && selection) existing.selection = selection;
        return existing.done;
      }
      const attempt = attempts.get(doc.id);
      if (!force && attempt?.revision === revision && attempt.until > Date.now())
        return Promise.resolve();
      let resolve!: () => void;
      const done = new Promise<void>((r) => {
        resolve = r;
      });
      const job: IndexJob = {
        id: doc.id,
        baseId: doc.baseId,
        revision,
        force,
        selection,
        requestId: crypto.randomUUID(),
        done,
        run, fail, complete,
        finish: resolve,
      };
      if (existing && existing.baseId !== doc.baseId) {
        set({ libraryProgress: finishProgress(existing.baseId) });
        if (!existing.started) void done.then(existing.finish);
      }
      const batch = batches.get(doc.baseId) ?? { fractions: new Map<string, number>(), sum: 0, pending: 0 };
      if (existing?.baseId !== doc.baseId) ++batch.pending;
      batches.set(doc.baseId, batch);
      jobs.set(doc.id, job);
      set((s) => ({
        requests: { ...s.requests, [doc.id]: job.requestId },
        tasks: { ...s.tasks, [doc.id]: queued(job) },
        libraryProgress: progressFor(job.baseId, job.id, 0),
        error: null,
      }));
      const epoch = lifetime;
      async function run(batchId?: string) {
        try {
          if (epoch !== lifetime || jobs.get(job.id) !== job || !componentReady('rag')) return false;
          active = job;
          // Queue metadata only; load current bytes when this job gets its turn.
          const sent = await indexOriginal(
            job,
            async () => {
              const current = await readKnowledgeOriginal('documents', job.id);
              if (!current || current.baseId !== job.baseId) return;
              job.revision = documentRevision(current);
              return current;
            },
            job.requestId,
            job.force,
            () => epoch === lifetime && jobs.get(job.id) === job,
            batchId,
          );
          // A status read started before this commit cannot verify the new index.
          if (epoch === lifetime) refreshVersion++;
          const phase = get().tasks[job.id]?.phase;
          if (sent && epoch === lifetime && jobs.get(job.id) === job && phase !== 'cancelled' && phase !== 'failed') {
            const progress = progressFor(job.baseId, job.id, 1);
            if (progress !== get().libraryProgress) set({ libraryProgress: progress });
          }
          attempts.delete(job.id);
          return !!sent;
        } finally {
          active = undefined;
        }
      }
      function fail(e: unknown) {
        if (epoch !== lifetime) return;
        const cancelled = message(e) === knowledgeIndexCancelled;
        if (!cancelled) attempts.set(job.id, { revision: job.revision, until: Date.now() + 60_000 });
        if (attempts.size > 256) attempts.delete(attempts.keys().next().value!);
        if (jobs.get(job.id) === job)
          set((s) => ({
            libraryProgress: progressFor(job.baseId, job.id, 0),
            tasks: {
              ...s.tasks,
              [job.id]: { ...queued(job), phase: cancelled ? 'cancelled' : 'failed', error: message(e) },
            },
          }));
      }
      async function complete(refresh = true) {
        if (jobs.get(job.id) === job) {
          jobs.delete(job.id);
          set((s) => {
            const requests = { ...s.requests },
              tasks = { ...s.tasks };
            delete requests[job.id];
            if (tasks[job.id]?.phase === 'queued') delete tasks[job.id];
            return { requests, tasks, libraryProgress: finishProgress(job.baseId) };
          });
        }
        if (refresh && epoch === lifetime && !jobs.size) await get().refresh();
        resolve();
      }
      pump();
      return job.done;
    },
    reconcile(baseId, errorEpoch = errorVersion) {
      if (!hasKnowledgeEngine() || !componentReady('rag')) return Promise.resolve();
      const key = baseId ?? '*';
      if (scans.has(key)) return scans.get(key)!;
      const epoch = lifetime;
      if (baseId && scans.has('*')) {
        const follow = scans.get('*')!.then(() => {
          if (epoch !== lifetime) return;
          if (scans.get(key) === follow) scans.delete(key);
          return get().reconcile(baseId, errorEpoch);
        });
        scans.set(key, follow);
        return follow;
      }
      const scan = (async () => {
        const documents = baseId
          ? await localKnowledge.listDocuments(baseId)
          : (await syncKnowledgeSnapshot()).documents;
        if (epoch !== lifetime) return;
        const groups = new Map<string, LocalDocument[]>();
        const deleting = new Set(pendingBaseRemovals());
        for (const doc of documents) {
          if (!isKnowledgeFileName(doc.name) || deleting.has(doc.baseId) ||
            knowledgeRemovalPending('base:' + doc.baseId) || knowledgeRemovalPending('file:' + doc.id)) continue;
          const group = groups.get(doc.baseId) ?? [];
          group.push(doc);
          groups.set(doc.baseId, group);
        }
        let indexed: Map<string, string> | undefined;
        for (const group of groups.values()) {
          if (epoch !== lifetime) return;
          if (!indexed) {
            // Recheck after asynchronous reads or writes; settled groups share this snapshot.
            await get().refresh();
            if (epoch !== lifetime) return;
            const state = get().state;
            if (!state?.modelReady || state.error || get().error || get().deletingDocumentIds ||
                state.documents.some(doc => doc.indexVersion !== KNOWLEDGE_INDEX_VERSION)) return;
            indexed = new Map(state.documents.filter(doc => doc.available !== false)
              .map(doc => [doc.documentId, doc.baseId]));
          }
          const catalog = indexed;
          const missing = group.filter(doc => catalog.get(doc.id) !== doc.baseId &&
            !processing(get().tasks[doc.id]) && !get().requests[doc.id]);
          if (missing.length) {
            await get().indexSelection(missing);
            indexed = undefined;
          }
        }
        if (!baseId && !groups.size) await get().refresh();
      })()
        .catch((e) => {
          if (epoch === lifetime && errorEpoch === errorVersion) set({ error: message(e) });
        })
        .finally(() => {
          if (scans.get(key) === scan) scans.delete(key);
        });
      scans.set(key, scan);
      return scan;
    },
  };
});
