import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { networkInterfaces } from 'node:os';
import type { RemoteCommand } from '../../contracts/remoteConnection';

// Protocol guards shared by HTTP, WebSocket and command admission.
export const peerAddress = (address: string) => address.replace(/^::ffff:/, '');

export class RemoteRequestLimiter {
  private peers = new Map<string, { since: number; count: number }>();

  allow(address: string) {
    const now = Date.now();
    for (const [peer, window] of this.peers)
      if (now - window.since > 10_000) this.peers.delete(peer);
    const peer = peerAddress(address);
    let window = this.peers.get(peer);
    if (!window) {
      if (this.peers.size >= 128) return false;
      window = { since: now, count: 0 };
      this.peers.set(peer, window);
    }
    return ++window.count <= 60;
  }
}
export const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
export const equalSecret = (actual: unknown, expected: string) => {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  const bytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return bytes.length === expectedBytes.length && timingSafeEqual(bytes, expectedBytes);
};

export function isPrivateIPv4(address: string) {
  const value = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function selectPrivateIPv4(interfaces: ReturnType<typeof networkInterfaces>): string | null {
  const rank = (name: string) =>
    /virtual|vmware|vbox|vethernet|hyper-v|wsl|docker|vpn|tailscale|zerotier|loopback|\btun\d*\b|\btap\d*\b/i.test(
      name,
    )
      ? 2
      : /wi-?fi|wlan|wireless|无线/i.test(name)
        ? 0
        : 1;
  for (const [, entries] of Object.entries(interfaces).sort(([a], [b]) => rank(a) - rank(b))) {
    const address = entries?.find(
      (entry) => !entry.internal && entry.family === 'IPv4' && isPrivateIPv4(entry.address),
    )?.address;
    if (address) return address;
  }
  return null;
}

export function parseRemoteCommand(value: unknown): RemoteCommand | null {
  if (
    !record(value) ||
    !identifier(value.requestId) ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId ||
    value.sessionId.length > 128 ||
    !revision(value.sessionEpoch)
  )
    return null;
  const base = {
    requestId: value.requestId,
    sessionId: value.sessionId,
    sessionEpoch: value.sessionEpoch,
  };
  switch (value.action) {
    case 'set-microphone':
      return typeof value.muted === 'boolean' && revision(value.expectedRevision)
        ? {
            ...base,
            action: value.action,
            muted: value.muted,
            expectedRevision: value.expectedRevision,
          }
        : null;
    case 'set-auto-answer':
      return typeof value.enabled === 'boolean' && revision(value.expectedRevision)
        ? {
            ...base,
            action: value.action,
            enabled: value.enabled,
            expectedRevision: value.expectedRevision,
          }
        : null;
    case 'set-draft':
      return typeof value.text === 'string' &&
        value.text.length <= 6000 &&
        revision(value.expectedRevision)
        ? {
            ...base,
            action: value.action,
            text: value.text,
            expectedRevision: value.expectedRevision,
          }
        : null;
    case 'ask':
      return typeof value.text === 'string' &&
        !!value.text.trim() &&
        value.text.length <= 6000 &&
        (value.pendingQuestionRevision === undefined || revision(value.pendingQuestionRevision)) &&
        (value.inputDraftRevision === undefined || revision(value.inputDraftRevision)) &&
        (value.pendingQuestionRevision === undefined || value.inputDraftRevision === undefined)
        ? {
            ...base,
            action: value.action,
            text: value.text,
            ...(value.pendingQuestionRevision !== undefined
              ? { pendingQuestionRevision: value.pendingQuestionRevision }
              : {}),
            ...(value.inputDraftRevision !== undefined
              ? { inputDraftRevision: value.inputDraftRevision }
              : {}),
          }
        : null;
    case 'stop-answer':
      return typeof value.answerId === 'string' && !!value.answerId && value.answerId.length <= 128
        ? { ...base, action: value.action, answerId: value.answerId }
        : null;
    default:
      return null;
  }
}
