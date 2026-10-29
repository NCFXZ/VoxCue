import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Telemetry, telemetryRoute } from '../../electron/backend/telemetry/service';
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

const roots: string[] = [],
  services: Telemetry[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(fetcher?: typeof fetch, root?: string, enabled = true) {
  root ??= await mkdtemp(path.join(os.tmpdir(), 'voxcue-telemetry-unit-'));
  if (!roots.includes(root)) roots.push(root);
  const clock = { wall: Date.UTC(2026, 9, 29), mono: 0 };
  const service = new Telemetry({
    root,
    version: '0.6.3',
    platform: 'macos',
    enabled,
    origin: 'https://accounts.example.test',
    fetcher,
    now: () => clock.wall,
    monotonic: () => clock.mono,
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
  Response.json({ schemaVersion: 1, acceptedIds: ids });

describe('client statistics', () => {
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
    expect(rows.filter((e) => e.accountMode === 'local').every((e) => e.userId === undefined)).toBe(
      true,
    );
    expect(rows.filter((e) => e.accountMode === 'account').every((e) => e.userId === userId)).toBe(
      true,
    );
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
