import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicFile } from '../atomicFile';
import { telemetryUuid, validTelemetryEvent, type TelemetryEvent } from '../../contracts/telemetry';

export const telemetryQueueFile = 'telemetry-queue.json';
export const queueLimit = 2000;
export const queueMaxAge = 30 * 86400000;
export async function atomicJson(file: string, value: unknown) {
  await atomicFile(file, JSON.stringify(value));
}

export class TelemetryQueue {
  events: TelemetryEvent[] = [];
  sequence = 0;
  healthPending = false;
  lastFailure?: string;
  attempts = 0;
  failures = 0;
  dropped = 0;
  nextAttemptAt = 0;
  retryFailures = 0;
  counterId = randomUUID() as string;
  active?: TelemetryEvent;
  private writing?: Promise<void>;
  private dirty = false;
  constructor(private file: string) {}
  async load(now: number) {
    try {
      if ((await stat(this.file)).size > 4 * 1024 * 1024) throw Error('Invalid telemetry queue');
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (![1, 2].includes(saved?.schemaVersion) || !Array.isArray(saved.events))
        throw Error('Invalid telemetry queue');
      const convert = (event: unknown) => {
        if (saved.schemaVersion === 2) return validTelemetryEvent(event) ? event : undefined;
        if (!event || typeof event !== 'object' || Array.isArray(event)) return;
        const old = event as Record<string, unknown>;
        if (old.schemaVersion !== 1 || old.accountMode === 'account' || 'userId' in old) return;
        const next = { ...old, schemaVersion: 2 };
        return validTelemetryEvent(next) ? next : undefined;
      };
      this.events = saved.events
        .map(convert)
        .filter((e: TelemetryEvent | undefined): e is TelemetryEvent => !!e);
      const discarded = saved.events.length - Math.min(this.events.length, queueLimit);
      this.events = this.events.slice(-queueLimit);
      if (telemetryUuid(saved.counterId)) this.counterId = saved.counterId;
      for (const key of [
        'sequence',
        'attempts',
        'failures',
        'dropped',
        'nextAttemptAt',
        'retryFailures',
      ] as const)
        if (Number.isSafeInteger(saved[key]) && saved[key] >= 0) this[key] = saved[key];
      this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + discarded);
      this.failures = Math.min(this.failures, this.attempts);
      this.healthPending = saved.healthPending === true || discarded > 0;
      if (discarded)
        this.lastFailure =
          saved.schemaVersion === 1 ? 'legacy_unverifiable' : 'invalid_queue_event';
      const active = convert(saved.active);
      if (active?.data.type === 'interview_progress') this.active = active;
      this.nextAttemptAt = Math.min(this.nextAttemptAt, now + 86400000);
      this.prune(now);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  add(event: TelemetryEvent) {
    this.prune(event.occurredAt);
    this.events.push(event);
    while (this.events.length > queueLimit) {
      const expendable = this.events.findIndex((e) =>
        ['feature', 'interview_progress'].includes(e.data.type),
      );
      this.events.splice(expendable < 0 ? 0 : expendable, 1);
      this.drop();
    }
  }
  prune(now: number) {
    const retained = this.events.filter(
      (e) => e.occurredAt >= now - queueMaxAge && e.occurredAt <= now + 86400000,
    );
    this.drop(this.events.length - retained.length);
    this.events = retained;
  }
  drop(count = 1) {
    if (count <= 0) return;
    this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + count);
    this.healthPending = true;
  }
  save() {
    this.dirty = true;
    if (!this.writing) {
      this.writing = (async () => {
        try {
          while (this.dirty) {
            this.dirty = false;
            await atomicJson(this.file, {
              schemaVersion: 2,
              sequence: this.sequence,
              healthPending: this.healthPending,
              lastFailure: this.lastFailure,
              events: [...this.events],
              attempts: this.attempts,
              failures: this.failures,
              dropped: this.dropped,
              nextAttemptAt: this.nextAttemptAt,
              retryFailures: this.retryFailures,
              counterId: this.counterId,
              active: this.active,
            });
          }
        } finally {
          this.writing = undefined;
        }
      })();
    }
    return this.writing;
  }
}
