import { telemetryTimestamp, type TelemetryEvent } from '../../contracts/telemetry';

export const telemetryRoute = '/v2/telemetry/events';
export const terminalRejections = [
  'invalid_event',
  'invalid_identity',
  'identity_proof_required',
  'invalid_identity_proof',
  'event_expired',
  'event_conflict_or_account_unavailable',
] as const;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function validCapabilities(v: unknown) {
  if (!object(v) || !object(v.limits)) return false;
  return (
    v.schemaVersion === 2 &&
    Array.isArray(v.versions) &&
    v.versions.includes(2) &&
    telemetryTimestamp(v.serverTime) &&
    v.anonymous === true &&
    v.accountAttribution === 'event-time-ticket' &&
    v.receipt === 'per-event-terminal-rejections' &&
    v.limits.batchEvents === 50 &&
    v.limits.bodyBytes === 131072 &&
    v.limits.pendingEvents === 2000 &&
    v.limits.eventProofTtlMs === 30 * 86400000 &&
    v.limits.deliveryTtlMs === 30 * 86400000
  );
}
/** Validate the entire receipt before removing anything. Unmentioned events remain queued. */
export function receiptIds(value: unknown, events: TelemetryEvent[]) {
  if (
    !object(value) ||
    value.schemaVersion !== 2 ||
    value.healthAccepted !== true ||
    !Array.isArray(value.acceptedIds) ||
    !Array.isArray(value.rejected) ||
    value.acceptedIds.length + value.rejected.length > events.length
  )
    throw Error('Invalid receipt');
  const sent = new Set(events.map((e) => e.id));
  const accepted = new Set<string>();
  const rejected = new Set<string>();
  for (const id of value.acceptedIds) {
    if (typeof id !== 'string' || !sent.has(id) || accepted.has(id)) throw Error('Invalid receipt');
    accepted.add(id);
  }
  for (const item of value.rejected) {
    if (
      !object(item) ||
      Object.keys(item).some((k) => !['index', 'id', 'code'].includes(k)) ||
      !Number.isInteger(item.index) ||
      (item.index as number) < 0 ||
      (item.index as number) >= events.length ||
      typeof item.code !== 'string' ||
      !(terminalRejections as readonly string[]).includes(item.code)
    )
      throw Error('Invalid receipt');
    const id = events[item.index as number].id;
    if ((item.id !== undefined && item.id !== id) || accepted.has(id) || rejected.has(id))
      throw Error('Invalid receipt');
    rejected.add(id);
  }
  return { accepted, rejected };
}
export function retryAfter(response: Response, now: number) {
  const raw = response.headers.get('retry-after');
  if (!raw) return 0;
  const delay = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(delay) ? Math.max(0, Math.min(delay, 86400000)) : 0;
}
