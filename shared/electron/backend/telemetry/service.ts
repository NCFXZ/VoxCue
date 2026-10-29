import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  telemetryUuid,
  validTelemetryEvent,
  type TelemetryData,
  type TelemetryEvent,
  type TelemetryIdentity,
  type TelemetryFeature,
  type TelemetryStage,
  type InterviewMetrics,
} from '../../contracts/telemetry';
import { atomicJson, TelemetryQueue, telemetryQueueFile } from './queue';

export const telemetryRoute = '/v1/telemetry/events';
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
  private installation = { installationId: randomUUID() as string, firstSeenAt: 0 };
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
  private healthPending = false;
  private pendingAnswers = new Set<AnswerMetric>();
  private closed = false;
  constructor(
    private options: {
      root: string;
      version: string;
      platform: 'macos' | 'windows';
      origin?: string;
      enabled?: boolean;
      fetcher?: typeof fetch;
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
        !Number.isSafeInteger(saved.firstSeenAt) ||
        saved.firstSeenAt < 0
      )
        throw Error('Invalid installation');
      this.installation = { installationId: saved.installationId, firstSeenAt: saved.firstSeenAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await atomicJson(file, this.installation);
    }
    await this.queue.load(this.now());
    this.queue.events = this.queue.events.filter(
      (e) => e.installationId === this.installation.installationId,
    );
    if (this.queue.active?.installationId !== this.installation.installationId)
      this.queue.active = undefined;
    // A checkpoint never includes time while the application was not running.
    const previous = this.queue.active;
    if (previous?.data.type === 'interview_progress') {
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
      this.queue.active = undefined;
      await this.queue.save();
    }
    this.timer = setInterval(() => {
      if (this.interview) this.checkpoint();
      void this.flush();
    }, 30000);
    this.timer.unref();
  }
  setIdentity(identity: TelemetryIdentity) {
    this.identity =
      identity.accountMode === 'account' && telemetryUuid(identity.userId)
        ? { accountMode: 'account', userId: identity.userId }
        : { accountMode: identity.accountMode === 'local' ? 'local' : 'signed_out' };
  }
  private event(data: TelemetryData, identity = this.identity): TelemetryEvent {
    return {
      schemaVersion: 1,
      id: randomUUID(),
      ...this.installation,
      runId: this.runId,
      occurredAt: this.now(),
      version: this.options.version,
      platform: this.options.platform,
      ...identity,
      data,
    };
  }
  private record(data: TelemetryData, identity = this.identity) {
    if (!this.enabled || this.closed) return;
    const subject = { ...identity };
    const occurredAt = this.now();
    void this.ready
      .then(() => {
        if (!this.enabled || this.closed) return;
        const event = { ...this.event(data, subject), occurredAt };
        if (!validTelemetryEvent(event)) return;
        this.queue.add(event);
        this.persistSoon();
      })
      .catch(() => {});
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
    this.record(data, i.identity);
    void this.ready
      .then(() => {
        if (this.enabled && !this.closed && this.interview === i) {
          this.queue.active = this.event(data, i.identity);
          this.persistSoon();
        }
      })
      .catch(() => {});
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
    this.pendingAnswers.add(metric);
    return metric;
  }
  async flush() {
    await this.ready;
    if (
      !this.enabled ||
      this.closed ||
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
  private async send() {
    this.queue.prune(this.now());
    const events = this.queue.events.slice(0, 50);
    if (!events.length && !this.healthPending) return;
    this.queue.attempts++;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    timeout.unref();
    let retryMs = 60000;
    try {
      await this.queue.save();
      const response = await (this.options.fetcher ?? fetch)(this.options.origin + telemetryRoute, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          installationId: this.installation.installationId,
          runId: this.runId,
          sentAt: this.now(),
          events,
          health: {
            counterId: this.queue.counterId,
            attempts: this.queue.attempts,
            failures: this.queue.failures,
            pendingEvents: this.queue.events.length,
            oldestPendingAt: this.queue.events.length
              ? Math.min(...this.queue.events.map((e) => e.occurredAt))
              : null,
            droppedEvents: this.queue.dropped,
          },
        }),
      });
      if ([404, 405, 501].includes(response.status)) retryMs = 86400000;
      const retry = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retry) && retry > 0)
        retryMs = Math.max(retryMs, Math.min(retry * 1000, 86400000));
      if (!response.ok) {
        await response.body?.cancel();
        throw Error('Unavailable');
      }
      const reader = response.body?.getReader();
      if (!reader) throw Error('Missing acknowledgement');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 16384) throw Error('Oversized acknowledgement');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const sent = new Set(events.map((e) => e.id));
      if (
        result?.schemaVersion !== 1 ||
        !Array.isArray(result.acceptedIds) ||
        (events.length > 0 && !result.acceptedIds.length) ||
        result.acceptedIds.length > events.length ||
        new Set(result.acceptedIds).size !== result.acceptedIds.length ||
        !result.acceptedIds.every((id: unknown) => typeof id === 'string' && sent.has(id))
      )
        throw Error('Invalid acknowledgement');
      const accepted = new Set(result.acceptedIds);
      this.queue.events = this.queue.events.filter((e) => !accepted.has(e.id));
      this.healthPending = events.length > 0;
      this.queue.retryFailures = 0;
      this.queue.nextAttemptAt = this.now() + 30000;
    } catch {
      if (!this.closed) {
        this.queue.failures++;
        const failures = Math.min(++this.queue.retryFailures, 6);
        this.queue.nextAttemptAt =
          this.now() + Math.max(retryMs, Math.min(3600000, 60000 * 2 ** failures));
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
    clearTimeout(this.saving);
    this.saving = undefined;
    await this.queue.save();
  }
  async close() {
    if (this.closed) return;
    for (const metric of [...this.pendingAnswers]) metric.finish('cancelled');
    this.finishInterview(false);
    await this.ready;
    await Promise.resolve();
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.saving);
    this.saving = undefined;
    this.controller?.abort();
    if (this.enabled) await this.queue.save().catch(() => {});
  }
}
