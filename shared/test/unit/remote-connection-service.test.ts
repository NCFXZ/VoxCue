import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, rename, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { REMOTE_PROTOCOL_VERSION } from '../../electron/contracts/remoteConnection';
import { applySnapshotDelta, createSnapshotDelta } from '../../electron/contracts/remoteSnapshotDelta';
import { RemoteInterviewCoordinator } from '../../electron/application/remoteConnection';
import {
  createMobileAssets,
  type MobileAssets,
} from '../../electron/backend/remoteConnection/assets';
import {
  RemoteConnectionService,
  RemoteRequestLimiter,
  isPrivateIPv4,
  parseRemoteCommand,
  selectPrivateIPv4,
} from '../../electron/backend/remoteConnection/service';
import type {
  RemoteCommand,
  RemoteInterviewSnapshot,
  RemoteServerMessage,
} from '../../electron/contracts/remoteConnection';

const services: RemoteConnectionService[] = [];
const clients: WebSocket[] = [];
const temporaryDirectories: string[] = [];
afterEach(async () => {
  clients.splice(0).forEach((client) => client.terminate());
  await Promise.all(services.splice(0).map((service) => service.disconnect()));
  for (const directory of temporaryDirectories.splice(0)) {
    if (
      path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith('voxcue-mobile-assets-')
    )
      throw Error('Unexpected temporary fixture path');
    await rm(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function snapshot(revision = 1): RemoteInterviewSnapshot {
  return {
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
    revision,
    status: 'running',
    inputMode: 'remote',
    transcripts: [
      { id: 'temporary-transcript', text: 'Synthetic question', time: '10:00', final: true },
    ],
    answers: [],
    pendingQuestion: 'Synthetic question',
    pendingQuestionRevision: 1,
    inputDraft: { text: 'Synthetic question', revision: 0, manual: false },
    omitted: { transcripts: 0, answers: 0 },
    generating: false,
    aiEnabled: true,
    microphoneMuted: false,
    microphoneToggling: false,
    micRevision: 0,
    autoAnswer: true,
    autoAnswerRevision: 0,
    capabilities: {
      sendQuestion: true,
      setMicrophone: true,
      setAutoAnswer: true,
      stopAnswer: false,
    },
  };
}

async function start(
  onCommand = vi.fn(async (command: RemoteCommand) => ({ requestId: command.requestId, ok: true })),
  mobileAssets?: MobileAssets,
) {
  const onState = vi.fn();
  const service = new RemoteConnectionService({ onState, onCommand, mobileAssets });
  services.push(service);
  const state = await service.start();
  // This integration intentionally exercises a real private interface, never a public listener.
  expect(state.status, state.error ?? '').toBe('waiting');
  expect(state.addresses).toHaveLength(1);
  const origin = state.addresses[0];
  expect(isPrivateIPv4(new URL(origin).hostname)).toBe(true);
  return { service, origin, onState, onCommand };
}

async function mobileFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'voxcue-mobile-assets-'));
  temporaryDirectories.push(directory);
  const manifest: Record<string, Record<string, unknown>> = {
    'mobile.html': {
      file: 'assets/mobile-abc.js',
      isEntry: true,
      imports: ['_shared.js'],
      dynamicImports: ['lazy.ts'],
      css: ['assets/mobile-abc.css'],
      assets: ['assets/temporary.woff2'],
    },
    '_shared.js': { file: 'assets/shared-abc.js' },
    'lazy.ts': { file: 'assets/lazy-abc.js', isDynamicEntry: true },
    'index.html': { file: 'assets/desktop-abc.js', isEntry: true },
  };
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="./assets/mobile-abc.js"></script><link rel="stylesheet" href="./assets/mobile-abc.css"></head><body><div id="root">Temporary mobile entry</div></body></html>';
  const files: Record<string, string> = {
    'mobile.html': html,
    '.vite/manifest.json': JSON.stringify(manifest),
    'assets/mobile-abc.js': 'import "./shared-abc.js";import("./lazy-abc.js");',
    'assets/shared-abc.js': 'export const ready=true;',
    'assets/lazy-abc.js': 'export const lazy=true;',
    'assets/mobile-abc.css': 'body{margin:0}',
    'assets/temporary.woff2': 'temporary-font',
    'assets/desktop-abc.js': 'temporary-desktop-only',
    'index.html': 'temporary-desktop-index',
    'secret.json': 'temporary-private-file',
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(directory, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { directory, manifest, html, provider: createMobileAssets(directory) };
}

async function rawGet(origin: string, target: string) {
  const url = new URL(origin);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = request(
      { hostname: url.hostname, port: url.port, path: target },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () =>
          resolve({ status: incoming.statusCode!, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function post(
  origin: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function socket(origin: string, acknowledge = true) {
  const client = new WebSocket(`${origin.replace('http:', 'ws:')}/connect`, { origin });
  clients.push(client);
  const messages: RemoteServerMessage[] = [];
  const waiters = new Set<() => void>();
  client.on('message', (data) => {
    const message = JSON.parse(data.toString()) as RemoteServerMessage;
    messages.push(message);
    waiters.forEach((notify) => notify());
    if (acknowledge && (message.type === 'paired' || message.type === 'snapshot' || message.type === 'snapshot-delta'))
      client.send(
        JSON.stringify({
          type: 'snapshot-applied',
          sequence: message.sequence,
          deliveryId: message.deliveryId,
        }),
      );
  });
  client.on('error', () => {});
  await once(client, 'open');
  return {
    client,
    messages,
    send(value: unknown) {
      client.send(JSON.stringify(value));
    },
    async next<T extends RemoteServerMessage['type']>(
      type: T,
    ): Promise<Extract<RemoteServerMessage, { type: T }>> {
      const take = () => {
        const index = messages.findIndex((message) => message.type === type);
        return index < 0
          ? undefined
          : (messages.splice(index, 1)[0] as Extract<RemoteServerMessage, { type: T }>);
      };
      const queued = take();
      if (queued) return queued;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`Missing ${type} message`));
        }, 3000);
        const check = () => {
          const value = take();
          if (value) {
            clearTimeout(timeout);
            waiters.delete(check);
            resolve(value);
          }
        };
        waiters.add(check);
      });
    },
  };
}

async function pair(service: RemoteConnectionService, origin: string, acknowledge = true, snapshotDelta = false) {
  const invitation = service.pairing();
  const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('pair');
  const response = await post(origin, '/pair', { token, name: 'Temporary phone' });
  expect(response.status).toBe(200);
  const pending = (await response.json()) as { id: string; code: string; protocolVersion: number };
  expect(pending.protocolVersion).toBe(REMOTE_PROTOCOL_VERSION);
  const phone = await socket(origin, acknowledge);
  phone.send({
    type: 'authenticate',
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    pendingId: pending.id,
    ...(snapshotDelta ? { snapshotDelta: true } : {}),
  });
  const notice = await phone.next('pending');
  expect(notice.code).toBe(pending.code);
  expect(service.state().pending).toEqual({
    id: pending.id,
    code: pending.code,
    name: 'Temporary phone',
  });
  service.approve(pending.id);
  const approved = await phone.next('paired');
  expect(approved.protocolVersion).toBe(REMOTE_PROTOCOL_VERSION);
  return { ...phone, token: approved.token, approved };
}

it('reconstructs bounded row windows, replacements, truncation and control edits without mutating a rejected base', () => {
  const prior = snapshot();
  prior.transcripts = Array.from({ length: 200 }, (_, n) => ({ ...prior.transcripts[0], id: String(n) }));
  prior.answers = [{ id: 'answer', question: 'Question', content: '回答', status: 'streaming' }];
  const target = structuredClone(prior);
  target.revision++;
  target.transcripts.shift();
  target.transcripts[3].final = false;
  target.transcripts.push({ ...target.transcripts[0], id: 'new' });
  target.answers[0].content += '。';
  target.omitted.transcripts++;
  target.pendingQuestion = '';
  const delta = createSnapshotDelta(prior, target)!;
  expect(delta.transcripts).toMatchObject({ drop: 1, length: 200 });
  expect(delta.answers?.changes).toEqual([{ at: 0, id: 'answer', append: '。' }]);
  expect(applySnapshotDelta(prior, JSON.parse(JSON.stringify(delta)))).toEqual(target);
  const shorter = { ...target, revision: 3, transcripts: [], answers: [{ ...target.answers[0], content: '改' }] };
  expect(applySnapshotDelta(target, createSnapshotDelta(target, shorter))).toEqual(shorter);
  const saved = structuredClone(prior);
  for (const change of [
    { baseRevision: 42 }, { sessionEpoch: 2 }, { controls: { status: 'missing' } },
    { answers: { drop: 0, length: 1, changes: [{ at: 0, id: 'other', append: '。' }] } },
    { answers: { drop: 0, length: 40, changes: [{ at: 39, row: prior.answers[0] }] } },
    { transcripts: { drop: 0, length: 201, changes: [] } },
  ]) expect(applySnapshotDelta(prior, { ...delta, ...change })).toBeNull();
  expect(prior).toEqual(saved);
  expect(createSnapshotDelta(target, prior)).toBeNull();
  expect(createSnapshotDelta(prior, { ...target, sessionEpoch: 2 })).toBeNull();
});

it('applies the whole-snapshot UTF-8 limit to accumulated deltas across independent rows', () => {
  const start = snapshot();
  const item = { id: '', question: '', content: '答'.repeat(100_000) };
  start.answers = ['one', 'two', 'three'].map(id => ({ ...item, id }));
  const accepted = { ...start, revision: 2, answers: [...start.answers, { ...item, id: 'four', content: '答' }] };
  const applied = applySnapshotDelta(start, createSnapshotDelta(start, accepted))!;
  expect(applied).toEqual(accepted);
  const over = { ...accepted, revision: 3, answers: [...start.answers, { ...item, id: 'four' }] };
  expect(applySnapshotDelta(applied, createSnapshotDelta(accepted, over))).toBeNull();
  expect(applied.answers[3].content).toBe('答');
});

it('bases deltas on the confirmed delivery and sends full snapshots on explicit sync, resume and epoch changes', async () => {
  const { service, origin } = await start();
  const current = snapshot();
  current.answers = [{ id: 'a', question: 'Question', content: '答'.repeat(2000) }];
  service.updateSnapshot(current);
  const phone = await pair(service, origin, false, true);
  expect(phone.approved.snapshot).toEqual(current);
  const ack = (message: { sequence: number; deliveryId: string }) =>
    phone.send({ type: 'snapshot-applied', sequence: message.sequence, deliveryId: message.deliveryId });
  ack(phone.approved);
  const advance = (revision: number) => {
    const next = { ...current, revision, answers: [{ ...current.answers[0], content: current.answers[0].content + '文'.repeat(revision - 1) }] };
    service.updateSnapshot(next);
    return next;
  };
  const second = advance(2);
  const first = await phone.next('snapshot-delta');
  expect(first.baseSequence).toBe(phone.approved.sequence);
  expect(applySnapshotDelta(current, first.delta)).toEqual(second);
  advance(3);
  const fourth = advance(4);
  ack(first);
  const latest = await phone.next('snapshot-delta');
  expect(latest.baseSequence).toBe(first.sequence);
  expect(applySnapshotDelta(second, latest.delta)).toEqual(fourth);
  phone.send({ type: 'sync' });
  ack(latest);
  const full = await phone.next('snapshot');
  expect(full.sequence).toBe(latest.sequence);
  expect(full.snapshot).toEqual(fourth);
  const refreshed = await socket(origin);
  refreshed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token, snapshotDelta: true });
  const restored = await refreshed.next('paired');
  expect(restored.snapshot).toEqual(fourth);
  const fifth = advance(5);
  const resumedDelta = await refreshed.next('snapshot-delta');
  expect(resumedDelta.baseSequence).toBe(restored.sequence);
  expect(applySnapshotDelta(fourth, resumedDelta.delta)).toEqual(fifth);
  const replaced = { ...current, sessionEpoch: current.sessionEpoch + 1 };
  service.updateSnapshot(replaced);
  expect((await refreshed.next('snapshot')).snapshot).toEqual(replaced);
});

