import type {
  CloudAccountCall,
  CloudAccountResult,
  CloudAccountState,
  CloudSession,
  CloudUser,
} from '../../contracts/cloudAccount';
import { createHash } from 'node:crypto';
import {
  validCloudEmail,
  normalizeCloudPassword,
  CLOUD_PASSWORD_MIN,
  CLOUD_PASSWORD_MAX,
} from '../../contracts/cloudAccount';

export interface CloudCredentials {
  user: CloudUser;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
}
export interface CloudVault {
  read(): Promise<unknown>;
  write(value: { origin: string; credentials: CloudCredentials }): Promise<void>;
  clear(): Promise<void>;
}
export class CloudFailure extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
const Failure = CloudFailure;
const messages: Record<string, string> = {
  invalid_credentials: '邮箱或密码不正确。',
  invalid_code: '验证码无效或已过期。',
  invalid_request: '请检查邮箱、密码和验证码。',
  weak_password: '该密码过于常见，请选择更难猜测的密码或口令。',
  rate_limited: '操作过于频繁，请稍后重试。',
  busy: '服务繁忙，请稍后重试。',
  mail_unavailable: '验证码服务尚未配置，请稍后重试。',
  unauthorized: '登录已过期，请重新登录。',
  knowledge_capacity: '云端剩余空间不足，请清理不需要的云端数据后重试。',
  storage_capacity: '云端剩余空间不足，请清理不需要的云端数据后重试。',
  revision_conflict: '两端数据都有更新，请选择要保留的版本。',
  retention_expired: '面试额度连续为零已满30天，云端数据已停止保留。',
  insufficient_credit: '面试额度已用完，请先在 VoxCue 账号设置中兑换面试额度。',
  session_active: '其他设备已有面试正在计时，请先结束该场面试。',
  invalid_activation: '激活码无效或已失效。',
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Failure('服务器响应无效。');
  return value as Record<string, unknown>;
};
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
function user(value: unknown): CloudUser {
  const row = record(value);
  if (
    !uuid(row.id) ||
    !text(row.email, 254) ||
    typeof row.createdAt !== 'number' ||
    !Number.isSafeInteger(row.createdAt)
  )
    throw new Failure('服务器响应无效。');
  return { id: row.id, email: row.email, createdAt: row.createdAt };
}
function credentials(value: unknown): CloudCredentials {
  const row = record(value);
  if (
    !uuid(row.sessionId) ||
    ![row.accessToken, row.refreshToken].every(
      (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token),
    ) ||
    ![row.expiresAt, row.refreshExpiresAt].every(
      (time) => typeof time === 'number' && Number.isSafeInteger(time) && time > 0,
    )
  )
    throw new Failure('登录凭据无效，请重新登录。');
  return {
    user: user(row.user),
    sessionId: row.sessionId,
    accessToken: row.accessToken as string,
    refreshToken: row.refreshToken as string,
    expiresAt: row.expiresAt as number,
    refreshExpiresAt: row.refreshExpiresAt as number,
  };
}
export function cloudOrigin(raw: string | undefined, allowLocal = false): string | undefined {
  if (!raw) return;
  try {
    const url = new URL(raw);
    const local = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return;
    return url.origin;
  } catch {
    return;
  }
}
export class CloudAccountClient {
  private current: CloudCredentials | null = null;
  private initialized = false;
  private verified = false;
  private busy = false;
  private waiting: { resolve(): void; timer: ReturnType<typeof setTimeout> }[] = [];
  private async acquireApi() {
    if (!this.busy) {
      this.busy = true;
      return;
    }
    if (this.waiting.length >= 2) throw new Failure('账号服务繁忙，请稍后重试。', 503, 1);
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          this.waiting = this.waiting.filter((item) => item !== waiter);
          reject(new Failure('账号服务繁忙，请稍后重试。', 503, 1));
        }, 2000),
      };
      this.waiting.push(waiter);
    });
  }
  private release() {
    const waiter = this.waiting.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    } else this.busy = false;
  }
  constructor(
    private options: {
      origin?: string;
      vault: CloudVault;
      deviceLabel: string;
      fetcher?: typeof fetch;
    },
  ) {}
  private state(): CloudAccountState {
    return {
      configured: !!this.options.origin,
      user: this.current?.user ?? null,
      verified: this.verified,
    };
  }
  snapshot(): CloudAccountState {
    return this.state();
  }
  isCurrentSession(id: unknown) {
    return !!this.current && this.current.sessionId === id;
  }
  private async load() {
    if (this.initialized) return;
    const saved = await this.options.vault.read();
    if (saved) {
      try {
        const envelope = record(saved);
        if (envelope.origin !== this.options.origin) throw new Failure('账号服务地址已变更。');
        this.current = credentials(envelope.credentials);
      } catch {
        await this.options.vault.clear();
      }
    }
    this.initialized = true;
  }
  private async request(route: string, method = 'GET', body?: unknown, token?: string) {
    const response = await (this.options.fetcher ?? fetch)(this.options.origin + route, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Failure('服务器响应无效。');
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 32768) throw new Failure('服务器响应过大。');
        parts.push(chunk.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const result = record(JSON.parse(Buffer.concat(parts).toString('utf8')));
    if (!response.ok) {
      const code = record(result.error).code;
      const retry = Number(response.headers.get('retry-after'));
      throw new Failure(
        messages[String(code)] ?? '服务暂不可用，请稍后重试。',
        response.status,
        Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : undefined,
      );
    }
    return result;
  }
  private async save(value: unknown) {
    const next = credentials(value);
    try {
      await this.options.vault.write({ origin: this.options.origin!, credentials: next });
    } catch {
      await this.request('/v1/auth/logout', 'POST', {}, next.accessToken).catch(() => {});
      throw new Failure('系统无法安全保存登录状态，请稍后重试。');
    }
    this.current = next;
    this.verified = true;
  }
  private async clear() {
    this.current = null;
    this.verified = false;
    await this.options.vault.clear();
  }
  private async access() {
    if (!this.current) throw new Failure('请先登录 VoxCue 账号。', 401);
    if (this.current.expiresAt <= Date.now() + 30_000) {
      try {
        await this.save(
          await this.request('/v1/auth/refresh', 'POST', {
            refreshToken: this.current.refreshToken,
          }),
        );
      } catch (error) {
        if (error instanceof Failure && error.status === 401) await this.clear();
        throw error;
      }
    }
    return this.current!.accessToken;
  }
  private async authorized(route: string, method = 'GET', body?: unknown) {
    const token = await this.access();
    try {
      return await this.request(route, method, body, token);
    } catch (error) {
      if (error instanceof Failure && error.status === 401) await this.clear();
      throw error;
    }
  }
  /** Main only: one transfer/rotation in flight; at most two callers wait for up to two seconds. */
  async api(route: string, method = 'GET', body?: unknown, binary = false): Promise<unknown> {
    const userId = this.current?.user.id;
    await this.acquireApi();
    try {
      await this.load();
      if (userId && this.current?.user.id !== userId)
        throw new Failure('账号已变化，请重新操作。', 401);
      if (!this.options.origin) throw new Failure('账号服务未配置。');
      if (!(body instanceof Uint8Array) && !binary)
        return await this.authorized(route, method, body);
      const token = await this.access();
      const response = await (this.options.fetcher ?? fetch)(this.options.origin + route, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
        headers: {
          authorization: 'Bearer ' + token,
          ...(body instanceof Uint8Array
            ? {
                'content-type': 'application/octet-stream',
                'x-content-sha256': createHash('sha256').update(body).digest('hex'),
              }
            : {}),
        },
        ...(body instanceof Uint8Array ? { body: Buffer.from(body) } : {}),
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Failure('云端响应无效。');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1048576) throw new Failure('云端分块过大。');
          chunks.push(chunk.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      const result = Buffer.concat(chunks);
      if (!response.ok) {
        if (response.status === 401) await this.clear();
        let code = '';
        try {
          code = JSON.parse(result.toString()).error?.code;
        } catch {}
        throw new Failure(
          messages[code] ?? '云同步请求失败，请稍后重试。',
          response.status,
          Math.min(3600, Math.max(1, Number(response.headers.get('retry-after')) || 1)),
        );
      }
      return binary ? new Uint8Array(result) : record(JSON.parse(result.toString()));
    } finally {
      this.release();
    }
  }
  async call(input: CloudAccountCall): Promise<CloudAccountResult> {
    if (this.busy)
      return {
        ok: false,
        error: '账号操作正在进行，请稍后重试。',
        retryAfterSeconds: 1,
        state: this.state(),
      };
    this.busy = true;
    try {
      const call = record(input);
      // Local logout must remain available even if a stored credential cannot decrypt.
      if (call.action === 'logout') {
        let remote = true;
        try {
          await this.load();
          if (this.options.origin && this.current)
            await this.authorized('/v1/auth/logout', 'POST', {});
        } catch {
          remote = false;
        }
        await this.clear();
        this.initialized = true;
        return {
          ok: true,
          state: this.state(),
          ...(!remote
            ? { message: '已清除本机登录状态。远程会话未能注销，可在其他设备撤销。' }
            : {}),
        };
      }
      if (!this.options.origin) return { ok: true, state: this.state() };
      await this.load();
      const action = call.action;
      if (action === 'status') {
        if (this.current) {
          this.verified = false;
          const result = await this.authorized('/v1/account');
          this.current!.user = user(result.user);
          this.verified = true;
        }
      } else if (action === 'code') {
        if (!validCloudEmail(call.email) || !['register', 'reset'].includes(String(call.purpose)))
          throw new Failure('请输入有效的邮箱地址。');
        const result = await this.request('/v1/auth/codes', 'POST', {
          email: call.email,
          purpose: call.purpose,
        });
        if (
          !uuid(result.challengeId) ||
          typeof result.expiresInSeconds !== 'number' ||
          typeof result.retryAfterSeconds !== 'number'
        )
          throw new Failure('服务器响应无效。');
        return {
          ok: true,
          state: this.state(),
          challenge: {
            id: result.challengeId,
            expiresInSeconds: result.expiresInSeconds,
            retryAfterSeconds: result.retryAfterSeconds,
          },
        };
      } else if (action === 'login' || action === 'register' || action === 'reset') {
        const password = action === 'login' ? call.password : normalizeCloudPassword(call.password);
        if (!validCloudEmail(call.email)) throw new Failure('请输入有效的邮箱地址。');
        if (!text(password, 1024)) throw new Failure('请输入密码。');
        if (
          action !== 'login' &&
          (Array.from(password).length < CLOUD_PASSWORD_MIN ||
            Array.from(password).length > CLOUD_PASSWORD_MAX)
        )
          throw new Failure(`密码需要${CLOUD_PASSWORD_MIN}至${CLOUD_PASSWORD_MAX}个字符。`);
        if (
          action !== 'login' &&
          (!uuid(call.challengeId) || typeof call.code !== 'string' || !/^\d{6}$/.test(call.code))
        )
          throw new Failure('请检查邮箱、密码和六位验证码。');
        const result = await this.request(
          '/v1/auth/' + (action === 'reset' ? 'reset-password' : action),
          'POST',
          {
            email: call.email,
            password,
            ...(action === 'login' ? {} : { challengeId: call.challengeId, code: call.code }),
            ...(action === 'reset' ? {} : { deviceLabel: this.options.deviceLabel }),
          },
        );
        if (action === 'reset') {
          await this.clear();
          return { ok: true, state: this.state(), message: '密码已重置，请重新登录。' };
        }
        await this.save(result);
      } else if (action === 'sessions') {
        const result = await this.authorized('/v1/account/sessions');
        if (!Array.isArray(result.sessions) || result.sessions.length > 8)
          throw new Failure('服务器响应无效。');
        const sessions: CloudSession[] = result.sessions.map((value) => {
          const row = record(value);
          if (
            !uuid(row.id) ||
            !text(row.label, 80) ||
            typeof row.createdAt !== 'number' ||
            typeof row.lastUsedAt !== 'number' ||
            typeof row.current !== 'boolean'
          )
            throw new Failure('服务器响应无效。');
          return {
            id: row.id,
            label: row.label,
            createdAt: row.createdAt,
            lastUsedAt: row.lastUsedAt,
            current: row.current,
          };
        });
        return { ok: true, state: this.state(), sessions };
      } else if (action === 'revoke') {
        if (!uuid(call.sessionId)) throw new Failure('会话无效。');
        await this.authorized('/v1/account/sessions/' + call.sessionId, 'DELETE');
        if (this.current?.sessionId === call.sessionId) await this.clear();
      } else throw new Failure('账号操作无效。');
      return { ok: true, state: this.state() };
    } catch (error) {
      return {
        ok: false,
        state: this.state(),
        error:
          error instanceof Failure ? error.message : '账号服务连接失败，请检查网络或系统凭据存储。',
        ...(error instanceof Failure && error.retryAfterSeconds
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      };
    } finally {
      this.release();
    }
  }
}
