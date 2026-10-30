import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
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
  it('preserves corrupt queue bytes instead of overwriting unknown statistics', async () => {
    const f = await fixture();
    await f.service.close();
    await writeFile(path.join(f.root, telemetryQueueFile), 'corrupt synthetic data');
    const next = await fixture(undefined, f.root);
    next.service.activity('history_view');
    await next.service.flush();
    await next.service.close();
    expect(await readFile(path.join(f.root, telemetryQueueFile), 'utf8')).toBe(
      'corrupt synthetic data',
    );
  });
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
