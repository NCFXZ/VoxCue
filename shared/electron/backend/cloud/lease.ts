import { randomUUID } from 'node:crypto';
import { CloudFailure, type CloudAccountClient } from './client';
import type {
  CloudEntitlements,
  CloudUsageCall,
  CloudUsageResult,
  InterviewUsageState,
} from '../../contracts/cloudUsage';

export function readEntitlements(value: unknown): CloudEntitlements {
  const r = value as CloudEntitlements;
  if (
    !r ||
    typeof r.permanent !== 'boolean' ||
    typeof r.cloudPurgePending !== 'boolean' ||
    (r.permanent
      ? r.remainingSeconds !== null
      : !Number.isSafeInteger(r.remainingSeconds) || Number(r.remainingSeconds) < 0) ||
    ![r.zeroSince, r.cloudDeleteAfter].every(
      (n) => n === null || (Number.isSafeInteger(n) && Number(n) >= 0),
    )
  )
    throw Error('面试额度响应无效。');
  return {
    permanent: r.permanent,
    remainingSeconds: r.remainingSeconds,
    zeroSince: r.zeroSince,
    cloudDeleteAfter: r.cloudDeleteAfter,
    cloudPurgePending: r.cloudPurgePending,
  };
}
export class InterviewLease {
  private current?: {
    id: string;
    sequence: number;
    deadline: number;
    balanceDeadline: number | null;
  };
  private last: InterviewUsageState | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private heartbeat?: Promise<void>;
  private busy = false;
  private nextBeat = 0;
  private attempt = randomUUID();
  constructor(
    private account: Pick<CloudAccountClient, 'api'>,
    private expired: (message: string) => void,
    private now = () => performance.now(),
    private changed: (state: InterviewUsageState) => void = () => {},
  ) {}
  async call(input: CloudUsageCall): Promise<CloudUsageResult> {
    if (this.busy) return { ok: false, error: '额度操作正在进行，请稍后重试。' };
    this.busy = true;
    try {
      if (!input || typeof input !== 'object') throw Error('额度请求无效。');
      if (input.action === 'status')
        return {
          ok: true,
          entitlements: readEntitlements(await this.account.api('/v1/entitlements')),
        };
      if (
        input.action !== 'redeem' ||
        typeof input.code !== 'string' ||
        !/^VC1_[A-Za-z0-9_-]{43}$/.test(input.code)
      )
        throw Error('激活码格式无效。');
      const result = (await this.account.api('/v1/activation/redeem', 'POST', {
        code: input.code,
      })) as { entitlements: unknown };
      return { ok: true, entitlements: readEntitlements(result.entitlements) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '无法读取面试额度。' };
    } finally {
      this.busy = false;
    }
  }
  private read(value: unknown, sent: number) {
    const r = value as {
      id: string;
      state: string;
      sequence: number;
      leaseRemainingMs: number;
      canContinue: boolean;
      permanent: boolean;
      remainingSeconds: number | null;
    };
    if (
      !r ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(r.id) ||
      !Number.isSafeInteger(r.sequence) ||
      r.sequence < 0 ||
      !Number.isSafeInteger(r.leaseRemainingMs) ||
      r.leaseRemainingMs < 0 ||
      r.leaseRemainingMs > 120000 ||
      typeof r.canContinue !== 'boolean' ||
      !['active', 'stopped', 'expired'].includes(r.state) ||
      typeof r.permanent !== 'boolean' ||
      (r.permanent
        ? r.remainingSeconds !== null
        : !Number.isSafeInteger(r.remainingSeconds) ||
          Number(r.remainingSeconds) < 0 ||
          Number(r.remainingSeconds) > Math.floor(Number.MAX_SAFE_INTEGER / 1000))
    )
      throw Error('计时会话响应无效。');
    const balanceDeadline = r.permanent ? null : sent + r.remainingSeconds! * 1000;
    return {
      id: r.id,
      sequence: r.sequence,
      balanceDeadline,
      deadline:
        r.canContinue && r.state === 'active'
          ? Math.min(sent + r.leaseRemainingMs, balanceDeadline ?? Infinity)
          : 0,
    };
  }
  snapshot(): InterviewUsageState | null {
    const current = this.current;
    if (!current) return this.last;
    const remainingSeconds =
      current.balanceDeadline === null
        ? null
        : Math.max(0, Math.ceil((current.balanceDeadline - this.now()) / 1000));
    return {
      state: this.active() ? 'active' : 'expired',
      permanent: remainingSeconds === null,
      remainingSeconds,
      ...(!this.active()
        ? { reason: remainingSeconds === 0 ? ('exhausted' as const) : ('connection' as const) }
        : {}),
    };
  }
  private publish() {
    this.last = this.snapshot();
    if (this.last) this.changed(this.last);
  }
  active() {
    return !!this.current && this.now() < this.current.deadline;
  }
  assertActive() {
    if (!this.active()) throw Error('面试额度已用完或网络计时已失效，请返回主界面。');
  }
  async start() {
    if (this.current || this.busy) throw Error('已有面试计时操作正在进行。');
    this.busy = true;
    try {
      this.last = null;
      const sent = this.now();
      const current = this.read(
        await this.account.api('/v1/usage/sessions', 'POST', { requestId: this.attempt }),
        sent,
      );
      if (current.deadline <= this.now()) throw Error('面试额度已耗尽或计时会话已结束。');
      this.current = current;
      this.publish();
      this.nextBeat = this.now() + 15000;
      this.timer = setInterval(() => {
        void this.tick();
      }, 1000);
    } finally {
      this.busy = false;
    }
  }
  async tick() {
    const current = this.current;
    if (!current) return;
    this.publish();
    if (this.now() >= current.deadline) {
      this.expired(
        this.last?.reason === 'exhausted'
          ? '面试额度已用完，正在保存本次面试记录。'
          : '计时连接已失效，正在停止面试并保存本次记录。',
      );
      await this.stop();
      return;
    }
    if (this.heartbeat || this.now() < this.nextBeat) return;
    this.nextBeat = this.now() + 15000;
    this.heartbeat = (async () => {
      const sent = this.now();
      try {
        const value = await this.account.api(
          '/v1/usage/sessions/' + current.id + '/heartbeat',
          'POST',
          { sequence: current.sequence + 1 },
        );
        if (this.current !== current) return;
        if (this.now() >= current.deadline) {
          current.deadline = 0;
          return;
        }
        const updated = this.read(value, sent);
        if (updated.id !== current.id || updated.sequence !== current.sequence + 1)
          throw Error('计时会话响应不匹配。');
        Object.assign(current, updated);
        this.publish();
      } catch (error) {
        if (
          !(error instanceof CloudFailure) ||
          [401, 402, 403, 404, 409, 410].includes(error.status)
        )
          current.deadline = 0;
      }
    })().finally(() => {
      this.heartbeat = undefined;
    });
    await this.heartbeat;
  }
  async stop() {
    const current = this.current;
    this.current = undefined;
    clearInterval(this.timer);
    this.timer = undefined;
    if (!current) return;
    this.attempt = randomUUID();
    await this.heartbeat;
    await this.account
      .api('/v1/usage/sessions/' + current.id + '/stop', 'POST', {})
      .catch(() => {});
  }
}
