import { create } from 'zustand';
import type { KnowledgeState, KnowledgeStatus } from '../../electron/contracts/knowledge';
import { isKnowledgeFileName, KNOWLEDGE_INDEX_VERSION, knowledgeBatchChanged, knowledgeBatchLimit, knowledgeIndexCancelled } from '../../electron/contracts/knowledge';
import type { LocalDocument } from '../services/knowledgeTypes';
import { knowledgeCall, indexOriginal, hasKnowledgeEngine, pendingBaseRemovals } from '../services/knowledgeIndex';
import { localKnowledge, readKnowledgeOriginal, syncKnowledgeSnapshot, documentRevision, recoverKnowledgeBaseRemovals } from '../services/knowledge';
import { componentReady } from './components';
interface IndexState {
  state: KnowledgeState | null;
  deletingDocumentIds: ReadonlySet<string> | null;
  tasks: Record<string, KnowledgeStatus>;
  requests: Record<string, string>;
  error: string | null;
  dismissError(): void;
  currentProgress(baseId: string): KnowledgeStatus | undefined;
  refresh(): Promise<void>;
  connect(): () => void;
  index(doc: LocalDocument, force?: boolean, selection?: string): Promise<void>;
  indexSelection(documents: LocalDocument[]): Promise<void>;
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
  complete(): Promise<void>;
  finish(): void;
}
let subscriptions = 0,
  refreshVersion = 0,
  eventVersion = 0;
let unsubscribe: (() => void) | undefined;
export const useKnowledgeIndex = create<IndexState>((set, get) => {
  const jobs = new Map<string, IndexJob>();
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
    const pending = [...jobs.values()].filter((job) => !job.started);
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
    error: null,
    dismissError() {
      errorVersion++;
      set({ error: null });
    },
    currentProgress(baseId) {
      if (baseId !== activeBase) return;
      const { tasks } = get();
      if (active && processing(tasks[active.id])) return tasks[active.id];
      for (const job of jobs.values())
        if (job.baseId === baseId && processing(tasks[job.id])) return tasks[job.id];
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
      if (!subscriptions) void recoverKnowledgeBaseRemovals().catch(e => {
        if (epoch === lifetime) set({ error: message(e) });
      });
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
          lifetime++;
          refreshVersion++;
          // A new subscriber needs its own status call to replay an ongoing cleanup.
          refreshing = undefined;
          unsubscribe?.();
          unsubscribe = undefined;
          for (const job of jobs.values()) job.finish();
          jobs.clear();
          scans.clear();
          attempts.clear();
          const requestId = activeBatch ?? active?.requestId;
          if (requestId) void knowledgeCall({ op: 'cancel', requestId }).catch(() => {});
          set({ state: null, tasks: {}, requests: {}, deletingDocumentIds: null, error: null });
        }
      };
    },
    async indexSelection(documents) {
      const selection = crypto.randomUUID();
      await Promise.all(documents.map(doc => get().index(doc, false, selection)));
    },
    index(doc, force = false, selection) {
      if (!isKnowledgeFileName(doc.name)) return Promise.resolve();
      if (!hasKnowledgeEngine() || !componentReady('rag')) return Promise.resolve();
      const revision = documentRevision(doc);
      const existing = jobs.get(doc.id);
      if (existing && (!existing.started || existing.revision === revision)) {
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
      jobs.set(doc.id, job);
      set((s) => ({
        requests: { ...s.requests, [doc.id]: job.requestId },
        tasks: { ...s.tasks, [doc.id]: queued(job) },
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
            tasks: {
              ...s.tasks,
              [job.id]: { ...queued(job), phase: cancelled ? 'cancelled' : 'failed', error: message(e) },
            },
          }));
      }
      async function complete() {
        if (jobs.get(job.id) === job) {
          jobs.delete(job.id);
          set((s) => {
            const requests = { ...s.requests },
              tasks = { ...s.tasks };
            delete requests[job.id];
            if (tasks[job.id]?.phase === 'queued') delete tasks[job.id];
            return { requests, tasks };
          });
        }
        if (epoch === lifetime && !jobs.size) await get().refresh();
        resolve();
      }
      pump();
      return job.done;
    },
    reconcile(baseId, errorEpoch = errorVersion) {
      if (!hasKnowledgeEngine() || !componentReady('rag')) return Promise.resolve();
      const key = baseId ?? '*';
      if (scans.has(key)) return scans.get(key)!;
      if (baseId && scans.has('*')) {
        const follow = scans.get('*')!.then(() => {
          if (scans.get(key) === follow) scans.delete(key);
          return get().reconcile(baseId, errorEpoch);
        });
        scans.set(key, follow);
        return follow;
      }
      const epoch = lifetime;
      const scan = (async () => {
        const documents = baseId
          ? await localKnowledge.listDocuments(baseId)
          : (await syncKnowledgeSnapshot()).documents;
        const groups = new Map<string, LocalDocument[]>();
        const deleting = new Set(pendingBaseRemovals());
        for (const doc of documents) {
          if (!isKnowledgeFileName(doc.name) || deleting.has(doc.baseId)) continue;
          const group = groups.get(doc.baseId) ?? [];
          group.push(doc);
          groups.set(doc.baseId, group);
        }
        for (const group of groups.values()) {
          if (epoch !== lifetime) return;
          // Other imports can finish during the IndexedDB read or a previous group.
          await get().refresh();
          if (epoch !== lifetime) return;
          const state = get().state;
          if (!state?.modelReady || state.error || get().error || get().deletingDocumentIds ||
              state.documents.some(doc => doc.indexVersion !== KNOWLEDGE_INDEX_VERSION)) return;
          const indexed = new Map(
            state.documents
              .filter((doc) => doc.available !== false)
              .map((doc) => [doc.documentId, doc]),
          );
          await Promise.all(
            group
              .filter(
                (doc) =>
                  indexed.get(doc.id)?.baseId !== doc.baseId &&
                  !processing(get().tasks[doc.id]) &&
                  !get().requests[doc.id],
              )
              .map(doc => get().index(doc)),
          );
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
