import { readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { telemetryUuid, validTelemetryEvent, type TelemetryEvent } from '../../contracts/telemetry';

export const telemetryQueueFile = 'telemetry-queue.json';
export const queueLimit = 2000;
export const queueMaxAge = 30 * 86400000;
export async function atomicJson(file: string, value: unknown) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
export class TelemetryQueue {
  events: TelemetryEvent[] = [];
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
      if ((await stat(this.file)).size > 4 * 1024 * 1024) return;
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved?.schemaVersion !== 1 || !Array.isArray(saved.events)) return;
      this.events = saved.events.filter(validTelemetryEvent).slice(-queueLimit);
      if (telemetryUuid(saved.counterId)) this.counterId = saved.counterId;
      for (const key of [
        'attempts',
        'failures',
        'dropped',
        'nextAttemptAt',
        'retryFailures',
      ] as const)
        if (Number.isSafeInteger(saved[key]) && saved[key] >= 0) this[key] = saved[key];
      if (validTelemetryEvent(saved.active) && saved.active.data.type === 'interview_progress')
        this.active = saved.active;
      this.nextAttemptAt = Math.min(this.nextAttemptAt, now + 86400000);
      this.prune(now);
    } catch {
      /* Missing/corrupt statistics must never prevent entry. */
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
      this.dropped++;
    }
  }
  prune(now: number) {
    const retained = this.events.filter(
      (e) => e.occurredAt >= now - queueMaxAge && e.occurredAt <= now + 86400000,
    );
    this.dropped += this.events.length - retained.length;
    this.events = retained;
  }
  save() {
    this.dirty = true;
    if (!this.writing) {
      this.writing = (async () => {
        try {
          while (this.dirty) {
            this.dirty = false;
            await atomicJson(this.file, {
              schemaVersion: 1,
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