it('accepts only RFC1918 IPv4 peers and validates the command whitelist and revisions', () => {
  for (const address of [
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.2',
    '::ffff:192.168.1.2',
  ])
    expect(isPrivateIPv4(address)).toBe(true);
  for (const address of [
    '127.0.0.1',
    '0.0.0.0',
    '8.8.8.8',
    '169.254.1.2',
    '172.15.0.1',
    '172.32.0.1',
    '::1',
    'fc00::1',
    '192.168.1.999',
  ])
    expect(isPrivateIPv4(address)).toBe(false);
  const base = {
    requestId: 'temporary-request',
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
  };
  expect(
    parseRemoteCommand({ ...base, action: 'set-microphone', muted: true, expectedRevision: 2 }),
  ).toMatchObject({ muted: true });
  expect(
    parseRemoteCommand({
      ...base,
      action: 'ask',
      text: 'What is the synthetic result?',
      pendingQuestionRevision: 0,
    }),
  ).toMatchObject({ pendingQuestionRevision: 0 });
  expect(parseRemoteCommand({ ...base, action: 'stop-answer', answerId: '1' })).toMatchObject({
    answerId: '1',
  });
  expect(
    parseRemoteCommand({ ...base, action: 'set-draft', text: '', expectedRevision: 0 }),
  ).toMatchObject({ text: '', expectedRevision: 0 });
  expect(
    parseRemoteCommand({ ...base, action: 'ask', text: 'Shared question', inputDraftRevision: 2 }),
  ).toMatchObject({ inputDraftRevision: 2 });
  for (const invalid of [
    { ...base, action: 'set-microphone', muted: 1, expectedRevision: 0 },
    { ...base, action: 'set-auto-answer', enabled: true, expectedRevision: -1 },
    { ...base, action: 'ask', text: 'a'.repeat(6001) },
    { ...base, action: 'ask', text: ' ' },
    { ...base, action: 'ask', text: 'Question', pendingQuestionRevision: 0.5 },
    { ...base, action: 'ask', text: 'Question', inputDraftRevision: -1 },
    { ...base, action: 'ask', text: 'Question', inputDraftRevision: 1, pendingQuestionRevision: 1 },
    { ...base, action: 'set-draft', text: 'a'.repeat(6001), expectedRevision: 0 },
    { ...base, action: 'set-draft', text: '', expectedRevision: -1 },
    { ...base, action: 'stop-answer' },
    { ...base, action: 'execute', command: 'anything' },
    { ...base, action: 'ask', text: 'Question', sessionEpoch: NaN },
  ])
    expect(parseRemoteCommand(invalid)).toBeNull();
});

