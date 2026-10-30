import { randomUUID } from 'node:crypto';
import { telemetryTimestamp, telemetryUuid } from '../../contracts/telemetry';

const ttl = 30 * 86400000;
interface Ticket {
  id: string;
  userId: string;
  identityProof: string;
  issuedAt: number;
  eventUntil: number;
  deliverUntil: number;
}
export interface TelemetryProofState {
  schemaVersion: 2;
  origin: string;
  installationId: string;
  tickets: Ticket[];
}
export interface TelemetryProofVault {
  read(): Promise<unknown>;
  write(value: TelemetryProofState): Promise<void>;
}
export type TelemetryIdentityProvider = (
  installationId: string,
  userId: string,
  signal: AbortSignal,
) => Promise<unknown>;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
/** HTTPS authenticates the issuer; only the server verifies the HMAC. Validate all local bindings. */
function ticket(
  value: unknown,
  installationId: string,
  userId: string,
  id: string = randomUUID(),
): Ticket {
  if (
    !object(value) ||
    typeof value.identityProof !== 'string' ||
    value.identityProof.length > 1024 ||
    ![value.issuedAt, value.eventUntil, value.deliverUntil].every(telemetryTimestamp)
  )
    throw Error('Invalid proof');
  const { identityProof, issuedAt, eventUntil, deliverUntil } = value as unknown as Ticket;
  const parts = identityProof.split('.');
  if (
    parts.length !== 3 ||
    !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)) ||
    parts[2].length !== 43
  )
    throw Error('Invalid proof');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (
    !object(header) ||
    Object.keys(header).sort().join(',') !== 'alg,typ' ||
    header.alg !== 'HS256' ||
    header.typ !== 'voxcue-telemetry+jwt' ||
    !object(payload) ||
    Object.keys(payload).sort().join(',') !== 'aud,eventUntil,exp,iat,installationId,iss,nbf,sub' ||
    payload.iss !== 'voxcue-account-server' ||
    payload.aud !== 'voxcue:telemetry-attribution:v2' ||
    payload.sub !== userId ||
    !telemetryUuid(userId) ||
    payload.installationId !== installationId ||
    ![payload.iat, payload.nbf, payload.exp].every(Number.isSafeInteger) ||
    payload.iat !== issuedAt / 1000 ||
    payload.nbf !== (payload.iat as number) - 300 ||
    payload.exp !== deliverUntil / 1000 ||
    payload.eventUntil !== eventUntil ||
    eventUntil < issuedAt ||
    eventUntil > issuedAt + ttl ||
    deliverUntil !== eventUntil + ttl
  )
    throw Error('Invalid proof');
  return { id, userId, identityProof, issuedAt, eventUntil, deliverUntil };
}
export class TelemetryProofs {
  private tickets: Ticket[] = [];
  private available = false;
  private pending?: { userId: string; work: Promise<void> };
  private controller?: AbortController;
  private writing: Promise<void> = Promise.resolve();
  private retryAt = 0;
  private retryUser?: string;
  private closed = false;
  constructor(
    private options: {
      installationId: string;
      origin: string;
      vault?: TelemetryProofVault;
      provider?: TelemetryIdentityProvider;
      now(): number;
    },
  ) {}
  async load() {
    if (!this.options.vault) return;
    try {
      const value = await this.options.vault.read();
      if (value !== null && value !== undefined) {
        if (
          !object(value) ||
          value.schemaVersion !== 2 ||
          value.origin !== this.options.origin ||
          value.installationId !== this.options.installationId ||
          !Array.isArray(value.tickets) ||
          value.tickets.length > 128
        )
          throw Error('Invalid proof storage');
        this.tickets = value.tickets.map((v) => {
          if (!object(v) || !telemetryUuid(v.id) || !telemetryUuid(v.userId))
            throw Error('Invalid proof storage');
          return ticket(v, this.options.installationId, v.userId, v.id);
        });
        if (new Set(this.tickets.map((t) => t.id)).size !== this.tickets.length)
          throw Error('Invalid proof storage');
      }
      this.available = true;
    } catch {
      /* Fail closed for account attribution; anonymous collection is independent. */
    }
  }
  private persist(next: Ticket[]) {
    const work = this.writing.then(async () => {
      if (this.closed) return;
      await this.options.vault!.write({
        schemaVersion: 2,
        origin: this.options.origin,
        installationId: this.options.installationId,
        tickets: next,
      });
      this.tickets = next;
    });
    this.writing = work.catch(() => {});
    return work;
  }
  covers(t: Ticket, at: number) {
    return at >= t.issuedAt - 300000 && at <= t.eventUntil && this.options.now() < t.deliverUntil;
  }
  find(userId: string, at: number) {
    for (let i = this.tickets.length - 1; i >= 0; i--)
      if (this.tickets[i].userId === userId && this.covers(this.tickets[i], at))
        return this.tickets[i];
  }
  proof(ref: string, at: number) {
    const t = this.tickets.find((t) => t.id === ref);
    return t && this.covers(t, at) ? t.identityProof : undefined;
  }
  async warm(userId: string, force = false) {
    if (!this.available || this.closed || !this.options.provider) return;
    if (!force && this.find(userId, this.options.now() + 60000)) return;
    if (this.pending) {
      const sameUser = this.pending.userId === userId;
      await this.pending.work;
      if (!sameUser && !this.closed) await this.warm(userId, force);
      return;
    }
    if (!force && this.retryUser === userId && this.options.now() < this.retryAt) return;
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    timer.unref();
    const work = (async () => {
      try {
        const cancelled = new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(Error('Aborted')), {
            once: true,
          }),
        );
        const raw = await Promise.race([
          this.options.provider!(this.options.installationId, userId, controller.signal),
          cancelled,
        ]);
        if (this.closed || controller.signal.aborted || !object(raw) || raw.schemaVersion !== 2)
          return;
        const next = ticket(raw, this.options.installationId, userId);
        if (!this.covers(next, this.options.now())) throw Error('Expired proof');
        const retained = this.tickets.filter((t) => t.deliverUntil > this.options.now());
        if (retained.length >= 128) throw Error('Proof capacity');
        await this.persist([...retained, next]); // Durable before any normal-queue reference is published.
      } catch {
        /* Attribution is optional; never mutate the cloud session. */
      } finally {
        this.retryUser = userId;
        this.retryAt = this.options.now() + 60000;
        clearTimeout(timer);
        if (this.controller === controller) this.controller = undefined;
      }
    })();
    this.pending = { userId, work };
    try {
      await work;
    } finally {
      if (this.pending?.work === work) this.pending = undefined;
    }
  }
  async reference(userId: string, at: number, currentUserId?: string) {
    let found = this.find(userId, at);
    if (!found && currentUserId === userId) await this.warm(userId);
    else if (!found && this.pending?.userId === userId) await this.pending.work;
    found = this.find(userId, at);
    return found?.id;
  }
  async prune(references: Set<string>, users: Set<string>) {
    if (!this.available || this.closed || this.pending) return;
    const latest = new Set([...users].map((userId) => this.find(userId, this.options.now())));
    const next = this.tickets.filter(
      (t) => t.deliverUntil > this.options.now() && (references.has(t.id) || latest.has(t)),
    );
    if (next.length !== this.tickets.length) await this.persist(next);
  }
  async close() {
    this.closed = true;
    this.controller?.abort();
    await this.writing;
  }
}
