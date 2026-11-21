import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import os from 'node:os';
import type { PermissionHandler } from '@github/copilot-sdk';
import { abortable } from '../cancellable';

// Exclude special-use IPv4 ranges and exceptions within IPv6 global unicast.
// See the IANA IPv4 and IPv6 Special-Purpose Address Registries.
const special = new BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) special.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3ffe::', 16], ['3fff::', 20],
] as const) special.addSubnet(ip, bits, 'ipv6');

function publicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !special.check(address, 'ipv4');
  return family === 6 && /^[23]/.test(address) && !address.includes('%') && !special.check(address, 'ipv6');
}

function connectedNetworks() {
  const connected = new BlockList();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const { address, cidr, internal } of entries ?? []) {
      if (!publicAddress(address)) continue;
      const ipv4 = isIP(address) === 4;
      const family = ipv4 ? 'ipv4' : 'ipv6';
      connected.addAddress(address, family);
      // A default or unusually broad virtual interface mask is not evidence of an on-link LAN.
      const prefix = cidr?.startsWith(address + '/') ? cidr.slice(address.length + 1) : '';
      const bits = Number(prefix);
      if (!internal && /^\d{1,3}$/.test(prefix) && bits >= (ipv4 ? 8 : 32) && bits < (ipv4 ? 32 : 128))
        connected.addSubnet(address, bits, family);
    }
  }
  return connected;
}

// OS resolution shares Node's I/O thread pool and cannot be cancelled in flight.
// Keep the slot until lookup actually settles, including after an approval timeout.
let pendingLookups = 0;
async function publicHost(host: string) {
  if (pendingLookups >= 2) return [];
  pendingLookups++;
  try {
    const addresses = await dns.lookup(host, { all: true });
    return addresses.every(({ address }) => publicAddress(address)) ? addresses.map(({ address }) => address) : [];
  } finally {
    pendingLookups--;
  }
}

async function publicWebAddresses(value: unknown, signal: AbortSignal) {
  if (typeof value !== 'string' || value.length > 4096 || !/^https?:\/\//i.test(value) ||
      /[\\\s\x00-\x1f\x7f]/.test(value) || signal.aborted) return [];
  const url = new URL(value);
  if (url.username || url.password) return [];
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(host)) return publicAddress(host) ? [host] : [];
  if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/.test(host) ||
      !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return [];
  return abortable(publicHost(url.hostname), signal);
}

export function webPermission(enabled: boolean, session: AbortSignal): PermissionHandler {
  return (request) => {
    if (!enabled || session.aborted || request.kind !== 'url' ||
        request.managedApprovalRequired || request.requestSandboxBypass) return { kind: 'reject' };
    const signal = AbortSignal.any([session, AbortSignal.timeout(5000)]);
    // A redirect is a fresh permission request. Never cache permission by hostname.
    return (async () => {
      try {
        const addresses = await publicWebAddresses(request.url, signal);
        if (!addresses.length) return { kind: 'reject' } as const;
        if (request.redirectedFrom !== undefined) {
          const source = await publicWebAddresses(request.redirectedFrom, signal);
          if (!source.length) return { kind: 'reject' } as const;
          addresses.push(...source);
        }
        if (signal.aborted) return { kind: 'reject' } as const;
        const connected = connectedNetworks();
        if (addresses.every(address => !connected.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')))
          return { kind: 'approve-once' } as const;
      } catch { /* Invalid URLs, unavailable DNS and expired requests deny access. */ }
      return { kind: 'reject' } as const;
    })();
  };
}
