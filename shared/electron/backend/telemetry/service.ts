import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  telemetryUuid,
  telemetryTimestamp,
  validTelemetryEvent,
  type TelemetryData,
  type TelemetryEvent,
  type TelemetryWireEvent,
  type TelemetryIdentity,
  type TelemetryFeature,
  type TelemetryStage,
  type InterviewMetrics,
} from '../../contracts/telemetry';
import { atomicJson, TelemetryQueue, telemetryQueueFile } from './queue';

import { boundedJson } from '../boundedJson';
import {
  TelemetryProofs,
  type TelemetryProofVault,
  type TelemetryIdentityProvider,
} from './identity';
import { receiptIds, retryAfter, telemetryRoute, validCapabilities } from './protocol';
export { telemetryRoute } from './protocol';
type AnswerOutcome = 'success' | 'failure' | 'cancelled';
type AnswerMetric = { first(): void; finish(outcome: AnswerOutcome): void };
type Interview = {
  metrics: InterviewMetrics;
  identity: TelemetryIdentity;
  running: boolean;
  at: number;
  saved?: boolean;
  lastStage?: TelemetryStage;
  seen: Set<string>;
};
export class Telemetry {
  private queue: TelemetryQueue;
  private installation = { installationId: randomUUID() as string, firstSeenAt: 0, sequence: 0 };
  private identity: TelemetryIdentity = { accountMode: 'signed_out' };
  private readonly runId = randomUUID();
  private ready: Promise<void>;
  private enabled: boolean;
  private entered = new Set<string>();
  private features = new Map<string, number>();
  private appReady = false;
  private interview?: Interview;
  private suspended = false;
  private timer?: ReturnType<typeof setInterval>;
  private saving?: ReturnType<typeof setTimeout>;
  private upload?: Promise<void>;
  private controller?: AbortController;
  private proofs?: TelemetryProofs;
  private pendingRecords = new Set<Promise<void>>();
  private stopping = false;
  private capabilities = false;
  private negotiation?: Promise<void>;
  private transmissionSave?: Promise<void>;
  private negotiationController?: AbortController;
  private negotiateAt = 0;
  private pendingAnswers = new Map<AnswerMetric, string | undefined>();
  private closed = false;
  constructor(
    private options: {
      root: string;
      version: string;
      platform: 'macos' | 'windows';
      origin?: string;
      enabled?: boolean;
      fetcher?: typeof fetch;
      proofVault?: TelemetryProofVault;
      identityProvider?: TelemetryIdentityProvider;
      now?: () => number;
      monotonic?: () => number;
    },
  ) {
    this.enabled = options.enabled !== false;
    this.queue = new TelemetryQueue(path.join(options.root, telemetryQueueFile));
    this.ready = this.initialize().catch(() => {
      this.enabled = false;
    });
  }
  private now() {
    return Math.max(0, Math.floor((this.options.now ?? Date.now)()));
  }
  private mono() {
    return (this.options.monotonic ?? (() => performance.now()))();
  }
  private async initialize() {
    if (!this.enabled) return;
    const file = path.join(this.options.root, 'telemetry-installation.json');
    this.installation.firstSeenAt = this.now();
    try {
      if ((await stat(file)).size > 1024) throw Error('Invalid installation');
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (
        !telemetryUuid(saved.installationId) ||
        !telemetryTimestamp(saved.firstSeenAt) ||
        (saved.sequence !== undefined &&
          (!Number.isSafeInteger(saved.sequence) || saved.sequence < 0))
      )
        throw Error('Invalid installation');
      this.installation = {
        installationId: saved.installationId,
        firstSeenAt: saved.firstSeenAt,
        sequence: saved.sequence ?? 0,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await atomicJson(file, this.installation);
    }
    await this.queue.load(this.now());
    this.installation.sequence = Math.max(this.installation.sequence, this.queue.sequence);
    this.proofs = new TelemetryProofs({
      installationId: this.installation.installationId,
      origin: this.options.origin ?? '',
      vault: this.options.proofVault,
      now: () => this.now(),
      provider: this.options.identityProvider
        ? async (installationId, userId, signal) => {
            await this.negotiate();
            if (signal.aborted) throw Error('Closed');
            return this.options.identityProvider!(installationId, userId, signal);
          }
        : undefined,
    });
    await this.proofs.load();
    const before = this.queue.events.length;
    this.queue.events = this.queue.events.filter(
      (e) => e.installationId === this.installation.installationId,
    );
    this.queue.drop(before - this.queue.events.length);
    if (this.queue.active?.installationId !== this.installation.installationId)
      this.queue.active = undefined;
    // A checkpoint never includes time while the application was not running.
    const previous = this.queue.active;
    if (previous?.data.type === 'interview_progress') {
      if (
        previous.data.sequence < Number.MAX_SAFE_INTEGER &&
        (previous.accountMode !== 'account' ||
          this.proofs.proof(previous.identityRef!, previous.occurredAt))
      )
        this.queue.add({
          ...previous,
          id: randomUUID(),
          data: {
            ...previous.data,
            type: 'interview_ended',
            sequence: previous.data.sequence + 1,
            outcome: previous.data.startedAt === null ? 'failed' : 'interrupted',
            stage: 'process',
          },
        });
      else {
        this.queue.drop();
        this.queue.lastFailure = 'checkpoint_unverifiable';
      }
      this.queue.active = undefined;
      await this.queue.save();
    }
    this.timer = setInterval(() => {
      if (this.interview) this.checkpoint();
      void this.flush();
    }, 30000);
    this.timer.unref();
  }
  setIdentity(identity: TelemetryIdentity, fresh = false) {
    this.identity =
      identity.accountMode === 'account' && telemetryUuid(identity.userId)
        ? { accountMode: 'account', userId: identity.userId }
        : { accountMode: identity.accountMode === 'local' ? 'local' : 'signed_out' };
    const userId = this.identity.userId;
    if (userId && this.enabled && !this.closed && !this.stopping)
      void this.ready.then(() => this.proofs?.warm(userId, fresh)).catch(() => {});
  }
  private record(data: TelemetryData, identity = this.identity, checkpoint?: Interview) {
    if (!this.enabled || this.closed || this.stopping) return;
    if (this.pendingRecords.size >= 2000) {
      this.queue.drop();
      return;
    }
    const subject = { ...identity };
    const occurredAt = this.now();
    const work = this.ready
      .then(async () => {
        if (!this.enabled || this.closed) return;
        const identityRef =
          subject.accountMode === 'account'
            ? await this.proofs?.reference(subject.userId!, occurredAt, this.identity.userId)
            : undefined;
        if (subject.accountMode === 'account' && !identityRef) {
          this.queue.lastFailure = 'identity_unverifiable';
          this.queue.drop();
          this.persistSoon();
          return;
        }
        const event: TelemetryEvent = {
          schemaVersion: 2,
          id: randomUUID(),
          installationId: this.installation.installationId,
          firstSeenAt: this.installation.firstSeenAt,
          runId: this.runId,
          occurredAt,
          version: this.options.version,
          platform: this.options.platform,
          accountMode: subject.accountMode,
          ...(identityRef ? { identityRef } : {}),
          data,
        };
        if (!validTelemetryEvent(event)) {
          this.queue.drop();
          this.queue.lastFailure = 'invalid_local_event';
        } else {
          this.queue.add(event);
          if (
            checkpoint &&
            this.interview === checkpoint &&
            event.data.type === 'interview_progress' &&
            (this.queue.active?.data.type !== 'interview_progress' ||
              this.queue.active.data.sequence < event.data.sequence)
          )
            this.queue.active = event;
        }
        this.persistSoon();
      })
      .catch(() => {
        this.queue.drop();
        this.queue.lastFailure = 'storage_unavailable';
      })
      .finally(() => this.pendingRecords.delete(work));
    this.pendingRecords.add(work);
  }
  private persistSoon() {
    if (this.saving) return;
    this.saving = setTimeout(() => {
      this.saving = undefined;
      void this.queue.save().catch(() => {});
    }, 250);
    this.saving.unref();
  }
  usable() {
    if (this.appReady) return;
    this.appReady = true;
    this.record({ type: 'app_ready' });
    void this.ready.then(() => this.flush()).catch(() => {});
  }
  entry(method: 'login' | 'register' | 'restore' | 'local', userCreatedAt?: number) {
    const key = `${method}:${this.identity.userId ?? this.identity.accountMode}`;
    if (this.entered.has(key)) return;
    this.entered.add(key);
    this.record({
      type: 'account_entry',
      method,
      ...(Number.isSafeInteger(userCreatedAt) && userCreatedAt! >= 0 ? { userCreatedAt } : {}),
    });
  }
  activity(feature: TelemetryFeature) {
    const key = `${this.identity.userId ?? this.identity.accountMode}:${feature}`;
    const now = this.now();
    const last = this.features.get(key);
    // Preserve minute boundaries, including midnight in the backend's reporting timezone.
    if (
      last !== undefined &&
      now >= last &&
      now - last < 30000 &&
      Math.floor(last / 60000) === Math.floor(now / 60000)
    )
      return;
    if (this.features.size >= 100) this.features.clear();
    this.features.set(key, now);
    this.record({ type: 'feature', feature });
  }
  beginInterview() {
    if (this.interview) return;
    const metrics: InterviewMetrics = {
      interviewId: randomUUID(),
      startedAt: null,
      activeMs: 0,
      transcriptCount: 0,
      manualQuestionCount: 0,
      answerCount: 0,
      effective: false,
      sequence: 0,
    };
    this.interview = {
      metrics,
      identity: { ...this.identity },
      running: false,
      at: this.mono(),
      seen: new Set(),
    };
    this.activity('interview');
    this.record({ type: 'interview_attempt', interviewId: metrics.interviewId });
    this.checkpoint();
  }
  private accrue() {
    const i = this.interview;
    if (!i) return;
    const at = this.mono();
    if (i.running && !this.suspended) i.metrics.activeMs += Math.max(0, Math.floor(at - i.at));
    i.at = at;
    i.metrics.effective =
      i.metrics.activeMs >= 120000 &&
      (i.metrics.transcriptCount >= 3 ||
        i.metrics.manualQuestionCount >= 1 ||
        i.metrics.answerCount >= 1);
  }
  speechState(state: string) {
    const i = this.interview;
    if (!i) return;
    if (state === 'error') i.lastStage = 'audio';
    if (state === 'running') i.lastStage = undefined;
    if (
      i.running === (state === 'running') &&
      (state !== 'running' || i.metrics.startedAt !== null)
    )
      return;
    this.accrue();
    i.running = state === 'running';
    if (i.running && i.metrics.startedAt === null) {
      i.metrics.startedAt = this.now();
      this.record(
        {
          type: 'interview_started',
          interviewId: i.metrics.interviewId,
          startedAt: i.metrics.startedAt,
        },
        i.identity,
      );
    }
    this.checkpoint();
  }
  audioFailed() {
    this.speechState('error');
    if (this.interview?.metrics.startedAt === null) this.finishInterview(false, 'audio');
  }
  suspend(suspended: boolean) {
    this.accrue();
    this.suspended = suspended;
    this.checkpoint();
  }
  transcript(id: string) {
    const i = this.interview;
    if (!i || i.metrics.startedAt === null || i.seen.has(id) || i.seen.size >= 5000) return;
    i.seen.add(id);
    i.metrics.transcriptCount++;
  }
  manualQuestion() {
    if (this.interview?.metrics.startedAt !== null && this.interview)
      this.interview.metrics.manualQuestionCount++;
  }
  saved(saved: boolean) {
    if (this.interview) this.interview.saved = saved;
  }
  private checkpoint() {
    this.accrue();
    const i = this.interview;
    if (!i || !this.enabled || this.closed) return;
    const data = {
      type: 'interview_progress' as const,
      ...i.metrics,
      sequence: ++i.metrics.sequence,
    };
    this.record(data, i.identity, i);
  }
  finishInterview(normal: boolean, stage?: TelemetryStage) {
    this.accrue();
    const i = this.interview;
    if (!i) return;
    const completed = normal && i.saved === true && i.metrics.startedAt !== null;
    const outcome = completed
      ? 'completed'
      : i.metrics.startedAt === null || i.saved === false || (normal && !i.saved)
        ? 'failed'
        : 'interrupted';
    this.record(
      {
        type: 'interview_ended',
        ...i.metrics,
        sequence: ++i.metrics.sequence,
        outcome,
        ...(!completed
          ? {
              stage:
                i.saved === false
                  ? 'storage'
                  : (i.lastStage ??
                    stage ??
                    (i.metrics.startedAt === null ? 'audio' : normal ? 'storage' : 'process')),
            }
          : {}),
      },
      i.identity,
    );
    this.interview = undefined;
    void this.ready
      .then(() => {
        this.queue.active = undefined;
        this.persistSoon();
      })
      .catch(() => {});
  }
  answer(context: 'chat' | 'interview'): AnswerMetric {
    if (!this.enabled || this.closed) return { first() {}, finish() {} };
    const started = this.mono();
    const identity = { ...this.identity };
    const i = context === 'interview' ? this.interview : undefined;
    let firstAnswerMs: number | undefined;
    let finished = false;
    const metric: AnswerMetric = {
      first: () => {
        if (!finished && firstAnswerMs === undefined)
          firstAnswerMs = Math.max(0, Math.floor(this.mono() - started));
      },
      finish: (outcome) => {
        if (finished) return;
        finished = true;
        this.pendingAnswers.delete(metric);
        if (i && this.interview === i && outcome === 'success') i.metrics.answerCount++;
        this.record(
          {
            type: 'ai_request',
            requestId: randomUUID(),
            context,
            outcome,
            ...(i ? { interviewId: i.metrics.interviewId } : {}),
            elapsedMs: Math.max(0, Math.floor(this.mono() - started)),
            ...(firstAnswerMs === undefined ? {} : { firstAnswerMs }),
          },
          identity,
        );
      },
    };
    this.pendingAnswers.set(metric, identity.userId);
    return metric;
  }
  async flush() {
    await this.ready;
    await Promise.all([...this.pendingRecords]);
    if (
      !this.enabled ||
      this.closed ||
      this.stopping ||
      !this.options.origin ||
      this.upload ||
      this.now() < this.queue.nextAttemptAt
    )
      return this.upload;
    this.upload = this.send()
      .catch(() => {})
      .finally(() => {
        this.upload = undefined;
      });
    return this.upload;
  }
  private async negotiate() {
    if (this.capabilities) return;
    if (this.closed || this.now() < this.negotiateAt) throw Error('Protocol unavailable');
    if (this.negotiation) return this.negotiation;
    const controller = new AbortController();
    this.negotiationController = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    timeout.unref();
    this.negotiation = (async () => {
      const response = await (this.options.fetcher ?? fetch)(
        this.options.origin + '/v2/telemetry/capabilities',
        {
          method: 'GET',
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        const delay = [404, 405, 501].includes(response.status)
          ? 86400000
          : Math.max(60000, retryAfter(response, this.now()));
        this.negotiateAt = this.now() + delay;
        throw Error('Protocol unavailable');
      }
      if (!validCapabilities(await boundedJson(response))) {
        this.negotiateAt = this.now() + 86400000;
        throw Error('Unsupported protocol');
      }
      if (controller.signal.aborted || this.closed) throw Error('Closed');
      this.capabilities = true;
    })().finally(() => {
      clearTimeout(timeout);
      this.negotiation = undefined;
      if (this.negotiationController === controller) this.negotiationController = undefined;
    });
    return this.negotiation;
  }
  private async send() {
    this.queue.prune(this.now());
    const wire: TelemetryWireEvent[] = [];
    const events: TelemetryEvent[] = [];
    const unusable = new Set<string>();
    let bytes = 2048; // Bound the full envelope, including a maximum-size health snapshot.
    for (const event of this.queue.events) {
      const { identityRef, ...publicEvent } = event;
      const proof = identityRef && this.proofs?.proof(identityRef, event.occurredAt);
      if (event.accountMode === 'account' && !proof) {
        unusable.add(event.id);
        continue;
      }
      const item = { ...publicEvent, ...(proof ? { identityProof: proof } : {}) };
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (events.length >= 50 || bytes + size > 131072) break;
      bytes += size;
      wire.push(item);
      events.push(event);
    }
    if (unusable.size) {
      this.queue.events = this.queue.events.filter((e) => !unusable.has(e.id));
      this.queue.drop(unusable.size);
      this.queue.lastFailure = 'identity_unverifiable';
    }
    if (!events.length && !this.queue.healthPending) return;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    timeout.unref();
    let retryMs = 60000;
    try {
      await this.negotiate();
      if (this.closed || this.stopping || controller.signal.aborted) return;
      if (
        this.installation.sequence >= Number.MAX_SAFE_INTEGER ||
        this.queue.attempts >= Number.MAX_SAFE_INTEGER
      ) {
        this.enabled = false;
        this.queue.lastFailure = 'counter_exhausted';
        return;
      }
      this.queue.sequence = ++this.installation.sequence;
      this.queue.attempts++;
      this.queue.healthPending = true;
      this.transmissionSave = (async () => {
        await atomicJson(
          path.join(this.options.root, 'telemetry-installation.json'),
          this.installation,
        );
        await this.queue.save(); // Both identities and health sequence are durable before transmission.
      })();
      await this.transmissionSave;
      if (this.closed || this.stopping || controller.signal.aborted) return;
      const body = JSON.stringify({
        schemaVersion: 2,
        installationId: this.installation.installationId,
        runId: this.runId,
        sentAt: this.now(),
        events: wire,
        health: {
          counterId: this.queue.counterId,
          sequence: this.queue.sequence,
          attempts: this.queue.attempts,
          failures: this.queue.failures,
          pendingEvents: this.queue.events.length,
          oldestPendingAt: this.queue.events.length
            ? Math.min(...this.queue.events.map((e) => e.occurredAt))
            : null,
          droppedEvents: this.queue.dropped,
        },
      });
      if (Buffer.byteLength(body) > 131072) throw Error('Body limit');
      const response = await (this.options.fetcher ?? fetch)(this.options.origin + telemetryRoute, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body,
      });
      retryMs = Math.max(retryMs, retryAfter(response, this.now()));
      if ([400, 404, 405, 413, 415, 422, 501].includes(response.status)) retryMs = 86400000;
      if (!response.ok) {
        this.queue.lastFailure = 'http_' + response.status;
        await response.body?.cancel();
        throw Error('Unavailable');
      }
      const { accepted, rejected } = receiptIds(await boundedJson(response), events);
      if (this.closed || this.stopping) return;
      const present = new Set(this.queue.events.map((e) => e.id));
      this.queue.events = this.queue.events.filter(
        (e) => !accepted.has(e.id) && !rejected.has(e.id),
      );
      this.queue.drop([...rejected].filter((id) => present.has(id)).length);
      this.queue.healthPending = events.length > 0;
      this.queue.lastFailure = rejected.size ? 'event_rejected' : undefined;
      this.queue.retryFailures = 0;
      this.queue.nextAttemptAt = this.now() + 30000;
      const references = new Set(
        this.queue.events.flatMap((e) => (e.identityRef ? [e.identityRef] : [])),
      );
      if (this.queue.active?.identityRef) references.add(this.queue.active.identityRef);
      const users = new Set([...this.pendingAnswers.values()].filter((id): id is string => !!id));
      if (this.identity.userId) users.add(this.identity.userId);
      if (this.interview?.identity.userId) users.add(this.interview.identity.userId);
      if (!this.pendingRecords.size) await this.proofs?.prune(references, users);
    } catch {
      if (!this.closed && !this.stopping) {
        this.queue.failures = Math.min(this.queue.attempts, this.queue.failures + 1);
        const failures = (this.queue.retryFailures = Math.min(this.queue.retryFailures + 1, 6));
        const backoff = Math.min(3600000, 60000 * 2 ** failures) * (0.8 + Math.random() * 0.4);
        this.queue.nextAttemptAt = Math.max(
          this.negotiateAt,
          this.now() + Math.max(retryMs, Math.floor(backoff)),
        );
        this.queue.lastFailure ??= 'transport_unavailable';
      }
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = undefined;
      if (!this.closed) await this.queue.save().catch(() => {});
    }
  }
  /** Flush disk only; shutdown never waits for the network. */
  async settle() {
    await this.ready;
    if (!this.enabled || this.closed) return;
    await Promise.all([...this.pendingRecords]);
    clearTimeout(this.saving);
    this.saving = undefined;
    await this.queue.save();
  }
  async close() {
    if (this.closed) return;
    for (const metric of this.pendingAnswers.keys()) metric.finish('cancelled');
    this.finishInterview(false);
    this.stopping = true;
    this.negotiationController?.abort();
    this.controller?.abort();
    await this.ready;
    await this.proofs?.close();
    await Promise.all([...this.pendingRecords]);
    await this.transmissionSave?.catch(() => {});
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.saving);
    this.saving = undefined;
    this.controller?.abort();
    if (this.enabled) await this.queue.save().catch(() => {});
  }
}
