import { create } from 'zustand';
import type { KnowledgeState, KnowledgeStatus } from '../../electron/contracts/knowledge';
import { isKnowledgeFileName } from '../../electron/contracts/knowledge';
import type { LocalDocument } from '../services/knowledgeTypes';
import { knowledgeCall, indexOriginal, hasKnowledgeEngine } from '../services/knowledgeIndex';
import { localKnowledge, syncKnowledgeSnapshot, documentRevision } from '../services/knowledge';
import { componentReady } from './components';
interface IndexState {
  state: KnowledgeState | null;
  tasks: Record<string, KnowledgeStatus>;
  requests: Record<string, string>;
  error: string | null;
  dismissError(): void;
  refresh(): Promise<void>;
  connect(): () => void;
  index(doc: LocalDocument, force?: boolean): Promise<void>;
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
  run(): Promise<void>;
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
  function pump() {
    if (worker || !nextJob()) return;
    worker = Promise.resolve()
      .then(async () => {
        let job: IndexJob | undefined;
        while ((job = nextJob())) {
          activeBase = job.baseId;
          job.started = true;
          await job.run();
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
    tasks: {},
    requests: {},
    error: null,
    dismissError() {
      errorVersion++;
      set({ error: null });
    },
    refresh() {
      if (!hasKnowledgeEngine()) return Promise.resolve();
      if (refreshing) return refreshing;
      const version = ++refreshVersion,
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
            ...(errorEpoch === errorVersion ? { error: null } : {}),
          });
        } catch (e) {
          if (version === refreshVersion && errorEpoch === errorVersion) set({ error: message(e) });
        }
      })().finally(() => {
        refreshing = undefined;
        if (version !== refreshVersion && (subscriptions || scans.size)) return get().refresh();
      });
      return refreshing;
    },
    connect() {
      if (!hasKnowledgeEngine()) return () => {};
      if (subscriptions++ === 0)
        unsubscribe = window.desktop!.onKnowledgeEvent((status) => {
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
          unsubscribe?.();
          unsubscribe = undefined;
          for (const job of jobs.values()) job.finish();
          jobs.clear();
          scans.clear();
          attempts.clear();
          if (active)
            void knowledgeCall({ op: 'cancel', requestId: active.requestId }).catch(() => {});
          set({ requests: {} });
        }
      };
    },
    index(doc, force = false) {
      if (!isKnowledgeFileName(doc.name)) return Promise.resolve();
      if (!hasKnowledgeEngine() || !componentReady('rag')) return Promise.resolve();
      const revision = documentRevision(doc);
      const existing = jobs.get(doc.id);
      if (existing && (!existing.started || existing.revision === revision)) {
        existing.revision = revision;
        existing.force ||= force;
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
        requestId: crypto.randomUUID(),
        done,
        run: async () => {},
        finish: resolve,
      };
      jobs.set(doc.id, job);
      set((s) => ({
        requests: { ...s.requests, [doc.id]: job.requestId },
        tasks: { ...s.tasks, [doc.id]: queued(job) },
        error: null,
      }));
      const epoch = lifetime;
      job.run = async () => {
        try {
          if (epoch !== lifetime || !componentReady('rag')) return;
          active = job;
          // Queue metadata only; load current bytes when this job gets its turn.
          const current = (await localKnowledge.listDocuments(job.baseId)).find(
            (doc) => doc.id === job.id,
          );
          if (current && jobs.get(job.id) === job) {
            job.revision = documentRevision(current);
            await indexOriginal(current, job.requestId, job.force);
            // A status read started before this commit cannot verify the new index.
            if (epoch === lifetime) refreshVersion++;
            attempts.delete(job.id);
          }
        } catch (e) {
          if (epoch !== lifetime) return;
          attempts.set(job.id, { revision: job.revision, until: Date.now() + 60_000 });
          if (attempts.size > 256) attempts.delete(attempts.keys().next().value!);
          if (jobs.get(job.id) === job)
            set((s) => ({
              tasks: {
                ...s.tasks,
                [job.id]: { ...queued(job), phase: 'failed', error: message(e) },
              },
            }));
        } finally {
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
          active = undefined;
          if (epoch === lifetime && !jobs.size) await get().refresh();
          resolve();
        }
      };
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
        for (const doc of documents) {
          if (!isKnowledgeFileName(doc.name)) continue;
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
          if (!state || get().error || !state.modelReady) return;
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
              .map((doc) => get().index(doc)),
          );
        }
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