it('isolates request budgets by peer and expires bounded source windows', () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const limiter = new RemoteRequestLimiter();
  for (let i = 0; i < 60; i++) expect(limiter.allow('192.168.1.2')).toBe(true);
  expect(limiter.allow('::ffff:192.168.1.2')).toBe(false);
  expect(limiter.allow('192.168.1.3')).toBe(true);
  for (let i = 0; i < 126; i++) expect(limiter.allow(`10.0.0.${i + 1}`)).toBe(true);
  expect(limiter.allow('192.168.1.4')).toBe(false);
  now += 10_001;
  expect(limiter.allow('192.168.1.2')).toBe(true);
  expect(limiter.allow('192.168.1.4')).toBe(true);
});

it('prefers private Wi-Fi and physical interfaces over virtual adapters without binding public addresses', () => {
  const adapter = (address: string) => [
    {
      address,
      family: 'IPv4' as const,
      internal: false,
      netmask: '255.255.255.0',
      mac: '00:00:00:00:00:00',
      cidr: `${address}/24`,
    },
  ];
  expect(
    selectPrivateIPv4({
      'vEthernet (Default Switch)': adapter('172.16.0.1'),
      Ethernet: adapter('192.168.0.2'),
      'Wi-Fi': adapter('192.168.1.2'),
    }),
  ).toBe('192.168.1.2');
  expect(
    selectPrivateIPv4({
      'VMware Network Adapter VMnet1': adapter('192.168.3.1'),
      Ethernet: adapter('10.0.0.2'),
    }),
  ).toBe('10.0.0.2');
  expect(selectPrivateIPv4({ Docker: adapter('172.18.0.1') })).toBe('172.18.0.1');
  expect(
    selectPrivateIPv4({
      Ethernet: adapter('8.8.8.8'),
      Loopback: [{ ...adapter('10.0.0.1')[0], internal: true }],
    }),
  ).toBeNull();
});

