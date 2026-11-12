import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Telemetry, telemetryRoute } from '../../electron/backend/telemetry/service';
import { receiptIds } from '../../electron/backend/telemetry/protocol';
import { TelemetryProofs } from '../../electron/backend/telemetry/identity';
import {
  TelemetryQueue,
  queueLimit,
  queueMaxAge,
  telemetryQueueFile,
} from '../../electron/backend/telemetry/queue';
import {
  validTelemetryEvent,
  validTelemetrySignal,
  type TelemetryEvent,
} from '../../electron/contracts/telemetry';

const capabilities = () =>
  Response.json({
    schemaVersion: 2,
    serverTime: Date.now(),
    versions: [2],
    anonymous: true,
    accountAttribution: 'event-time-ticket',
    receipt: 'per-event-terminal-rejections',
    limits: {
      batchEvents: 50,
      bodyBytes: 131072,
      pendingEvents: 2000,
      eventProofTtlMs: queueMaxAge,
      deliveryTtlMs: queueMaxAge,
    },
  });
const vaults = new Map<string, unknown>();
function grant(installationId: string, userId: string, now: number) {
  const issuedAt = Math.floor(now / 1000) * 1000,
    eventUntil = issuedAt + queueMaxAge,
    deliverUntil = eventUntil + queueMaxAge;
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return {
    schemaVersion: 2,
    issuedAt,
    eventUntil,
    deliverUntil,
    identityProof:
      part({ alg: 'HS256', typ: 'voxcue-telemetry+jwt' }) +
      '.' +
      part({
        iss: 'voxcue-account-server',
        aud: 'voxcue:telemetry-attribution:v2',
        sub: userId,
        installationId,
        iat: issuedAt / 1000,
        nbf: issuedAt / 1000 - 300,
        exp: deliverUntil / 1000,
        eventUntil,
      }) +
      '.' +
      'a'.repeat(43),
  };
}
const roots: string[] = [],
  services: Telemetry[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(
  fetcher?: typeof fetch,
  root?: string,
  enabled = true,
  options: Partial<ConstructorParameters<typeof Telemetry>[0]> = {},
) {
  root ??= await mkdtemp(path.join(os.tmpdir(), 'voxcue-telemetry-unit-'));
  if (!roots.includes(root)) roots.push(root);
  const clock = { wall: Date.UTC(2026, 9, 29), mono: 0 };
  const service = new Telemetry({
    root,
    version: '0.6.3',
    platform: 'macos',
    enabled,
    origin: 'https://accounts.example.test',
    fetcher: async (url, init) =>
      String(url).endsWith('/capabilities')
        ? capabilities()
        : fetcher
          ? fetcher(url, init)
          : new Response('', { status: 503 }),
    proofVault: {
      read: async () => vaults.get(root!) ?? null,
      write: async (value) => {
        vaults.set(root!, structuredClone(value));
      },
    },
    identityProvider: async (installationId, userId) => grant(installationId, userId, clock.wall),
    now: () => clock.wall,
    monotonic: () => clock.mono,
    ...options,
  });
  services.push(service);
  await service.settle();
  const advance = (ms: number) => {
    clock.wall += ms;
    clock.mono += ms;
  };
  const saved = async () => {
    await service.settle();
    return JSON.parse(await readFile(path.join(root!, telemetryQueueFile), 'utf8'));
  };
  return { service, root, clock, advance, saved };
}
const accepted = (body: any, ids = body.events.map((e: TelemetryEvent) => e.id)) =>
  Response.json({ schemaVersion: 2, acceptedIds: ids, rejected: [], healthAccepted: true });

describe('client statistics', () => {
  it.each(['negotiation', 'upload'])(
    'HTTP rejection during %s preserves events and backoff without waiting for cancellation',
    async (stage) => {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const transport = vi.fn(async (url) =>
        String(url).endsWith('/capabilities') && stage === 'upload'
          ? capabilities()
          : new Response(new ReadableStream({ cancel }), { status: 503 }),
      );
      const f = await fixture(undefined, undefined, true, { fetcher: transport });
      f.service.activity('history_view');
      const before = (await f.saved()).events;
      await f.service.flush();
      const saved = await f.saved();
      expect(saved.events).toEqual(before);
      expect(saved.nextAttemptAt).toBeGreaterThan(f.clock.wall);
      expect(cancel).toHaveBeenCalledOnce();
      expect(transport).toHaveBeenCalledTimes(stage === 'upload' ? 2 : 1);
    },
  );
  it.each([131071, 131072, 131073])(
    'requires the exact negotiated %i-byte body ceiling',
    async (bodyBytes) => {
      const upload = vi.fn(async (_url: unknown, init?: RequestInit) =>
        accepted(JSON.parse(init!.body as string)),
      );
      const f = await fixture(undefined, undefined, true, {
        fetcher: async (url, init) => {
          if (!String(url).endsWith('/capabilities')) return upload(url, init);
          const value = await capabilities().json();
          value.limits.bodyBytes = bodyBytes;
          return Response.json(value);
        },
      });
      f.service.activity('history_view');
      const id = (await f.saved()).events[0].id;
      await f.service.flush();
      expect(upload).toHaveBeenCalledTimes(bodyBytes === 131072 ? 1 : 0);
      expect((await f.saved()).events.map((event: TelemetryEvent) => event.id)).toEqual(
        bodyBytes === 131072 ? [] : [id],
      );
    },
  );
  it('retains the exact thirty-day boundary and drops it only once one millisecond later', async () => {
    const f = await fixture();
    f.service.activity('history_view');
    const event = (await f.saved()).events[0];
    await f.service.close();
    const queue = new TelemetryQueue(path.join(f.root, telemetryQueueFile));
    await queue.load(event.occurredAt + queueMaxAge);
    expect(queue.events.map((event) => event.id)).toEqual([event.id]);
    expect(queue.dropped).toBe(0);
    queue.prune(event.occurredAt + queueMaxAge + 1);
    await queue.save();
    const reopened = new TelemetryQueue(path.join(f.root, telemetryQueueFile));
    await reopened.load(event.occurredAt + queueMaxAge + 2);
    expect(reopened.events).toEqual([]);
    expect(reopened.dropped).toBe(1);
  });
  it('keeps fifty maximum-length valid attribution proofs below the full HTTP body ceiling', async () => {
    let bytes = 0;
    const f = await fixture(
      async (_url, init) => {
        bytes = Buffer.byteLength(init!.body as string);
        const body = JSON.parse(init!.body as string);
        expect(body.events).toHaveLength(50);
        expect(
          body.events.every(
            (event: { identityProof: string }) =>
              event.identityProof.length >= 1023 && event.identityProof.length <= 1024,
          ),
        ).toBe(true);
        return accepted(body);
      },
      undefined,
      true,
      {
        identityProvider: async (installationId, userId) => {
          const value = grant(installationId, userId, Date.UTC(2026, 9, 29));
          const [header, payload, signature] = value.identityProof.split('.');
          const json = Buffer.from(payload, 'base64url').toString('utf8');
          for (let padding = 1; padding < 768; padding++) {
            const proof =
              header +
              '.' +
              Buffer.from(json + ' '.repeat(padding)).toString('base64url') +
              '.' +
              signature;
            if (proof.length > 1024) break;
            value.identityProof = proof;
          }
          return value;
        },
      },
    );
    f.service.setIdentity({ accountMode: 'account', userId: randomUUID() });
    await f.service.settle();
    for (let index = 0; index < 50; index++) f.service.answer('chat').finish('success');
    expect((await f.saved()).events).toHaveLength(50);
    await f.service.flush();
    expect(bytes).toBeGreaterThanOrEqual(50 * 1023);
    expect(bytes).toBeLessThanOrEqual(131072);
    expect((await f.saved()).events).toEqual([]);
  });
  it('uses bounded exponential delays and both ends of the configured jitter interval', async () => {
    const random = vi.spyOn(Math, 'random');
    try {
      const initial: number[] = [];
      for (const value of [0, 1]) {
        random.mockReturnValue(value);
        const f = await fixture();
        f.service.activity('history_view');
        await f.service.flush();
        initial.push((await f.saved()).nextAttemptAt - f.clock.wall);
      }
      expect(initial).toEqual([96000, 144000]);
      random.mockReturnValue(0.5);
      const f = await fixture();
      f.service.activity('history_view');
      const id = (await f.saved()).events[0].id;
      for (const expected of [120000, 240000, 480000, 960000, 1920000, 3600000, 3600000]) {
        await f.service.flush();
        const disk = await f.saved();
        expect(disk.nextAttemptAt - f.clock.wall).toBe(expected);
        expect(disk.events[0].id).toBe(id);
        f.advance(expected);
      }
    } finally {
      random.mockRestore();
    }
  });
  it.each(['transcript', 'manual', 'answer'])(
    'requires two active minutes for the independent %s effective threshold',
    async (source) => {
      const f = await fixture();
      f.service.beginInterview();
      f.service.speechState('running');
      if (source === 'transcript') for (const id of ['a', 'b', 'c']) f.service.transcript(id);
      else if (source === 'manual') f.service.manualQuestion();
      else f.service.answer('interview').finish('success');
      f.advance(119999);
      f.service.speechState('paused');
      const before = (await f.saved()).active.data;
      expect(before.effective).toBe(false);
      f.service.speechState('running');
      f.advance(1);
      f.service.speechState('paused');
      const after = (await f.saved()).active.data;
      expect(after.activeMs).toBe(120000);
      expect(after.effective).toBe(true);
      expect(after.sequence).toBeGreaterThan(before.sequence);
    },
  );
  it('retains at most 128 encrypted proof entries without evicting referenced historical tickets', async () => {
    const now = Date.UTC(2026, 9, 29),
      installationId = randomUUID(),
      userId = randomUUID();
    let stored: any = null;
    const proofs = new TelemetryProofs({
      installationId,
      origin: 'https://accounts.example.test',
      now: () => now,
      vault: {
        read: async () => stored,
        write: async (value) => {
          stored = structuredClone(value);
        },
      },
      provider: async () => grant(installationId, userId, now),
    });
    await proofs.load();
    for (let index = 0; index < 129; index++) await proofs.warm(userId, true);
    expect(stored.tickets).toHaveLength(128);
    const oldest = stored.tickets[0];
    expect(proofs.proof(oldest.id, now)).toBe(oldest.identityProof);
    await proofs.prune(new Set([oldest.id]), new Set([userId]));
    expect(stored.tickets).toHaveLength(2);
    expect(proofs.proof(oldest.id, now)).toBe(oldest.identityProof);
    await proofs.close();
  });
  it('drops an event when a delayed proof starts beyond its historical coverage instead of reattributing it', async () => {
    let release!: (value: unknown) => void;
    let binding!: [string, string];
    const f = await fixture(undefined, undefined, true, {
      identityProvider: async (installationId, userId) => {
        binding = [installationId, userId];
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    f.service.setIdentity({ accountMode: 'account', userId: randomUUID() });
    f.service.activity('history_view');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.advance(301000);
    release(grant(...binding, f.clock.wall));
    const disk = await f.saved();
    expect(disk.events).toEqual([]);
    expect(disk.dropped).toBe(1);
    expect(disk.lastFailure).toBe('identity_unverifiable');
  });
  it('ignores a late identity result after close and cannot recreate cleared credential or queue files', async () => {
    let release!: (value: unknown) => void;
    let binding!: [string, string];
    const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-telemetry-unit-'));
    roots.push(root);
    const proofFile = path.join(root, 'synthetic-proof-storage.json');
    const f = await fixture(undefined, root, true, {
      proofVault: {
        read: async () => null,
        write: async (value) => {
          await writeFile(proofFile, JSON.stringify(value));
        },
      },
      identityProvider: async (installationId, userId) => {
        binding = [installationId, userId];
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    f.service.setIdentity({ accountMode: 'account', userId: randomUUID() });
    f.service.activity('history_view');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await f.service.close();
    await rm(path.join(root, telemetryQueueFile));
    release(grant(...binding, f.clock.wall));
    await new Promise((resolve) => setImmediate(resolve));
    for (const file of [proofFile, path.join(root, telemetryQueueFile)])
      await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects proof algorithm, purpose, issuer, account, installation and time-window substitution', async () => {
    const now = Date.UTC(2026, 9, 29),
      installationId = randomUUID(),
      userId = randomUUID();
    for (const change of [
      (header: any) => {
        header.alg = 'none';
      },
      (header: any) => {
        header.typ = 'JWT';
      },
      (_header: any, payload: any) => {
        payload.iss = 'other';
      },
      (_header: any, payload: any) => {
        payload.aud = 'other';
      },
      (_header: any, payload: any) => {
        payload.sub = randomUUID();
      },
      (_header: any, payload: any) => {
        payload.installationId = randomUUID();
      },
      (_header: any, payload: any) => {
        payload.iat++;
      },
      (_header: any, payload: any) => {
        payload.nbf++;
      },
      (_header: any, payload: any) => {
        payload.exp++;
      },
      (_header: any, payload: any) => {
        payload.eventUntil++;
      },
      (_header: any, _payload: any, raw: any) => {
        raw.eventUntil = now - 1;
      },
    ]) {
      const raw = grant(installationId, userId, now);
      const parts = raw.identityProof.split('.');
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      change(header, payload, raw);
      raw.identityProof =
        [header, payload]
          .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
          .join('.') +
        '.' +
        parts[2];
      const write = vi.fn();
      const proofs = new TelemetryProofs({
        installationId,
        origin: 'https://accounts.example.test',
        now: () => now,
        vault: { read: async () => null, write },
        provider: async () => raw,
      });
      await proofs.load();
      await proofs.warm(userId);
      expect(proofs.find(userId, now)).toBeUndefined();
      expect(write).not.toHaveBeenCalled();
      await proofs.close();
    }
  });
  it.each([400, 413, 415, 422])(
    'retains an HTTP %i batch and persists the full 24-hour backoff',
    async (status) => {
      const transport = vi.fn(async () => new Response('', { status }));
      const f = await fixture(transport);
      f.service.activity('history_view');
      const id = (await f.saved()).events[0].id;
      await f.service.flush();
      const disk = await f.saved();
      expect(disk.events[0].id).toBe(id);
      expect(disk.nextAttemptAt).toBe(f.clock.wall + 86400000);
      await f.service.close();
      const restarted = await fixture(transport, f.root);
      await restarted.service.flush();
      expect(transport).toHaveBeenCalledOnce();
    },
  );
  it.each(['seconds', 'date'])(
    'honours Retry-After %s without changing event IDs',
    async (format) => {
      const f = await fixture(
        async () =>
          new Response('', {
            status: 429,
            headers: {
              'retry-after':
                format === 'seconds' ? '1800' : new Date(f.clock.wall + 1800000).toUTCString(),
            },
          }),
      );
      f.service.activity('history_view');
      const id = (await f.saved()).events[0].id;
      await f.service.flush();
      const disk = await f.saved();
      expect(disk.nextAttemptAt).toBeGreaterThanOrEqual(f.clock.wall + 1800000);
      expect(disk.events[0].id).toBe(id);
    },
  );
  it.each(['exact', 'oversize', 'truncated'])(
    'handles the %s 16-KiB response boundary without guessing acknowledgement',
    async (kind) => {
      const f = await fixture(async (_url, init) => {
        const body = JSON.parse(init!.body as string);
        const receipt = JSON.stringify({
          schemaVersion: 2,
          healthAccepted: true,
          acceptedIds: [body.events[0].id],
          rejected: [],
        });
        return new Response(
          kind === 'truncated'
            ? receipt.slice(0, -1)
            : receipt +
                ' '.repeat(16384 - Buffer.byteLength(receipt) + (kind === 'oversize' ? 1 : 0)),
        );
      });
      f.service.activity('history_view');
      await f.service.flush();
      expect((await f.saved()).events).toHaveLength(kind === 'exact' ? 0 : 1);
    },
  );
  it('aborts an actual stalled upload at eight seconds and retains its original event', async () => {
    const capabilityBody = await capabilities().text();
    let uploads = 0,
      disconnected = false;
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url?.endsWith('/capabilities')) response.end(capabilityBody);
      else {
        uploads++;
        request.resume();
        response.write('{"schemaVersion":2,');
        response.once('close', () => {
          disconnected = true;
        });
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const port = (server.address() as { port: number }).port;
      const f = await fixture(undefined, undefined, true, {
        origin: 'http://127.0.0.1:' + port,
        fetcher: fetch,
      });
      f.service.activity('history_view');
      const started = performance.now();
      await f.service.flush();
      expect(performance.now() - started).toBeGreaterThanOrEqual(7900);
      expect((await f.saved()).events).toHaveLength(1);
      expect((await f.saved()).failures).toBe(1);
      expect(uploads).toBe(1);
      await vi.waitFor(() => expect(disconnected).toBe(true));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15000);
  it('preserves an invalid persisted attempt counter and disables transmission instead of resetting it', async () => {
    const f = await fixture();
    const disk = await f.saved();
    await f.service.close();
    const original = JSON.stringify({ ...disk, attempts: Number.MAX_SAFE_INTEGER + 1 });
    await writeFile(path.join(f.root, telemetryQueueFile), original);
    const transport = vi.fn();
    const next = await fixture(transport, f.root);
    next.service.activity('history_view');
    await next.service.flush();
    await next.service.close();
    expect(transport).not.toHaveBeenCalled();
    expect(await readFile(path.join(f.root, telemetryQueueFile), 'utf8')).toBe(original);
  });
  it.each(['sequence', 'attempts'])(
    'fails closed at the safe-integer %s limit without rotating installation',
    async (field) => {
      const f = await fixture();
      const disk = await f.saved();
      await f.service.close();
      const installationFile = path.join(f.root, 'telemetry-installation.json');
      const installation = JSON.parse(await readFile(installationFile, 'utf8'));
      if (field === 'sequence') installation.sequence = Number.MAX_SAFE_INTEGER;
      else disk.attempts = Number.MAX_SAFE_INTEGER;
      await writeFile(installationFile, JSON.stringify(installation));
      await writeFile(path.join(f.root, telemetryQueueFile), JSON.stringify(disk));
      const transport = vi.fn();
      const next = await fixture(transport, f.root);
      next.service.activity('history_view');
      await next.service.flush();
      expect(transport).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(installationFile, 'utf8'))).toEqual(installation);
    },
  );
  it('bounds actual batches at fifty while preserving all IDs across successive durable uploads', async () => {
    const bodies: any[] = [];
    const f = await fixture(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      expect(Buffer.byteLength(init!.body as string)).toBeLessThanOrEqual(131072);
      const disk = JSON.parse(await readFile(path.join(f.root, telemetryQueueFile), 'utf8'));
      expect(
        body.events.every((event: TelemetryEvent) =>
          disk.events.some((row: TelemetryEvent) => row.id === event.id),
        ),
      ).toBe(true);
      bodies.push(body);
      return accepted(body);
    });
    for (let index = 0; index < 121; index++) f.service.answer('chat').finish('success');
    const ids = (await f.saved()).events.map((event: TelemetryEvent) => event.id);
    for (let index = 0; index < 3; index++) {
      await f.service.flush();
      f.advance(30000);
    }
    expect(bodies.map((body) => body.events.length)).toEqual([50, 50, 21]);
    expect(bodies.flatMap((body) => body.events.map((event: TelemetryEvent) => event.id))).toEqual(
      ids,
    );
    expect((await f.saved()).events).toEqual([]);
  });
  it('bounds pending account records behind a stalled credential request and counts overload explicitly', async () => {
    let release!: (value: unknown) => void;
    let binding!: [string, string];
    const provider = vi.fn((installationId: string, userId: string) => {
      binding = [installationId, userId];
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const f = await fixture(undefined, undefined, true, { identityProvider: provider });
    f.service.setIdentity({ accountMode: 'account', userId: randomUUID() });
    for (let index = 0; index < 2500; index++) f.service.answer('chat').finish('success');
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    release(grant(...binding, f.clock.wall));
    const disk = await f.saved();
    expect(disk.events).toHaveLength(2000);
    expect(disk.dropped).toBe(500);
    expect(provider).toHaveBeenCalledOnce();
  });
  it('does not count a rejected in-flight ID twice after queue-capacity eviction', async () => {
    const original = await fixture();
    original.service.activity('history_view');
    const disk = await original.saved();
    await original.service.close();
    disk.events = Array.from({ length: 2000 }, () => ({ ...disk.events[0], id: randomUUID() }));
    await writeFile(path.join(original.root, telemetryQueueFile), JSON.stringify(disk));
    let finish!: (response: Response) => void;
    let body: any;
    const f = await fixture(async (_url, init) => {
      body = JSON.parse(init!.body as string);
      return new Promise((resolve) => {
        finish = resolve;
      });
    }, original.root);
    const uploading = f.service.flush();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    f.service.answer('chat').finish('success');
    expect((await f.saved()).dropped).toBe(1);
    finish(
      Response.json({
        schemaVersion: 2,
        healthAccepted: true,
        acceptedIds: [],
        rejected: [{ index: 0, id: body.events[0].id, code: 'invalid_event' }],
      }),
    );
    await uploading;
    expect((await f.saved()).dropped).toBe(1);
  });
  it('C047 rejects coerced categories, out-of-range dates and inconsistent session semantics', async () => {
    const f = await fixture();
    f.service.activity('history_view');
    const e = (await f.saved()).events[0];
    for (const field of ['platform', 'accountMode'])
      for (const bad of [[e[field]], { toString: () => e[field] }, null, 1, true])
        expect(validTelemetryEvent({ ...e, [field]: bad })).toBe(false);
    for (const field of ['firstSeenAt', 'occurredAt'])
      for (const bad of [8640000000000001, NaN, Infinity, -1, 1.5, '0'])
        expect(validTelemetryEvent({ ...e, [field]: bad })).toBe(false);
    for (const data of [
      { type: 'account_entry', method: ['local'] },
      { type: 'interview_started', interviewId: randomUUID(), startedAt: 8640000000000001 },
      {
        type: 'ai_request',
        requestId: randomUUID(),
        context: ['chat'],
        outcome: 'success',
        elapsedMs: 0,
      },
      {
        type: 'ai_request',
        requestId: randomUUID(),
        context: 'chat',
        outcome: ['success'],
        elapsedMs: 0,
      },
      { type: 'account_entry', method: 'login' },
    ])
      expect(validTelemetryEvent({ ...e, accountMode: 'local', data })).toBe(false);
    const snapshot = {
      type: 'interview_progress',
      interviewId: randomUUID(),
      startedAt: null,
      activeMs: 0,
      transcriptCount: 0,
      manualQuestionCount: 0,
      answerCount: 0,
      sequence: 1,
      effective: false,
    };
    expect(validTelemetryEvent({ ...e, data: snapshot })).toBe(true);
    expect(validTelemetryEvent({ ...e, data: { ...snapshot, activeMs: 1 } })).toBe(false);
    expect(validTelemetryEvent({ ...e, data: { ...snapshot, effective: true } })).toBe(false);
    expect(validTelemetryEvent({ ...e, userId: randomUUID() })).toBe(false);
    const started = {
      ...snapshot,
      startedAt: e.occurredAt,
      activeMs: 120000,
      manualQuestionCount: 1,
      effective: true,
    };
    const legal = [
      { ...e, data: { type: 'account_entry', method: 'local' }, accountMode: 'local' },
      {
        ...e,
        data: {
          type: 'ai_request',
          requestId: randomUUID(),
          context: 'chat',
          outcome: 'success',
          elapsedMs: 1,
        },
      },
      {
        ...e,
        data: { ...started, type: 'interview_ended', outcome: 'completed', stage: 'storage' },
      },
      { ...e, data: { type: 'feature', feature: 'history_view' } },
    ];
    for (const event of legal) {
      expect(validTelemetryEvent(event)).toBe(true);
      for (const field of ['type', 'method', 'context', 'outcome', 'stage', 'feature']) {
        if (!(field in event.data)) continue;
        const value = (event.data as Record<string, unknown>)[field];
        for (const bad of [[value], { toString: () => value }, null, true, 1])
          expect(validTelemetryEvent({ ...event, data: { ...event.data, [field]: bad } })).toBe(
            false,
          );
      }
    }
    for (const data of [
      { ...started, startedAt: e.occurredAt + 300001 },
      { ...started, startedAt: e.firstSeenAt - 300001 },
      { ...started, effective: false },
      { ...snapshot, type: 'interview_ended', outcome: 'completed' },
    ])
      expect(validTelemetryEvent({ ...e, data })).toBe(false);
    expect(validTelemetryEvent({ ...e, firstSeenAt: e.occurredAt + 300001 })).toBe(false);
    expect(
      validTelemetryEvent({ ...e, firstSeenAt: 8640000000000000, occurredAt: 8640000000000000 }),
    ).toBe(true);
    expect(
      validTelemetryEvent({
        ...e,
        platform: 'windows',
        data: { type: 'feature', feature: 'history_view' },
      }),
    ).toBe(true);
  });
  it('validates receipt indexes and disjoint IDs atomically, accepting terminal-only and partial receipts', async () => {
    const f = await fixture();
    f.service.activity('history_view');
    f.service.activity('knowledge_view');
    const events = (await f.saved()).events;
    const base = { schemaVersion: 2, healthAccepted: true, acceptedIds: [], rejected: [] };
    expect(
      receiptIds(
        { ...base, rejected: [{ index: 0, id: events[0].id, code: 'invalid_event' }] },
        events,
      ).rejected.size,
    ).toBe(1);
    expect(receiptIds({ ...base, acceptedIds: [events[0].id] }, events).accepted.size).toBe(1);
    for (const acceptedIds of [[randomUUID()], [events[0].id, events[0].id]])
      expect(() => receiptIds({ ...base, acceptedIds }, events)).toThrow();
    for (const rejected of [
      [{ index: -1, code: 'invalid_event' }],
      [{ index: '0', code: 'invalid_event' }],
      [{ index: 0, id: events[1].id, code: 'invalid_event' }],
      [{ index: 0, code: 'retry_later' }],
      [
        { index: 0, code: 'invalid_event' },
        { index: 0, code: 'invalid_event' },
      ],
    ])
      expect(() => receiptIds({ ...base, rejected }, events)).toThrow();
    expect(() =>
      receiptIds(
        { ...base, acceptedIds: [events[0].id], rejected: [{ index: 0, code: 'invalid_event' }] },
        events,
      ),
    ).toThrow();
  });
  it('uses only opaque disk references and retains the original account proof after logout/switch', async () => {
    let wire: any;
    const f = await fixture(async (_url, init) => {
      wire = JSON.parse(init!.body as string);
      return accepted(wire);
    });
    const a = randomUUID(),
      b = randomUUID();
    f.service.setIdentity({ accountMode: 'account', userId: a });
    f.service.activity('history_view');
    await f.service.settle();
    f.service.setIdentity({ accountMode: 'account', userId: b });
    f.service.activity('knowledge_view');
    await f.service.settle();
    f.service.setIdentity({ accountMode: 'local' });
    const disk = await f.saved();
    expect(disk.events).toHaveLength(2);
    expect(JSON.stringify(disk)).not.toMatch(/identityProof|accessToken|userId/);
    expect(disk.events[0].identityRef).not.toBe(disk.events[1].identityRef);
    await f.service.flush();
    const subjects = wire.events.map(
      (e: any) =>
        JSON.parse(Buffer.from(e.identityProof.split('.')[1], 'base64url').toString()).sub,
    );
    expect(subjects).toEqual([a, b]);
    expect(JSON.stringify(wire)).not.toMatch(/identityRef|userId|accessToken/);
  });
  it('persists global sequence beyond queue/counter deletion and counts terminal rejections', async () => {
    const sequences: number[] = [];
    const f = await fixture(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      sequences.push(body.health.sequence);
      return Response.json({
        schemaVersion: 2,
        acceptedIds: [],
        healthAccepted: true,
        rejected: body.events.map((e: any, index: number) => ({
          index,
          id: e.id,
          code: 'invalid_event',
        })),
      });
    });
    f.service.activity('history_view');
    await f.service.flush();
    expect((await f.saved()).events).toHaveLength(0);
    expect((await f.saved()).dropped).toBe(1);
    await f.service.close();
    await rm(path.join(f.root, telemetryQueueFile));
    const next = await fixture(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      sequences.push(body.health.sequence);
      return accepted(body);
    }, f.root);
    next.service.activity('history_view');
    await next.service.flush();
    expect(sequences).toEqual([1, 2]);
  });
  it('migrates anonymous records without inventing historical account attribution', async () => {
    const f = await fixture();
    f.service.activity('history_view');
    const sample = (await f.saved()).events[0];
    await f.service.close();
    await writeFile(
      path.join(f.root, telemetryQueueFile),
      JSON.stringify({
        schemaVersion: 1,
        events: [
          { ...sample, schemaVersion: 1 },
          {
            ...sample,
            schemaVersion: 1,
            id: randomUUID(),
            accountMode: 'account',
            userId: randomUUID(),
          },
        ],
      }),
    );
    const next = await fixture(undefined, f.root);
    const disk = await next.saved();
    expect(disk.events).toHaveLength(1);
    expect(disk.events[0].id).toBe(sample.id);
    expect(disk.events[0].schemaVersion).toBe(2);
    expect(disk.dropped).toBe(1);
  });
  it('fails closed on unavailable encrypted storage, and bounds proof acquisition during shutdown', async () => {
    const f = await fixture();
    const unavailable = await fixture(undefined, undefined, true, {
      proofVault: {
        read: async () => null,
        write: async () => {
          throw Error('encryption unavailable');
        },
      },
    });
    unavailable.service.setIdentity({ accountMode: 'account', userId: randomUUID() });
    unavailable.service.activity('history_view');
    const rejected = await unavailable.saved();
    expect(rejected.events).toHaveLength(0);
    expect(rejected.dropped).toBe(1);
    expect(rejected.lastFailure).toBe('identity_unverifiable');
    let started!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    const proofs = new TelemetryProofs({
      installationId: randomUUID(),
      origin: 'https://accounts.example.test',
      now: () => f.clock.wall,
      vault: {
        read: async () => null,
        write: async () => {
          throw Error('encryption unavailable');
        },
      },
      provider: async () => {
        started();
        return new Promise(() => {});
      },
    });
    await proofs.load();
    const work = proofs.warm(randomUUID());
    await entered;
    await proofs.close();
    await work;
    expect(proofs.proof(randomUUID(), f.clock.wall)).toBeUndefined();
  });
  it('keeps attribution for an unfinished request while acknowledged events are compacted after logout', async () => {
    const f = await fixture(async (_url, init) => accepted(JSON.parse(init!.body as string)));
    f.service.setIdentity({ accountMode: 'account', userId: randomUUID() });
    f.service.activity('history_view');
    await f.service.settle();
    const ref = (await f.saved()).events[0].identityRef;
    const answer = f.service.answer('chat');
    f.service.setIdentity({ accountMode: 'local' });
    await f.service.flush();
    answer.finish('success');
    expect(
      (await f.saved()).events.find((e: TelemetryEvent) => e.data.type === 'ai_request')
        .identityRef,
    ).toBe(ref);
    expect((await f.saved()).dropped).toBe(0);
  });
  it('negotiates once, never falls back to v1, and persists unsupported-protocol backoff', async () => {
    const transport = vi.fn(async () => Response.json({ schemaVersion: 1 }));
    const f = await fixture(undefined, undefined, true, { fetcher: transport });
    f.service.activity('history_view');
    await f.service.flush();
    await f.service.flush();
    expect(transport).toHaveBeenCalledOnce();
    expect(String(transport.mock.calls[0][0])).toContain('/v2/telemetry/capabilities');
    expect((await f.saved()).nextAttemptAt).toBeGreaterThanOrEqual(f.clock.wall + 86400000);
    await f.service.close();
    const next = await fixture(undefined, f.root, true, { fetcher: transport });
    await next.service.flush();
    expect(transport).toHaveBeenCalledOnce();
  });
  it('counts an unverifiable legacy account checkpoint once without rebinding or inventing an event', async () => {
    const f = await fixture();
    f.service.beginInterview();
    f.service.speechState('running');
    const saved = await f.saved();
    await f.service.close();
    await writeFile(
      path.join(f.root, telemetryQueueFile),
      JSON.stringify({
        ...saved,
        schemaVersion: 1,
        events: [],
        active: { ...saved.active, schemaVersion: 1, accountMode: 'account', userId: randomUUID() },
      }),
    );
    const next = await fixture(undefined, f.root);
    const disk = await next.saved();
    expect(disk.events).toEqual([]);
    expect(disk.active).toBeUndefined();
    expect(disk.dropped).toBe(1);
    expect(disk.lastFailure).toBe('legacy_unverifiable');
    await next.service.close();
    const restarted = await fixture(undefined, f.root);
    expect((await restarted.saved()).dropped).toBe(1);
  });
  it.each(['corrupt', 'oversize'])(
    'preserves %s queue bytes instead of overwriting unknown statistics',
    async (kind) => {
      const f = await fixture();
      await f.service.close();
      const original =
        kind === 'corrupt' ? 'corrupt synthetic data' : ' '.repeat(4 * 1024 * 1024 + 1);
      await writeFile(path.join(f.root, telemetryQueueFile), original);
      const next = await fixture(undefined, f.root);
      next.service.activity('history_view');
      await next.service.flush();
      await next.service.close();
      expect(await readFile(path.join(f.root, telemetryQueueFile), 'utf8')).toBe(original);
    },
  );
  it('records an unfinished AI request as cancelled during shutdown and ignores late success', async () => {
    const f = await fixture();
    const pending = f.service.answer('chat');
    f.advance(1500);
    await f.service.close();
    pending.finish('success');
    const rows: TelemetryEvent[] = JSON.parse(
      await readFile(path.join(f.root, telemetryQueueFile), 'utf8'),
    ).events;
    expect(rows.filter((e) => e.data.type === 'ai_request').map((e) => e.data)).toMatchObject([
      { context: 'chat', outcome: 'cancelled', elapsedMs: 1500 },
    ]);
  });
  it('preserves activity across a non-UTC reporting midnight within the throttle window', async () => {
    const f = await fixture();
    f.clock.wall = Date.UTC(2026, 9, 29, 15, 59, 50);
    f.service.activity('history_view');
    f.advance(20000); // UTC+8 midnight; still the same UTC day.
    f.service.activity('history_view');
    expect(
      (await f.saved()).events.filter((e: TelemetryEvent) => e.data.type === 'feature'),
    ).toHaveLength(2);
  });
  it('uploads only one batch at a time and reports an empty queue once after acknowledged drain', async () => {
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finish!: (response: Response) => void;
    let body: any;
    const transport = vi.fn(async (_url: any, init: any) => {
      body = JSON.parse(init.body);
      if (body.events.length) {
        release();
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return accepted(body);
    }) as unknown as typeof fetch;
    const f = await fixture(transport);
    f.service.activity('history_view');
    const first = f.service.flush();
    await entered;
    const overlapping = f.service.flush();
    expect(transport).toHaveBeenCalledOnce();
    finish(accepted(body));
    await Promise.all([first, overlapping]);
    expect((await f.saved()).events).toHaveLength(0);
    f.advance(30000);
    await f.service.flush();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(body.events).toEqual([]);
    expect(body.health.pendingEvents).toBe(0);
    f.advance(30000);
    await f.service.flush();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('shutdown aborts transport and cannot recreate an erased queue through a late network completion', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const transport = vi.fn(async (_url: any, init: any) => {
      entered();
      return new Promise<Response>((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
      );
    }) as unknown as typeof fetch;
    const f = await fixture(transport);
    f.service.activity('history_view');
    const uploading = f.service.flush();
    await started;
    await f.service.close();
    await rm(path.join(f.root, telemetryQueueFile));
    await uploading;
    await expect(readFile(path.join(f.root, telemetryQueueFile))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('keeps one installation across local/account/restart, preserves event-time identities and excludes startup from active use', async () => {
    const f = await fixture();
    f.service.setIdentity({ accountMode: 'local' });
    f.service.usable();
    f.service.usable();
    f.service.entry('local');
    f.service.entry('local');
    f.service.activity('history_view');
    f.service.activity('history_view');
    const userId = randomUUID();
    f.service.setIdentity({ accountMode: 'account', userId });
    f.service.entry('register', f.clock.wall);
    f.service.activity('history_view');
    const rows: TelemetryEvent[] = (await f.saved()).events;
    expect(rows.filter((e) => e.data.type === 'app_ready')).toHaveLength(1);
    expect(rows.filter((e) => e.data.type === 'feature')).toHaveLength(2);
    expect(rows.every(validTelemetryEvent)).toBe(true);
    expect(
      rows.filter((e) => e.accountMode === 'local').every((e) => e.identityRef === undefined),
    ).toBe(true);
    expect(
      rows
        .filter((e) => e.accountMode === 'account')
        .every((e) => typeof e.identityRef === 'string' && !('userId' in e)),
    ).toBe(true);
    expect(rows.filter((e) => e.data.type === 'account_entry')).toHaveLength(2);
    await f.service.close();
    const next = await fixture(undefined, f.root);
    next.service.setIdentity({ accountMode: 'account', userId });
    next.service.entry('restore');
    next.service.usable();
    const all: TelemetryEvent[] = (await next.saved()).events;
    expect(new Set(all.map((e) => e.installationId)).size).toBe(1);
    expect(new Set(all.map((e) => e.firstSeenAt)).size).toBe(1);
    expect(new Set(all.map((e) => e.runId)).size).toBe(2);
  });
  it('starts only on running, excludes preflight/pause/sleep, deduplicates final segments and keeps absolute effective-session snapshots', async () => {
    const f = await fixture();
    f.service.beginInterview();
    f.advance(10000);
    f.service.speechState('loading');
    expect(
      (await f.saved()).events.some((e: TelemetryEvent) => e.data.type === 'interview_started'),
    ).toBe(false);
    f.service.speechState('running');
    f.service.speechState('running');
    for (const id of ['a', 'a', 'b', 'c']) f.service.transcript(id);
    f.advance(60000);
    f.service.speechState('paused');
    f.advance(3600000);
    f.service.speechState('running');
    f.advance(60000);
    f.service.suspend(true);
    f.advance(8 * 3600000);
    f.service.suspend(false);
    f.advance(1000);
    f.service.saved(true);
    f.service.finishInterview(true);
    f.service.finishInterview(true);
    const rows: TelemetryEvent[] = (await f.saved()).events;
    expect(rows.filter((e) => e.data.type === 'interview_started')).toHaveLength(1);
    const ends = rows.filter((e) => e.data.type === 'interview_ended');
    expect(ends).toHaveLength(1);
    expect(ends[0].data).toMatchObject({
      outcome: 'completed',
      activeMs: 121000,
      transcriptCount: 3,
      effective: true,
    });
  });
  it('separates failed attempts, storage failures and cancelled AI requests, measuring first visible text once', async () => {
    const f = await fixture();
    f.service.beginInterview();
    f.service.audioFailed();
    f.service.beginInterview();
    f.service.speechState('running');
    f.service.manualQuestion();
    const a = f.service.answer('interview');
    f.advance(400);
    a.first();
    f.advance(200);
    a.first();
    f.advance(400);
    a.finish('success');
    a.finish('failure');
    const b = f.service.answer('interview');
    f.advance(100);
    b.finish('cancelled');
    f.advance(120000);
    f.service.saved(false);
    f.service.finishInterview(true);
    const rows: TelemetryEvent[] = (await f.saved()).events;
    expect(rows.filter((e) => e.data.type === 'interview_ended').map((e) => e.data)).toMatchObject([
      { outcome: 'failed', stage: 'audio', startedAt: null },
      {
        outcome: 'failed',
        stage: 'storage',
        manualQuestionCount: 1,
        answerCount: 1,
        effective: true,
      },
    ]);
    expect(rows.filter((e) => e.data.type === 'ai_request').map((e) => e.data)).toMatchObject([
      { context: 'interview', outcome: 'success', firstAnswerMs: 400, elapsedMs: 1000 },
      { outcome: 'cancelled', elapsedMs: 100 },
    ]);
  });
  it('recovers a crashed session using its old identity and last checkpoint, never counting downtime', async () => {
    const f = await fixture();
    f.service.setIdentity({ accountMode: 'local' });
    f.service.beginInterview();
    f.service.speechState('running');
    f.advance(120000);
    f.service.manualQuestion();
    f.service.speechState('paused');
    const checkpoint = await f.saved();
    await f.service.close();
    await writeFile(path.join(f.root, telemetryQueueFile), JSON.stringify(checkpoint));
    const restarted = await fixture(undefined, f.root);
    const rows: TelemetryEvent[] = (await restarted.saved()).events;
    const end = rows.find((e) => e.data.type === 'interview_ended');
    expect(end).toMatchObject({
      accountMode: 'local',
      occurredAt: checkpoint.active.occurredAt,
      runId: checkpoint.active.runId,
      data: { outcome: 'interrupted', stage: 'process', activeMs: 120000, effective: true },
    });
    expect((await restarted.saved()).active).toBeUndefined();
  });
  it('durably stores batches before upload, removes only acknowledged IDs and sends no credentials', async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    const transport = vi.fn(async (url: any, init: any) => {
      expect(url).toBe('https://accounts.example.test' + telemetryRoute);
      expect(init).toMatchObject({
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
      });
      expect(init.headers.authorization).toBeUndefined();
      const body = JSON.parse(init.body);
      const disk = JSON.parse(await readFile(path.join(f.root, telemetryQueueFile), 'utf8'));
      expect(disk.events.map((e: TelemetryEvent) => e.id)).toEqual(
        body.events.map((e: TelemetryEvent) => e.id),
      );
      expect(body.events.every(validTelemetryEvent)).toBe(true);
      return accepted(body, [body.events[0].id]);
    }) as unknown as typeof fetch;
    f = await fixture(transport);
    f.service.setIdentity({ accountMode: 'local' });
    f.service.entry('local');
    f.service.activity('history_view');
    await f.service.flush();
    expect((await f.saved()).events).toHaveLength(1);
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each([404, 405, 501])(
    'old server %i retains events and backs off across restarts',
    async (status) => {
      const transport = vi.fn(async () => new Response('', { status })) as unknown as typeof fetch;
      const f = await fixture(transport);
      f.service.activity('history_view');
      await f.service.flush();
      const before = await f.saved();
      expect(before.failures).toBe(1);
      expect(before.nextAttemptAt).toBeGreaterThanOrEqual(f.clock.wall + 86400000);
      await f.service.flush();
      expect(transport).toHaveBeenCalledOnce();
      await f.service.close();
      const next = await fixture(transport, f.root);
      await next.service.flush();
      expect(transport).toHaveBeenCalledOnce();
      expect((await next.saved()).events[0].id).toBe(before.events[0].id);
    },
  );
  it.each(['missing', 'foreign', 'oversize', 'network'])(
    'never loses events on %s acknowledgement/transport failure',
    async (kind) => {
      const transport = vi.fn(async () => {
        if (kind === 'network') throw Error('synthetic failure');
        if (kind === 'oversize') return new Response('x'.repeat(16385));
        return Response.json(
          kind === 'foreign' ? { schemaVersion: 1, acceptedIds: [randomUUID()] } : {},
        );
      }) as unknown as typeof fetch;
      const f = await fixture(transport);
      f.service.activity('history_view');
      await f.service.flush();
      expect((await f.saved()).events).toHaveLength(1);
      expect((await f.saved()).failures).toBe(1);
    },
  );
  it('has no disk or transport effects when disabled and rejects content/identity injection', async () => {
    const transport = vi.fn() as unknown as typeof fetch;
    const f = await fixture(transport, undefined, false);
    f.service.usable();
    f.service.activity('history_view');
    await f.service.flush();
    await expect(readFile(path.join(f.root, telemetryQueueFile))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(transport).not.toHaveBeenCalled();
    for (const signal of [
      { type: 'ready', email: 'private@example.test' },
      { type: 'feature', feature: 'private text' },
      { type: 'feature', feature: 'history_view', userId: randomUUID() },
      { type: 'interview_saved', saved: 'true' },
    ])
      expect(validTelemetrySignal(signal)).toBe(false);
    expect(validTelemetrySignal({ type: 'feature', feature: 'history_view' })).toBe(true);
  });
  it('bounds queue/disk use, retains terminal events ahead of progress and expires old records', async () => {
    const f = await fixture();
    f.service.activity('history_view');
    const sample: TelemetryEvent = (await f.saved()).events[0];
    const queue = new TelemetryQueue(path.join(f.root, 'bounded.json'));
    queue.add({ ...sample, id: randomUUID(), data: { type: 'account_entry', method: 'local' } });
    for (let i = 0; i < queueLimit + 25; i++) queue.add({ ...sample, id: randomUUID() });
    expect(queue.events).toHaveLength(queueLimit);
    expect(queue.dropped).toBe(26);
    expect(queue.events[0].data.type).toBe('account_entry');
    await Promise.all([queue.save(), queue.save(), queue.save()]);
    const loaded = new TelemetryQueue(path.join(f.root, 'bounded.json'));
    await loaded.load(f.clock.wall + queueMaxAge + 1);
    expect(loaded.events).toHaveLength(0);
    expect(loaded.dropped).toBeGreaterThanOrEqual(queueLimit);
    expect(
      validTelemetryEvent({
        ...sample,
        data: { type: 'feature', feature: 'history_view', text: 'private' },
      }),
    ).toBe(false);
  });
});
