import { describe, expect, it } from 'vitest';
import { InterviewLease, readEntitlements } from '../../electron/backend/cloud/lease';
import { CloudFailure } from '../../electron/backend/cloud/client';

describe('interview time lease', () => {
  it('uses a monotonic deadline, rejects expired usage and does not extend an offline lease', async () => {
    let clock = 0,
      offline = false;
    const notices: string[] = [],
      calls: string[] = [];
    const lease = new InterviewLease(
      {
        async api(route) {
          calls.push(route);
          if (offline) throw new CloudFailure('network', 0);
          return {
            id: '22222222-2222-4222-8222-222222222222',
            sequence: 0,
            state: 'active',
            canContinue: true,
            leaseRemainingMs: 60000,
            permanent: false,
            remainingSeconds: 120,
          };
        },
      },
      (message) => notices.push(message),
      () => clock,
    );
    try {
      await lease.start();
      expect(lease.active()).toBe(true);
      offline = true;
      clock = 15000;
      await lease.tick();
      expect(lease.active()).toBe(true);
      clock = 60000;
      await lease.tick();
      expect(lease.active()).toBe(false);
      expect(notices).toHaveLength(1);
      expect(() => lease.assertActive()).toThrow();
      expect(calls.filter((route) => route.endsWith('/stop'))).toHaveLength(1);
    } finally {
      await lease.stop();
    }
  });
  it('a late heartbeat cannot revive a stopped session or create concurrent renewals', async () => {
    let clock = 0,
      release!: (v: unknown) => void,
      renewals = 0;
    const reply = {
      id: '22222222-2222-4222-8222-222222222222',
      sequence: 0,
      state: 'active',
      canContinue: true,
      leaseRemainingMs: 60000,
      permanent: false,
      remainingSeconds: 120,
    };
    const lease = new InterviewLease(
      {
        async api(route) {
          if (route.endsWith('/heartbeat')) {
            renewals++;
            return new Promise((r) => {
              release = r;
            });
          }
          return reply;
        },
      },
      () => {},
      () => clock,
    );
    await lease.start();
    clock = 15000;
    const beat = lease.tick();
    await lease.tick();
    expect(renewals).toBe(1);
    const stop = lease.stop();
    release({ ...reply, sequence: 1 });
    await Promise.all([beat, stop]);
    expect(lease.active()).toBe(false);
  });
  it('insufficient credit cannot start an interview and permanent grants retain null duration', async () => {
    const lease = new InterviewLease(
      {
        async api() {
          throw new CloudFailure('额度已用完', 402);
        },
      },
      () => {},
    );
    await expect(lease.start()).rejects.toThrow('额度');
    expect(lease.active()).toBe(false);
    const permanent = {
      permanent: true,
      remainingSeconds: null,
      zeroSince: null,
      cloudDeleteAfter: null,
      cloudPurgePending: false,
    };
    expect(readEntitlements(permanent)).toEqual(permanent);
    expect(() => readEntitlements({ ...permanent, remainingSeconds: 100 })).toThrow();
    expect(() =>
      readEntitlements({ ...permanent, permanent: false, remainingSeconds: -1 }),
    ).toThrow();
  });
  it('a delayed heartbeat cannot revive an elapsed lease even before the next timer callback', async () => {
    let clock = 0,
      release!: (value: unknown) => void;
    const reply = {
      id: '22222222-2222-4222-8222-222222222222',
      sequence: 0,
      state: 'active',
      canContinue: true,
      leaseRemainingMs: 60000,
      permanent: false,
      remainingSeconds: 600,
    };
    const lease = new InterviewLease(
      {
        async api(route) {
          if (route.endsWith('/heartbeat'))
            return new Promise((resolve) => {
              release = resolve;
            });
          return reply;
        },
      },
      () => {},
      () => clock,
    );
    await lease.start();
    clock = 30000;
    const beat = lease.tick();
    clock = 61000;
    release({ ...reply, sequence: 1 });
    await beat;
    expect(lease.active()).toBe(false);
    await lease.tick();
    await lease.stop();
  });
  it('counts down the full balance, independent of the short renewable lease or wall clock', async () => {
    let clock = 0,
      sequence = 0;
    const updates: unknown[] = [];
    const lease = new InterviewLease(
      {
        async api(route) {
          return {
            id: '22222222-2222-4222-8222-222222222222',
            sequence: route.endsWith('/heartbeat') ? ++sequence : 0,
            state: 'active',
            canContinue: true,
            leaseRemainingMs: 60000,
            permanent: false,
            remainingSeconds: 360 - Math.ceil(clock / 1000),
          };
        },
      },
      () => {},
      () => clock,
      (state) => updates.push(state),
    );
    try {
      await lease.start();
      expect(lease.snapshot()?.remainingSeconds).toBe(360);
      for (clock = 30000; clock <= 300000; clock += 30000) await lease.tick();
      clock = 300000;
      expect(lease.snapshot()?.remainingSeconds).toBe(60);
      clock = 301000;
      await lease.tick();
      expect(lease.snapshot()?.remainingSeconds).toBe(59);
      expect(lease.active()).toBe(true);
      expect(updates.length).toBeGreaterThan(10);
    } finally {
      await lease.stop();
    }
  });
  it('emits exhaustion once and retains the expired snapshot for a late-loading renderer', async () => {
    let clock = 0;
    const expired: string[] = [];
    const lease = new InterviewLease(
      {
        async api() {
          return {
            id: '22222222-2222-4222-8222-222222222222',
            sequence: 0,
            state: 'active',
            canContinue: true,
            leaseRemainingMs: 60000,
            permanent: false,
            remainingSeconds: 20,
          };
        },
      },
      (message) => expired.push(message),
      () => clock,
    );
    await lease.start();
    clock = 20000;
    await Promise.all([lease.tick(), lease.tick()]);
    expect(expired).toHaveLength(1);
    expect(expired[0]).not.toContain('已停止并保存');
    expect(lease.snapshot()).toEqual({
      state: 'expired',
      permanent: false,
      remainingSeconds: 0,
      reason: 'exhausted',
    });
  });
  it('does not mistake a failed connection for an exhausted balance, or grant offline time', async () => {
    let clock = 0,
      offline = false;
    const lease = new InterviewLease(
      {
        async api() {
          if (offline) throw new CloudFailure('network', 0);
          return {
            id: '22222222-2222-4222-8222-222222222222',
            sequence: 0,
            state: 'active',
            canContinue: true,
            leaseRemainingMs: 60000,
            permanent: false,
            remainingSeconds: 600,
          };
        },
      },
      () => {},
      () => clock,
    );
    await lease.start();
    offline = true;
    clock = 60000;
    await lease.tick();
    expect(lease.snapshot()).toEqual({
      state: 'expired',
      permanent: false,
      remainingSeconds: 540,
      reason: 'connection',
    });
  });
  it('permanent credit has no finite countdown but still requires a live lease', async () => {
    let clock = 0;
    const lease = new InterviewLease(
      {
        async api() {
          return {
            id: '22222222-2222-4222-8222-222222222222',
            sequence: 0,
            state: 'active',
            canContinue: true,
            leaseRemainingMs: 60000,
            permanent: true,
            remainingSeconds: null,
          };
        },
      },
      () => {},
      () => clock,
    );
    await lease.start();
    expect(lease.snapshot()?.remainingSeconds).toBeNull();
    clock = 60000;
    await lease.tick();
    expect(lease.active()).toBe(false);
    expect(lease.snapshot()?.reason).toBe('connection');
  });
  it.each([
    { permanent: false, remainingSeconds: -1 },
    { permanent: false, remainingSeconds: Infinity },
    { permanent: false, remainingSeconds: null },
    { permanent: true, remainingSeconds: 120 },
    { canContinue: 'true' },
  ])('rejects malformed server timing data: %j', async (patch) => {
    const lease = new InterviewLease(
      {
        async api() {
          return {
            id: '22222222-2222-4222-8222-222222222222',
            sequence: 0,
            state: 'active',
            canContinue: true,
            leaseRemainingMs: 60000,
            permanent: false,
            remainingSeconds: 120,
            ...patch,
          };
        },
      },
      () => {},
    );
    await expect(lease.start()).rejects.toThrow();
    expect(lease.active()).toBe(false);
  });
});