it('fails explicitly without mobile build assets and rejects foreign Host/Origin and unauthenticated pairing', async () => {
  const { service, origin } = await start();
  expect((await service.start()).addresses).toEqual([origin]);
  service.updateSnapshot(snapshot());
  const page = await fetch(origin);
  expect(page.status).toBe(503);
  expect(page.headers.get('cache-control')).toBe('no-store');
  const text = await page.text();
  expect(text).toContain('mobile-assets-unavailable');
  expect(text).not.toContain('Synthetic question');
  const foreignHostStatus = await new Promise<number>((resolve, reject) => {
    const outgoing = request(origin, { headers: { Host: 'attacker.invalid' } }, (incoming) => {
      incoming.resume();
      resolve(incoming.statusCode!);
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
  expect(foreignHostStatus).toBe(403);
  expect((await post(origin, '/pair', {}, { Origin: 'http://attacker.invalid' })).status).toBe(403);
  expect((await post(origin, '/pair', { token: 'invalid', name: 'Phone' })).status).toBe(401);
  expect((await fetch(`${origin}/snapshot`)).status).toBe(404);
  expect((await post(origin, '/pair', {}, { 'Content-Type': 'text/plain' })).status).toBe(415);
  expect((await post(origin, '/pair', { text: 'a'.repeat(3000) })).status).toBe(413);
});

it('does not disclose session content until a single-use invitation and desktop approval succeed', async () => {
  const { service, origin } = await start();
  service.updateSnapshot(snapshot());
  const invitation = service.pairing();
  const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('pair')!;
  expect(new URL(invitation.url).search).toBe('');
  expect(
    (await post(origin, '/pair', { token: 'é'.repeat(token.length), name: 'Phone' })).status,
  ).toBe(401);
  const response = await post(origin, '/pair', { token, name: 'Temporary phone' });
  const pending = (await response.json()) as { id: string; code: string };
  expect((await post(origin, '/pair', { token, name: 'Another phone' })).status).toBe(401);
  expect(() => service.approve(pending.id)).toThrow('等待设备');
  const phone = await socket(origin);
  phone.send({
    type: 'authenticate',
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    pendingId: pending.id,
  });
  await phone.next('pending');
  expect(phone.messages).toEqual([]);
  expect(service.state().status).toBe('waiting');
  expect(() => service.approve('stale-pending')).toThrow('失效');
  service.approve(pending.id);
  const approved = await phone.next('paired');
  expect(approved.snapshot?.transcripts[0].text).toBe('Synthetic question');
  expect(service.state()).toMatchObject({
    status: 'connected',
    clientName: 'Temporary phone',
    pending: null,
  });
  expect(() => service.pairing()).toThrow('先断开');
  const other = await socket(origin);
  other.send({
    type: 'resume',
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    token: 'unapproved-resume-token',
  });
  expect((await other.next('error')).error).toContain('认证失败');
});

it('expires and rejects invitations without silently replacing an approved device', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { service, origin } = await start();
  const invitation = service.pairing();
  const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('pair');
  now += 120_001;
  expect((await post(origin, '/pair', { token, name: 'Temporary phone' })).status).toBe(401);
  const next = service.pairing();
  const nextToken = new URLSearchParams(new URL(next.url).hash.slice(1)).get('pair');
  const response = await post(origin, '/pair', { token: nextToken, name: 'Temporary phone' });
  const pending = (await response.json()) as { id: string };
  service.reject(pending.id);
  expect(service.state().pending).toBeNull();
  expect(() => service.approve(pending.id)).toThrow('失效');
});

it('closes the idle listener after an invitation expires without a paired device', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { service, origin } = await start();
  const invitation = service.pairing();
  now = invitation.expiresAt + 1;
  const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('pair');
  expect((await post(origin, '/pair', { token, name: 'Temporary phone' })).status).toBe(401);
  expect(service.state().status).toBe('waiting');
  await service.disconnect();
  expect(service.state()).toMatchObject({ status: 'off', pending: null, addresses: [] });
  await expect(rawGet(origin, '/')).rejects.toThrow();
});

it('deduplicates accepted operations, rejects changed reuse and fences stale sessions', async () => {
  const { service, origin, onCommand } = await start();
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  const command = {
    requestId: 'temporary-question-1',
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
    action: 'ask',
    text: 'Synthetic question',
  };
  phone.send({ type: 'command', command });
  expect((await phone.next('result')).result.ok).toBe(true);
  phone.send({ type: 'command', command });
  expect((await phone.next('result')).result.ok).toBe(true);
  expect(onCommand).toHaveBeenCalledTimes(1);
  phone.send({ type: 'command', command: { ...command, text: 'Different question' } });
  expect((await phone.next('result')).result.error).toBe('request-conflict');
  phone.send({
    type: 'command',
    command: { ...command, requestId: 'stale-session-request', sessionEpoch: 0 },
  });
  expect((await phone.next('result')).result.error).toBe('session-changed');
  expect(onCommand).toHaveBeenCalledTimes(1);
});

it('reclaims previous-session receipts without replaying same-session commands', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { service, origin, onCommand } = await start();
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  const command = {
    requestId: 'receipt-0',
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
    action: 'ask',
    text: 'Synthetic question',
  };
  for (let i = 0; i < 1024; i++) {
    now += 1000;
    phone.send({ type: 'command', command: { ...command, requestId: `receipt-${i}` } });
    expect((await phone.next('result')).result.ok).toBe(true);
  }
  phone.send({ type: 'command', command });
  expect((await phone.next('result')).result.ok).toBe(true);
  expect(onCommand).toHaveBeenCalledTimes(1024);
  phone.send({ type: 'command', command: { ...command, requestId: 'old-session-full' } });
  expect((await phone.next('result')).result.error).toBe('request-limit-repair-required');
  service.updateSnapshot({ ...snapshot(2), sessionId: 'next-interview', sessionEpoch: 2 });
  await phone.next('snapshot');
  phone.send({ type: 'command', command });
  expect((await phone.next('result')).result.error).toBe('session-changed');
  const next = { ...command, sessionId: 'next-interview', sessionEpoch: 2 };
  phone.send({ type: 'command', command: next });
  expect((await phone.next('result')).result.ok).toBe(true);
  phone.send({ type: 'command', command: next });
  expect((await phone.next('result')).result.ok).toBe(true);
  expect(onCommand).toHaveBeenCalledTimes(1025);
}, 15000);

it('allows one unprocessed large snapshot and coalesces changes until its exact receipt arrives', async () => {
  const { service, origin } = await start();
  const initial = {
    ...snapshot(),
    answers: Array.from({ length: 7 }, (_, i) => ({
      id: `large-answer-${i}`,
      question: 'Synthetic',
      content: 'x'.repeat(128000),
    })),
  };
  service.updateSnapshot(initial);
  await expect(service.waitForSnapshotSlot()).resolves.toBeUndefined();
  const phone = await pair(service, origin, false);
  const pairedReceipt = service.waitForSnapshotSlot();
  for (let revision = 2; revision <= 51; revision++)
    service.updateSnapshot({ ...initial, revision });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(phone.messages.filter((message) => message.type === 'snapshot')).toHaveLength(0);
  const acknowledge = (message: { sequence: number; deliveryId: string }) =>
    phone.send({
      type: 'snapshot-applied',
      sequence: message.sequence,
      deliveryId: message.deliveryId,
    });
  acknowledge(phone.approved);
  const first = await phone.next('snapshot');
  let ready = false;
  const receipt = service.waitForSnapshotSlot()!.then(() => { ready = true; });
  expect(first.snapshot?.revision).toBe(51);
  for (let revision = 52; revision <= 71; revision++)
    service.updateSnapshot({ ...initial, revision });
  acknowledge(phone.approved); // Old delivery, even if its sequence was once valid.
  phone.send({ type: 'snapshot-applied', sequence: first.sequence, deliveryId: 'wrong-delivery' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(phone.messages.filter((message) => message.type === 'snapshot')).toHaveLength(0);
  expect(ready).toBe(false);
  acknowledge(first);
  const latest = await phone.next('snapshot');
  expect(latest.snapshot?.revision).toBe(71);
  expect(latest.deliveryId).not.toBe(first.deliveryId);
  acknowledge(latest);
  await expect(pairedReceipt).resolves.toBeUndefined();
  await receipt;
  expect(ready).toBe(true);
});

it('rejects receipts from a previous socket delivery and resynchronizes the same sequence with a new nonce', async () => {
  const { service, origin } = await start();
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin, false);
  const oldSocketReceipt = service.waitForSnapshotSlot();
  const resumed = await socket(origin, false);
  resumed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  const paired = await resumed.next('paired');
  expect(paired.sequence).toBe(phone.approved.sequence);
  expect(paired.deliveryId).not.toBe(phone.approved.deliveryId);
  resumed.send({
    type: 'snapshot-applied',
    sequence: paired.sequence,
    deliveryId: phone.approved.deliveryId,
  });
  resumed.send({ type: 'sync' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(resumed.messages.filter((message) => message.type === 'snapshot')).toHaveLength(0);
  resumed.send({
    type: 'snapshot-applied',
    sequence: paired.sequence,
    deliveryId: paired.deliveryId,
  });
  const synced = await resumed.next('snapshot');
  expect(synced.sequence).toBe(paired.sequence);
  expect(synced.deliveryId).not.toBe(paired.deliveryId);
  resumed.send({
    type: 'snapshot-applied',
    sequence: synced.sequence,
    deliveryId: synced.deliveryId,
  });
  await expect(oldSocketReceipt).resolves.toBeUndefined();
});

it('retires a stalled delivery on its watchdog and resumes without losing accepted command receipts', async () => {
  const realTimeout = globalThis.setTimeout;
  let expire: (() => void) | undefined;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    if (delay === 15000) expire = () => callback(...args);
    return realTimeout(callback, delay, ...args);
  });
  const { service, origin, onCommand } = await start();
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin, false);
  const receipt = service.waitForSnapshotSlot();
  const command = {
    requestId: 'before-snapshot-timeout',
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
    action: 'ask',
    text: 'Synthetic question',
  };
  phone.send({ type: 'command', command });
  expect((await phone.next('result')).result.ok).toBe(true);
  expect(expire).toBeTypeOf('function');
  const closed = once(phone.client, 'close');
  expire!();
  await closed;
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
  expect(service.state().error).toBe('设备连接已中断');
  await expect(receipt).resolves.toBeUndefined();
  await expect(service.waitForSnapshotSlot()).resolves.toBeUndefined();
  const resumed = await socket(origin);
  resumed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  await resumed.next('paired');
  resumed.send({ type: 'command', command });
  expect((await resumed.next('result')).result.ok).toBe(true);
  expect(onCommand).toHaveBeenCalledOnce();
});

it('reserves WebSocket admission for the approved phone while other sockets await authentication', async () => {
  const { service, origin } = await start();
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  for (let i = 0; i < 3; i++) await socket(origin);
  const resumed = await socket(origin);
  resumed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  expect((await resumed.next('paired')).snapshot).toMatchObject({
    sessionId: 'temporary-interview',
  });
  expect(service.state().status).toBe('connected');
  await vi.waitFor(() => expect(phone.client.readyState).not.toBe(WebSocket.OPEN));
});

it('resumes the same authorization with the latest snapshot and cached command receipt', async () => {
  const { service, origin, onCommand } = await start();
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  const command = {
    requestId: 'temporary-question-1',
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
    action: 'ask',
    text: 'Synthetic question',
  };
  phone.send({ type: 'command', command });
  await phone.next('result');
  phone.client.terminate();
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
  service.updateSnapshot({ ...snapshot(2), autoAnswer: false, autoAnswerRevision: 1 });
  const resumed = await socket(origin);
  resumed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  const restored = await resumed.next('paired');
  expect(restored.snapshot).toMatchObject({ revision: 2, autoAnswer: false });
  resumed.send({ type: 'command', command });
  expect((await resumed.next('result')).result.ok).toBe(true);
  expect(onCommand).toHaveBeenCalledTimes(1);
  service.updateSnapshot(snapshot(1));
  const current = { ...snapshot(3), pendingQuestion: 'Latest synthetic question' };
  service.updateSnapshot(current);
  current.pendingQuestion = 'Mutated outside the service';
  expect((await resumed.next('snapshot')).snapshot?.pendingQuestion).toBe(
    'Latest synthetic question',
  );
});

it('aborts stale in-flight commands and revokes resume tokens when explicitly disconnected', async () => {
  let finish: (value: { requestId: string; ok: boolean }) => void = () => {};
  const handler = vi.fn(
    (_command: RemoteCommand, _signal?: AbortSignal) =>
      new Promise<{ requestId: string; ok: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  const { service, origin } = await start(handler);
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  phone.send({
    type: 'command',
    command: {
      requestId: 'temporary-pending-1',
      sessionId: 'temporary-interview',
      sessionEpoch: 1,
      action: 'ask',
      text: 'Synthetic question',
    },
  });
  await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  const signal = handler.mock.calls[0][1]!;
  service.updateSnapshot({ ...snapshot(2), sessionEpoch: 2 });
  expect(signal.aborted).toBe(true);
  finish({ requestId: 'temporary-pending-1', ok: true });
  expect((await phone.next('result')).result.error).toBe('session-changed');
  await service.disconnect();
  expect(service.state()).toMatchObject({ status: 'off', addresses: [], clientName: null });
  const restarted = await service.start();
  const other = await socket(restarted.addresses[0]);
  other.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  expect((await other.next('error')).error).toContain('认证失败');
});

it('keeps an accepted operation running over a short disconnect and never repeats it on resume', async () => {
  let finish: (value: { requestId: string; ok: boolean }) => void = () => {};
  const handler = vi.fn(
    (_command: RemoteCommand, _signal?: AbortSignal) =>
      new Promise<{ requestId: string; ok: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  const { service, origin } = await start(handler);
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  const command = {
    requestId: 'temporary-running-1',
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
    action: 'ask',
    text: 'Synthetic question',
  };
  phone.send({ type: 'command', command });
  await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  phone.client.terminate();
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
  expect(handler.mock.calls[0][1]!.aborted).toBe(false);
  const resumed = await socket(origin);
  resumed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  await resumed.next('paired');
  resumed.send({ type: 'command', command });
  finish({ requestId: command.requestId, ok: true });
  expect((await resumed.next('result')).result.ok).toBe(true);
  expect(handler).toHaveBeenCalledOnce();
});

it('shares a new interview only with the approval shown at confirmation, including a same-device reconnect', async () => {
  const { service, origin } = await start();
  const phone = await pair(service, origin);
  const shown = service.state().approvalRevision;
  expect(shown).toBeGreaterThan(0);
  await service.confirmInterviewDevice(shown);
  expect(service.state().status).toBe('connected');

  phone.client.terminate();
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
  const whileDisconnected = service.state().approvalRevision;
  expect(whileDisconnected).toBeUndefined();

  // A user who saw this same device may still start while its connection recovers.
  await service.confirmInterviewDevice(shown);
  expect(service.state().status).toBe('reconnecting');
  const restored = await socket(origin);
  restored.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  await restored.next('paired');
  expect(service.state().approvalRevision).toBe(shown);

  // If the user confirmed while it was absent, even a completed reconnect before launch is excluded.
  await service.confirmInterviewDevice(whileDisconnected);
  expect(service.state()).toMatchObject({ status: 'off', clientName: null, addresses: [] });
  expect(service.state().approvalRevision).toBeUndefined();
});

it('requires fresh consent if a different device was approved after the start dialog was seen', async () => {
  const { service, origin } = await start();
  const first = await pair(service, origin);
  const shown = service.state().approvalRevision;
  first.client.terminate();
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
  await pair(service, origin);
  expect(service.state().approvalRevision).not.toBe(shown);
  await service.confirmInterviewDevice(shown);
  expect(service.state().status).toBe('off');
});

it('can explicitly replace a disconnected authorization with a fresh invitation during the resume window', async () => {
  const { service, origin } = await start();
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  phone.client.terminate();
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
  const invitation = service.pairing();
  expect(service.state()).toMatchObject({ status: 'waiting', clientName: null });
  const stale = await socket(origin);
  stale.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  expect((await stale.next('error')).error).toContain('认证失败');
  const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('pair');
  const response = await post(origin, '/pair', { token, name: 'Replacement phone' });
  expect(response.status).toBe(200);
  const pending = (await response.json()) as { id: string };
  const replacement = await socket(origin);
  replacement.send({
    type: 'authenticate',
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    pendingId: pending.id,
  });
  await replacement.next('pending');
  service.approve(pending.id);
  expect((await replacement.next('paired')).snapshot).toBeNull();
  service.updateSnapshot(snapshot(2));
  expect((await replacement.next('snapshot')).snapshot).toEqual(snapshot(2));
  expect(service.state().clientName).toBe('Replacement phone');
});

it('requires an explicit compatible protocol version before disclosing pairing or snapshot data', async () => {
  const { service, origin } = await start();
  service.updateSnapshot(snapshot());
  for (const message of [
    { type: 'authenticate', pendingId: 'invalid-pending' },
    {
      type: 'authenticate',
      protocolVersion: REMOTE_PROTOCOL_VERSION - 1,
      pendingId: 'invalid-pending',
    },
    { type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION + 1, token: 'invalid-token' },
  ]) {
    const phone = await socket(origin);
    phone.send(message);
    expect((await phone.next('error')).error).toContain('协议版本');
    expect(phone.messages).toEqual([]);
  }
});

it('keeps processed-snapshot receipts separate from the normal command/message rate budget', async () => {
  const { service, origin, onCommand } = await start();
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  for (let revision = 2; revision <= 81; revision++) {
    service.updateSnapshot(snapshot(revision));
    expect((await phone.next('snapshot')).snapshot?.revision).toBe(revision);
  }
  phone.send({
    type: 'command',
    command: {
      requestId: 'after-streaming-receipts',
      sessionId: 'temporary-interview',
      sessionEpoch: 1,
      action: 'ask',
      text: 'Synthetic question',
    },
  });
  expect((await phone.next('result')).result.ok).toBe(true);
  expect(onCommand).toHaveBeenCalledOnce();
  expect(service.state().status).toBe('connected');
});

it('queries unknown, pending and completed receipts without executing or replaying any command', async () => {
  let finish: (value: { requestId: string; ok: boolean }) => void = () => {};
  const handler = vi.fn(
    (_command: RemoteCommand, _signal?: AbortSignal) =>
      new Promise<{ requestId: string; ok: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  const { service, origin } = await start(handler);
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  const requestId = 'temporary-query-request';
  phone.send({ type: 'query-result', requestId });
  expect((await phone.next('result')).result.error).toBe('request-unknown');
  expect(handler).not.toHaveBeenCalled();
  phone.send({
    type: 'command',
    command: {
      requestId,
      sessionId: 'temporary-interview',
      sessionEpoch: 1,
      action: 'ask',
      text: 'Synthetic question',
    },
  });
  await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  phone.send({ type: 'query-result', requestId });
  expect((await phone.next('command-pending')).requestId).toBe(requestId);
  phone.client.terminate();
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
  finish({ requestId, ok: true });
  const resumed = await socket(origin);
  resumed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  await resumed.next('paired');
  resumed.send({ type: 'query-result', requestId });
  expect((await resumed.next('result')).result).toEqual({ requestId, ok: true });
  resumed.send({ type: 'query-result', requestId: 'never-received-request' });
  expect((await resumed.next('result')).result.error).toBe('request-unknown');
  expect(handler).toHaveBeenCalledOnce();
});

it('maps coordinator dispatch IDs back to the phone receipt and queries it after a real reconnect', async () => {
  const requestId = 'temporary-phone-integration-request';
  let coordinator: RemoteInterviewCoordinator;
  const dispatch = vi.fn((command: RemoteCommand) => {
    expect(command.requestId).not.toBe(requestId);
    expect(command.requestId).toMatch(/^[0-9a-f-]{36}$/);
    coordinator.complete({ requestId: command.requestId, ok: true, answerId: 'synthetic-answer' });
    return true;
  });
  coordinator = new RemoteInterviewCoordinator(dispatch);
  const current = snapshot();
  expect(coordinator.publish(current)).toBe(true);
  const handler = vi.fn((command: RemoteCommand, signal?: AbortSignal) =>
    coordinator.dispatch(command, signal),
  );
  const { service, origin } = await start(handler);
  service.updateSnapshot(current);
  const phone = await pair(service, origin);
  phone.send({
    type: 'command',
    command: {
      requestId,
      sessionId: current.sessionId,
      sessionEpoch: current.sessionEpoch,
      action: 'ask',
      text: 'Synthetic integration question',
    },
  });
  const expected = { requestId, ok: true, answerId: 'synthetic-answer' };
  expect((await phone.next('result')).result).toEqual(expected);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(handler).toHaveBeenCalledOnce();
  phone.client.terminate();
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
  const resumed = await socket(origin);
  resumed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  await resumed.next('paired');
  resumed.send({ type: 'query-result', requestId });
  expect((await resumed.next('result')).result).toEqual(expected);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(handler).toHaveBeenCalledOnce();
});

it('bounds snapshot and frame sizes and closes foreign-origin WebSocket upgrades', async () => {
  const { service, origin } = await start();
  expect(() =>
    service.updateSnapshot({ ...snapshot(), pendingQuestion: 'a'.repeat(1024 * 1024) }),
  ).toThrow('容量限制');
  const rejected = new WebSocket(`${origin.replace('http:', 'ws:')}/connect`, {
    origin: 'http://attacker.invalid',
  });
  clients.push(rejected);
  rejected.on('error', () => {});
  const [error] = await once(rejected, 'error');
  expect(String(error)).toContain('403');
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  const closed = once(phone.client, 'close');
  phone.client.send('a'.repeat(33 * 1024));
  const [code] = await closed;
  expect(code).toBe(1009);
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
});

it('serves only the mobile manifest dependency closure without exposing desktop files or URL tokens', async () => {
  const fixture = await mobileFixture();
  const { service, origin } = await start(undefined, fixture.provider);
  service.updateSnapshot(snapshot());
  const invitation = service.pairing();
  const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('pair')!;
  const page = await fetch(invitation.url);
  expect(page.status).toBe(200);
  expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(page.headers.get('cache-control')).toBe('no-store');
  expect(page.headers.get('x-content-type-options')).toBe('nosniff');
  expect(page.headers.get('permissions-policy')).toContain('microphone=()');
  const policy = page.headers.get('content-security-policy')!;
  expect(policy).toContain("script-src 'self'; style-src 'self'");
  expect(policy).toContain(`connect-src 'self' ${origin.replace('http:', 'ws:')}`);
  expect(policy).not.toContain('unsafe-inline');
  expect(await page.text()).toBe(fixture.html);
  expect(service.state().pending).toBeNull();
  const head = await fetch(origin, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(fixture.html)));
  expect(await head.text()).toBe('');
  for (const [name, type] of [
    ['mobile-abc.js', 'text/javascript'],
    ['shared-abc.js', 'text/javascript'],
    ['lazy-abc.js', 'text/javascript'],
    ['mobile-abc.css', 'text/css'],
    ['temporary.woff2', 'font/woff2'],
  ]) {
    const response = await fetch(`${origin}/assets/${name}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(type);
    const text = await response.text();
    expect(text).not.toContain(token);
    expect(text).not.toContain('Synthetic question');
  }
  for (const target of [
    '/index.html',
    '/mobile.html',
    '/.vite/manifest.json',
    '/secret.json',
    '/assets/desktop-abc.js',
    '/assets/unlisted.js',
    '/assets/../index.html',
    '/assets/%2e%2e/secret.json',
    '/assets/%252e%252e%252fsecret.json',
    '/assets/mobile-abc.js?key=secret',
    '/?pair=secret',
    '/assets/..\\secret.json',
  ]) {
    const response = await rawGet(origin, target);
    expect(response.status, target).toBe(404);
    expect(response.body).not.toContain('temporary-private-file');
    expect(response.body).not.toContain('temporary-desktop');
  }
  // Loading or HEAD-checking the page has not consumed the invitation.
  expect((await post(origin, '/pair', { token, name: 'Temporary phone' })).status).toBe(200);
});

it('fails closed for absent build entries, dependencies and malicious manifest or inline HTML references', async () => {
  const cases: Array<(fixture: Awaited<ReturnType<typeof mobileFixture>>) => Promise<void>> = [
    async (fixture) => {
      await rm(path.join(fixture.directory, '.vite/manifest.json'));
    },
    async (fixture) => {
      await rm(path.join(fixture.directory, 'assets/shared-abc.js'));
    },
    async (fixture) => {
      fixture.manifest['mobile.html'].assets = ['../secret.json'];
      await writeFile(
        path.join(fixture.directory, '.vite/manifest.json'),
        JSON.stringify(fixture.manifest),
      );
    },
    async (fixture) => {
      fixture.manifest['mobile.html'].imports = ['index.html'];
      await writeFile(
        path.join(fixture.directory, '.vite/manifest.json'),
        JSON.stringify(fixture.manifest),
      );
    },
    async (fixture) => {
      fixture.manifest['mobile.html'].assets = ['assets/desktop-abc.js'];
      await writeFile(
        path.join(fixture.directory, '.vite/manifest.json'),
        JSON.stringify(fixture.manifest),
      );
    },
    async (fixture) => {
      await writeFile(
        path.join(fixture.directory, 'mobile.html'),
        '<script src="./assets/desktop-abc.js"></script>',
      );
    },
    async (fixture) => {
      await writeFile(
        path.join(fixture.directory, 'mobile.html'),
        '<script>window.bad=true</script>',
      );
    },
    async (fixture) => {
      await writeFile(
        path.join(fixture.directory, 'mobile.html'),
        '<div style="display:block">Invalid inline style</div>',
      );
    },
  ];
  for (const change of cases) {
    const fixture = await mobileFixture();
    await change(fixture);
    const { origin } = await start(undefined, fixture.provider);
    const response = await fetch(origin);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('mobile-assets-unavailable');
  }
});

it('contains symlinked files and bounds individual and cumulative mobile build sizes', async () => {
  const linked = await mobileFixture();
  const outside = await mobileFixture();
  await rename(
    path.join(linked.directory, 'assets'),
    path.join(linked.directory, 'original-assets'),
  );
  await symlink(
    path.join(outside.directory, 'assets'),
    path.join(linked.directory, 'assets'),
    'junction',
  );
  expect((await fetch((await start(undefined, linked.provider)).origin)).status).toBe(503);
  const large = await mobileFixture();
  await truncate(path.join(large.directory, 'assets/mobile-abc.js'), 8 * 1024 * 1024 + 1);
  expect((await fetch((await start(undefined, large.provider)).origin)).status).toBe(503);
  const cumulative = await mobileFixture();
  const fonts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const name = `assets/temporary-large-${i}.woff2`;
    fonts.push(name);
    await writeFile(path.join(cumulative.directory, name), '');
    await truncate(path.join(cumulative.directory, name), 7 * 1024 * 1024);
  }
  cumulative.manifest['mobile.html'].assets = fonts;
  await writeFile(
    path.join(cumulative.directory, '.vite/manifest.json'),
    JSON.stringify(cumulative.manifest),
  );
  expect((await fetch((await start(undefined, cumulative.provider)).origin)).status).toBe(503);
});

it('lets an authenticated phone disconnect explicitly without an unexpected-reconnect state or changing the interview', async () => {
  const { service, origin, onState, onCommand } = await start();
  const current = snapshot();
  service.updateSnapshot(current);
  const unauthenticated = await socket(origin);
  unauthenticated.send({ type: 'disconnect' });
  expect((await unauthenticated.next('error')).error).toContain('协议版本');
  const phone = await pair(service, origin);
  const marker = onState.mock.calls.length;
  const closed = once(phone.client, 'close');
  phone.send({ type: 'disconnect' });
  await phone.next('disconnected');
  expect((await closed)[0]).toBe(1000);
  expect(service.state()).toMatchObject({
    status: 'waiting',
    clientName: null,
    addresses: [origin],
  });
  expect(onState.mock.calls.slice(marker).some(([state]) => state.status === 'reconnecting')).toBe(
    false,
  );
  expect(onCommand).not.toHaveBeenCalled();
  const stale = await socket(origin);
  stale.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  expect((await stale.next('error')).error).toContain('认证失败');
  const replacement = await pair(service, origin);
  expect(replacement.approved.snapshot).toBeNull();
  const latest = { ...snapshot(2), pendingQuestion: '' };
  service.updateSnapshot(latest);
  expect((await replacement.next('snapshot')).snapshot).toEqual(latest);
});

it('allows the same resume authorization to replace a stale active socket during refresh', async () => {
  const { service, origin, onState, onCommand } = await start();
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  const command = {
    requestId: 'temporary-refresh-request',
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
    action: 'ask',
    text: 'Synthetic question',
  };
  phone.send({ type: 'command', command });
  await phone.next('result');
  const marker = onState.mock.calls.length;
  const oldClosed = once(phone.client, 'close');
  const refreshed = await socket(origin);
  refreshed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  expect((await refreshed.next('paired')).snapshot?.sessionId).toBe('temporary-interview');
  await oldClosed;
  expect(service.state().status).toBe('connected');
  expect(onState.mock.calls.slice(marker).some(([state]) => state.status === 'reconnecting')).toBe(
    false,
  );
  phone.client.send(
    JSON.stringify({ type: 'command', command: { ...command, requestId: 'stale-socket-control' } }),
    () => {},
  );
  refreshed.send({ type: 'query-result', requestId: command.requestId });
  expect((await refreshed.next('result')).result.ok).toBe(true);
  expect(onCommand).toHaveBeenCalledOnce();
  refreshed.send({
    type: 'command',
    command: { ...command, requestId: 'refreshed-control-request' },
  });
  expect((await refreshed.next('result')).result.ok).toBe(true);
  expect(onCommand).toHaveBeenCalledTimes(2);
});

it('resynchronizes an authenticated open socket with the same sequence without triggering any business operation', async () => {
  const { service, origin, onCommand, onState } = await start();
  const current = snapshot();
  service.updateSnapshot(current);
  const unauthorized = await socket(origin);
  unauthorized.send({ type: 'sync', protocolVersion: REMOTE_PROTOCOL_VERSION });
  expect((await unauthorized.next('error')).error).toContain('认证失败');
  expect(unauthorized.messages).toEqual([]);
  const phone = await pair(service, origin);
  const stateRevision = service.state().revision;
  const stateNotifications = onState.mock.calls.length;
  phone.send({ type: 'sync' });
  expect(await phone.next('snapshot')).toEqual({
    type: 'snapshot',
    deliveryId: expect.any(String),
    sequence: phone.approved.sequence,
    snapshot: current,
  });
  phone.send({ type: 'sync' });
  expect((await phone.next('snapshot')).sequence).toBe(phone.approved.sequence);
  expect(service.state().revision).toBe(stateRevision);
  expect(onState).toHaveBeenCalledTimes(stateNotifications);
  expect(onCommand).not.toHaveBeenCalled();
});

it('acknowledges and deduplicates shared drafts with an independent typing rate budget', async () => {
  let draftRevision = 0;
  const handler = vi.fn(async (command: RemoteCommand) => {
    if (command.action === 'set-draft')
      return { requestId: command.requestId, ok: true, inputDraftRevision: ++draftRevision };
    return { requestId: command.requestId, ok: true };
  });
  const { service, origin } = await start(handler);
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  const base = { sessionId: 'temporary-interview', sessionEpoch: 1, action: 'set-draft' };
  for (let i = 0; i < 40; i++) {
    phone.send({
      type: 'command',
      command: {
        ...base,
        requestId: `temporary-typing-${i}`,
        text: `Shared draft ${i}`,
        expectedRevision: i,
      },
    });
    expect((await phone.next('result')).result).toMatchObject({
      ok: true,
      inputDraftRevision: i + 1,
    });
  }
  phone.send({
    type: 'command',
    command: {
      ...base,
      requestId: 'temporary-typing-39',
      text: 'Shared draft 39',
      expectedRevision: 39,
    },
  });
  expect((await phone.next('result')).result.inputDraftRevision).toBe(40);
  phone.send({ type: 'query-result', requestId: 'temporary-typing-39' });
  expect((await phone.next('result')).result.inputDraftRevision).toBe(40);
  expect(handler).toHaveBeenCalledTimes(40);
  phone.send({
    type: 'command',
    command: {
      ...base,
      requestId: 'typing-rate-limit',
      text: 'Too frequent',
      expectedRevision: 40,
    },
  });
  expect((await phone.next('result')).result.error).toBe('command-busy');
  phone.send({
    type: 'command',
    command: {
      requestId: 'business-after-typing',
      sessionId: base.sessionId,
      sessionEpoch: 1,
      action: 'ask',
      text: 'Shared draft 39',
      inputDraftRevision: 40,
    },
  });
  expect((await phone.next('result')).result.ok).toBe(true);
  expect(handler).toHaveBeenCalledTimes(41);
  expect(handler.mock.lastCall?.[0]).toMatchObject({ action: 'ask', inputDraftRevision: 40 });
});

it('bounds typing receipts without exhausting or evicting business receipts and fences evicted drafts through CAS', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  let draftRevision = 0;
  let draftText = '';
  const handler = vi.fn(async (command: RemoteCommand) => {
    if (command.action !== 'set-draft')
      return { requestId: command.requestId, ok: true, answerId: 'synthetic-business' };
    if (command.expectedRevision !== draftRevision)
      return {
        requestId: command.requestId,
        ok: false,
        error: 'draft-conflict',
        inputDraftRevision: draftRevision,
      };
    draftText = command.text;
    return { requestId: command.requestId, ok: true, inputDraftRevision: ++draftRevision };
  });
  const { service, origin } = await start(handler);
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  phone.send({
    type: 'command',
    command: {
      requestId: 'persistent-business',
      sessionId: 'temporary-interview',
      sessionEpoch: 1,
      action: 'ask',
      text: 'Synthetic question',
    },
  });
  expect((await phone.next('result')).result.ok).toBe(true);
  const draft = (index: number) => ({
    requestId: `long-typing-${index}`,
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
    action: 'set-draft',
    text: `Shared text ${index}`,
    expectedRevision: index,
  });
  // Simulate continuous editing across rate windows, beyond the business pool's capacity.
  for (let i = 0; i < 1025; i++) {
    now += 500;
    phone.send({ type: 'command', command: draft(i) });
    expect((await phone.next('result')).result).toMatchObject({
      ok: true,
      inputDraftRevision: i + 1,
    });
  }
  phone.send({ type: 'query-result', requestId: 'persistent-business' });
  expect((await phone.next('result')).result).toMatchObject({
    ok: true,
    answerId: 'synthetic-business',
  });
  phone.send({ type: 'query-result', requestId: 'long-typing-0' });
  expect((await phone.next('result')).result.error).toBe('request-unknown');
  expect(handler).toHaveBeenCalledTimes(1026);
  phone.send({ type: 'command', command: draft(0) });
  expect((await phone.next('result')).result).toMatchObject({
    ok: false,
    error: 'draft-conflict',
    inputDraftRevision: 1025,
  });
  expect(draftText).toBe('Shared text 1024');
  phone.send({
    type: 'command',
    command: {
      requestId: 'new-business-after-typing',
      sessionId: 'temporary-interview',
      sessionEpoch: 1,
      action: 'ask',
      text: draftText,
      inputDraftRevision: 1025,
    },
  });
  expect((await phone.next('result')).result.ok).toBe(true);
}, 15000);

it('aborts in-flight shared draft acknowledgements on a session change and never forwards old-session drafts', async () => {
  let finish: (value: {
    requestId: string;
    ok: boolean;
    inputDraftRevision: number;
  }) => void = () => {};
  const handler = vi.fn(
    (_command: RemoteCommand, _signal?: AbortSignal) =>
      new Promise<{ requestId: string; ok: boolean; inputDraftRevision: number }>((resolve) => {
        finish = resolve;
      }),
  );
  const { service, origin } = await start(handler);
  service.updateSnapshot(snapshot());
  const phone = await pair(service, origin);
  const command = {
    requestId: 'old-session-draft',
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
    action: 'set-draft',
    text: 'Old session text',
    expectedRevision: 0,
  };
  phone.send({ type: 'command', command });
  await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  service.updateSnapshot({
    ...snapshot(2),
    sessionEpoch: 2,
    inputDraft: { text: 'New session text', revision: 0, manual: false },
  });
  expect(handler.mock.calls[0][1]!.aborted).toBe(true);
  finish({ requestId: command.requestId, ok: true, inputDraftRevision: 1 });
  expect((await phone.next('result')).result.error).toBe('session-changed');
  phone.send({ type: 'command', command: { ...command, requestId: 'another-old-session-draft' } });
  expect((await phone.next('result')).result.error).toBe('session-changed');
  expect(handler).toHaveBeenCalledOnce();
});

it('sends transient scrolling only to the authenticated current session and never replays disconnected intents', async () => {
  const { service, origin, onCommand } = await start();
  expect(service.scroll('up')).toBe(false);
  const phone = await pair(service, origin);
  expect(service.scroll('up')).toBe(false);
  service.updateSnapshot(snapshot());
  await phone.next('snapshot');
  expect(service.scroll('up')).toBe(true);
  const first = await phone.next('scroll');
  expect(first).toMatchObject({
    direction: 'up',
    sessionId: 'temporary-interview',
    sessionEpoch: 1,
  });
  service.updateSnapshot({ ...snapshot(2), status: 'ended' });
  await phone.next('snapshot');
  expect(service.scroll('down')).toBe(false);
  service.updateSnapshot({ ...snapshot(3), sessionEpoch: 2 });
  await phone.next('snapshot');
  expect(service.scroll('down')).toBe(true);
  const second = await phone.next('scroll');
  expect(second.scrollId).toBeGreaterThan(first.scrollId);
  expect(second).toMatchObject({ direction: 'down', sessionEpoch: 2 });
  phone.client.terminate();
  await vi.waitFor(() => expect(service.state().status).toBe('reconnecting'));
  expect(service.scroll('up')).toBe(false);
  const resumed = await socket(origin);
  resumed.send({ type: 'resume', protocolVersion: REMOTE_PROTOCOL_VERSION, token: phone.token });
  await resumed.next('paired');
  expect(service.scroll('down')).toBe(true);
  const restored = await resumed.next('scroll');
  expect(restored.scrollId).toBeGreaterThan(second.scrollId);
  expect(restored.direction).toBe('down');
  expect(resumed.messages.filter((message) => message.type === 'scroll')).toHaveLength(0);
  expect(onCommand).not.toHaveBeenCalled();
});
