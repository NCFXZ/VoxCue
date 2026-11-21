import type {
  CloudAccountCall,
  CloudAccountResult,
  CloudAccountState,
  CloudSession,
  CloudUser,
} from '../../contracts/cloudAccount';
import { createHash } from 'node:crypto';
import { boundedJson } from '../boundedJson';
import type { MigrationPasswords } from './migrationPasswords';
import { receiptHash, type AccountErasureReceipts } from './erasureReceipts';
import {
  credentialProblemCode,
  credentialProblemMessages,
  type CredentialProblemCode,
} from '../../contracts/credentialProblems';
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
  preserve?(): Promise<void>;
}
export class CloudFailure extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly retryAfterSeconds?: number,
    readonly code?: unknown,
  ) {
    super(message);
  }
}
const Failure = CloudFailure;
// Created only around trusted local vault operations, never server error codes.
class LocalCredentialFailure extends CloudFailure {
  constructor(readonly credentialProblem: CredentialProblemCode) {
    super(credentialProblemMessages[credentialProblem]);
  }
}
const messages: Record<string, string> = {
  invalid_credentials: '邮箱或密码不正确。',
  invalid_code: '验证码无效或已过期。',
  invalid_request: '请检查邮箱、密码和验证码。',
  weak_password: '该密码过于常见，请选择更难猜测的密码或口令。',
  rate_limited: '操作过于频繁，请稍后重试。',
  busy: '服务繁忙，请稍后重试。',
  mail_unavailable: '验证码服务尚未配置，请稍后重试。',
  unauthorized: '登录已过期，请重新登录。',
  account_disabled: '该账号已被停用，请联系支持。',
  knowledge_capacity: '云端剩余空间不足，请清理不需要的云端数据后重试。',
  storage_capacity: '云端剩余空间不足，请清理不需要的云端数据后重试。',
  revision_conflict: '两端数据都有更新，请选择要保留的版本。',
};
const safeMessage = (code: unknown, fallback: string) =>
  typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] : fallback;
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
/** Validate saved bytes locally; expiry and server authentication are separate. */
export function storedCloudCredentials(value: unknown, origin: string): CloudCredentials {
  const envelope = record(value);
  if (envelope.origin !== origin) throw new Failure('账号服务地址已变更。');
  return credentials(envelope.credentials);
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
  private transfers = new Set<{ userId: string; syncId: string; controller: AbortController }>();
  private waiting: { resolve(): void; timer: ReturnType<typeof setTimeout> }[] = [];
  private async acquireApi(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.busy) {
      this.busy = true;
      return;
    }
    if (this.waiting.length >= 2) throw new Failure('账号服务繁忙，请稍后重试。', 503, 1);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(waiter.timer);
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => {
        this.waiting = this.waiting.filter((item) => item !== waiter);
        cleanup();
        reject(signal!.reason);
      };
      const waiter = {
        resolve: () => {
          cleanup();
          resolve();
        },
        timer: setTimeout(() => {
          this.waiting = this.waiting.filter((item) => item !== waiter);
          cleanup();
          reject(new Failure('账号服务繁忙，请稍后重试。', 503, 1));
        }, 2000),
      };
      this.waiting.push(waiter);
      signal?.addEventListener('abort', abort, { once: true });
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
      migrationPasswords?: MigrationPasswords;
      erasures?: AccountErasureReceipts;
      blockedErasureOwner?: (id: string) => boolean;
      forgetMigrationPasswordForEmail?(email: string): Promise<void>;
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
  /** Verify a local source profile's owner without installing their session or touching its backups. */
  async verifyProfileImportOwner(
    source: Pick<CloudUser, 'id' | 'email'>,
    password: string | undefined,
    signal: AbortSignal,
  ) {
    if (this.options.blockedErasureOwner?.(source.id)) throw Error('该账号资料正在等待清理。');
    if (!this.options.origin) throw Error('账号服务未配置。');
    if (
      !validCloudEmail(source.email) ||
      !password ||
      normalizeCloudPassword(password) === undefined
    )
      throw Error('请输入资料所属账号的密码。');
    let offline = false;
    let checkingPassword = true;
    const isolated = new CloudAccountClient({
      ...this.options,
      migrationPasswords: undefined,
      fetcher: async (input, init) => {
        const deadline = checkingPassword
          ? init?.signal ? AbortSignal.any([init.signal, signal]) : signal
          : init?.signal;
        try {
          const response = await (this.options.fetcher ?? fetch)(input, { ...init, signal: deadline });
          const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
          const retiredEndpoint = ([404, 410].includes(response.status) && !mediaType?.includes('json')) ||
            (response.status === 200 && mediaType === 'text/html' &&
              String(input) === this.options.origin + '/v1/capabilities');
          offline = retiredEndpoint || [502, 503, 504].includes(response.status);
          return response;
        } catch (error) {
          offline = !signal.aborted;
          throw error;
        }
      },
      deviceLabel: 'VoxCue · 数据迁移',
      vault: { read: async () => null, write: async () => {}, clear: async () => {} },
    });
    signal.throwIfAborted();
    let identity: CloudUser | null;
    try {
      const caps = await isolated.request('/v1/capabilities', 'GET', undefined, undefined, signal);
      if (caps.apiVersion !== 'v1') throw new Failure('账号服务响应无效。');
      if (caps.profilePasswordVerification === 'password-only-v1') {
        const result = await isolated.request('/v1/auth/verify-password', 'POST',
          { email: source.email, password }, undefined, signal);
        identity = user(result.user);
      } else if (caps.profilePasswordVerification === undefined) {
        // Older servers only authenticate the password through an isolated, short-lived login.
        const login = await isolated.call({ action: 'login', email: source.email, password });
        if (!login.ok) throw new Failure(login.error);
        checkingPassword = false;
        identity = login.state.verified ? login.state.user : null;
        const logout = await isolated.call({ action: 'logout' });
        if (!logout.ok || logout.message)
          throw new Failure('迁移验证会话未能退出，请在来源账号的设备管理中撤销该会话。');
      } else throw new Failure('账号服务使用了不支持的迁移验证协议，请更新客户端。');
    } catch (error) {
      signal.throwIfAborted();
      const message = error instanceof Failure ? error.message : '账号服务连接失败，请检查网络或系统凭据存储。';
      if (message === messages.invalid_credentials) {
        await this.options.migrationPasswords?.forgetIfRejected(source, password, this.options.origin);
      } else if (message === messages.account_disabled) {
        await this.options.migrationPasswords?.forget(source.id);
      } else if (checkingPassword && offline && this.options.migrationPasswords)
        return this.options.migrationPasswords.verify(source, password, this.options.origin, signal);
      throw Error(message);
    }
    signal.throwIfAborted();
    if (identity?.id !== source.id || identity.email.toLowerCase() !== source.email.toLowerCase())
      throw Error('资料所属账号与验证结果不符。');
    await this.options.migrationPasswords?.remember(source, password, this.options.origin);
  }
  /** Main-process statistics only. Failures must not revoke or refresh a cloud session. */
  async telemetryIdentity(installationId: string, expectedUserId: string, signal: AbortSignal) {
    const current = this.current;
    if (
      !this.options.origin ||
      !current ||
      current.user.id !== expectedUserId ||
      current.expiresAt <= Date.now()
    )
      throw Error('Attribution unavailable');
    const response = await (this.options.fetcher ?? fetch)(
      this.options.origin + '/v2/telemetry/identity',
      {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + current.accessToken,
        },
        body: JSON.stringify({ installationId }),
      },
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw Error('Attribution unavailable');
    }
    return boundedJson(response, 8192);
  }
  isCurrentSession(id: unknown) {
    return !!this.current && this.current.sessionId === id;
  }
  /** Startup only, before renderers and telemetry load their local state. */
  async recoverErasedOwner(id: string, erase: (ownsSession: boolean) => Promise<void>) {
    await this.load();
    const ownsSession = this.current?.user.id === id;
    await erase(ownsSession);
    if (ownsSession) {
      this.current = null;
      this.verified = false;
    }
  }
  hideBlockedErasureOwner() {
    if (this.current && this.options.blockedErasureOwner?.(this.current.user.id)) {
      this.current = null;
      this.verified = false;
    }
  }
  private async load() {
    if (this.initialized) return;
    let saved: unknown;
    try {
      saved = await this.options.vault.read();
    } catch (error) {
      const problem = credentialProblemCode(error);
      if (problem) throw new LocalCredentialFailure(problem);
      throw error;
    }
    if (saved !== null && saved !== undefined) {
      try {
        this.current = storedCloudCredentials(saved, this.options.origin!);
        this.hideBlockedErasureOwner();
      } catch {
        // A different historical key or damaged record must remain recoverable.
        // Only an explicit login flow below may replace it after preserving it.
        throw new LocalCredentialFailure('VOXCUE_CREDENTIAL_INVALID_DATA');
      }
    }
    this.initialized = true;
  }
  private async request(
    route: string,
    method = 'GET',
    body?: unknown,
    token?: string,
    signal?: AbortSignal,
  ) {
    const response = await (this.options.fetcher ?? fetch)(this.options.origin + route, {
      method,
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    signal?.throwIfAborted();
    if (response.status === 401 && route !== '/v1/account/delete') await this.clear();
    const reader = response.body?.getReader();
    if (!reader) {
      if (response.status === 401) await this.clear();
      throw new Failure('服务器响应无效。');
    }
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
      if (response.status === 401) await this.clear();
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    let result: Record<string, unknown>;
    try {
      result = record(JSON.parse(Buffer.concat(parts).toString('utf8')));
    } catch (error) {
      if (response.status === 401) await this.clear();
      throw error;
    }
    if (!response.ok) {
      let code: unknown;
      try {
        code = record(result.error).code;
      } catch (error) {
        if (response.status === 401) await this.clear();
        throw error;
      }
      if (response.status === 401 && code !== 'invalid_credentials') await this.clear();
      if (response.status === 403 && code === 'account_disabled') await this.clear();
      const retry = Number(response.headers.get('retry-after'));
      throw new Failure(
        safeMessage(code, '服务暂不可用，请稍后重试。'),
        response.status,
        Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : undefined,
        code,
      );
    }
    signal?.throwIfAborted();
    return result;
  }
  private async save(value: unknown, expectedUser?: string) {
    const next = credentials(value);
    if (expectedUser && next.user.id !== expectedUser)
      throw new Failure('账号已变化，请重新操作。', 401);
    if (this.options.blockedErasureOwner?.(next.user.id)) {
      await this.request('/v1/auth/logout', 'POST', {}, next.accessToken).catch(() => {});
      throw new Failure('该账号的本机删除记录尚未处理完成，请检查资料后重启重试。');
    }
    try {
      await this.options.vault.write({ origin: this.options.origin!, credentials: next });
    } catch (error) {
      await this.request('/v1/auth/logout', 'POST', {}, next.accessToken).catch(() => {});
      const problem = credentialProblemCode(error);
      if (problem) throw new LocalCredentialFailure(problem);
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
  private async access(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.current) throw new Failure('请先登录 VoxCue 账号。', 401);
    if (this.current.expiresAt <= Date.now() + 30_000) {
      const userId = this.current.user.id;
      try {
        await this.save(
          await this.request(
            '/v1/auth/refresh',
            'POST',
            {
              refreshToken: this.current.refreshToken,
            },
            undefined,
            signal,
          ),
          userId,
        );
      } catch (error) {
        if (error instanceof Failure && error.status === 401) await this.clear();
        throw error;
      }
    }
    return this.current!.accessToken;
  }
  private async authorized(route: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
    const token = await this.access(signal);
    try {
      return await this.request(route, method, body, token, signal);
    } catch (error) {
      if (
        error instanceof Failure &&
        error.status === 401 &&
        !(route === '/v1/account/delete' && error.code === 'invalid_credentials')
      )
        await this.clear();
      throw error;
    }
  }
  /** Main only: one transfer/rotation in flight; at most two callers wait for up to two seconds. */
  cancelTransfers(userId: string, syncId: string) {
    for (const transfer of this.transfers)
      if (transfer.userId === userId && transfer.syncId === syncId) transfer.controller.abort();
  }
  async api(
    route: string,
    method = 'GET',
    body?: unknown,
    binary = false,
    owner?: { userId: string; syncId: string },
  ): Promise<unknown> {
    const userId = this.current?.user.id;
    const transfer = owner && { ...owner, controller: new AbortController() };
    const signal = transfer?.controller.signal;
    if (transfer) this.transfers.add(transfer);
    let acquired = false;
    try {
      await this.acquireApi(signal);
      acquired = true;
      await this.load();
      signal?.throwIfAborted();
      if (
        (userId && this.current?.user.id !== userId) ||
        (owner && this.current?.user.id !== owner.userId)
      )
        throw new Failure('账号已变化，请重新操作。', 401);
      if (!this.options.origin) throw new Failure('账号服务未配置。');
      if (!(body instanceof Uint8Array) && !binary)
        return await this.authorized(route, method, body, signal);
      const token = await this.access(signal);
      const response = await (this.options.fetcher ?? fetch)(this.options.origin + route, {
        method,
        redirect: 'error',
        // One MiB transfers must tolerate slow uplinks; explicit owner cancellation
        // still interrupts immediately without waiting for this total deadline.
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000),
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
      signal?.throwIfAborted();
      if (response.status === 401) await this.clear();
      const binaryResponse = binary && response.ok;
      const reader = response.body?.getReader();
      if (!reader) throw new Failure('云端响应无效。');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > (binaryResponse ? 1048576 : 32768))
            throw new Failure(binaryResponse ? '云端分块过大。' : '服务器响应过大。');
          chunks.push(chunk.value);
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
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
        if (response.status === 403 && code === 'account_disabled') await this.clear();
        throw new Failure(
          safeMessage(code, '云同步请求失败，请稍后重试。'),
          response.status,
          Math.min(3600, Math.max(1, Number(response.headers.get('retry-after')) || 1)),
        );
      }
      signal?.throwIfAborted();
      return binary ? new Uint8Array(result) : record(JSON.parse(result.toString()));
    } finally {
      if (transfer) this.transfers.delete(transfer);
      if (acquired) this.release();
    }
  }
  async call(input: CloudAccountCall, erasureOwner?: string): Promise<CloudAccountResult> {
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
      if (!this.options.origin) {
        if (call.action === 'delete') throw new Failure('未配置账号服务，无法确认删除。');
        return { ok: true, state: this.state() };
      }
      const action = call.action;
      try {
        await this.load();
      } catch (error) {
        if (
          !(error instanceof LocalCredentialFailure) ||
          error.credentialProblem !== 'VOXCUE_CREDENTIAL_INVALID_DATA' ||
          !['code', 'login', 'register', 'reset'].includes(String(action))
        )
          throw error;
        await this.options.vault.preserve?.();
        this.current = null;
        this.verified = false;
        this.initialized = true;
      }
      if (action === 'status') {
        if (this.current) {
          this.verified = false;
          const result = await this.authorized('/v1/account');
          const identity = user(result.user);
          if (this.current!.user.id !== identity.id) {
            await this.clear();
            throw new Failure('账号已变化，请重新操作。', 401);
          }
          this.current!.user = identity;
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
        const normalized = normalizeCloudPassword(call.password);
        // Legacy login keeps the original bytes, but never sends malformed UTF-16.
        const password =
          action === 'login' && normalized !== undefined ? call.password : normalized;
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
          await this.options.forgetMigrationPasswordForEmail?.(call.email);
          return { ok: true, state: this.state(), message: '密码已重置，请重新登录。' };
        }
        await this.save(result);
        if (this.options.migrationPasswords) {
          try {
            await this.options.migrationPasswords.remember(this.current!.user, password, this.options.origin);
          } catch {
            return { ok: true, state: this.state(), message: '已登录，但本机未能保存离线迁移验证。请检查系统凭据存储后重新登录。' };
          }
        }
      } else if (action === 'delete') {
        if (
          call.confirm !== 'DELETE' ||
          !text(call.password, 1024) ||
          normalizeCloudPassword(call.password) === undefined
        )
          throw new Failure('请输入当前密码并确认删除。');
        const caps = await this.request('/v1/capabilities');
        if (caps.accountDeletion !== 'account-erasure-v1')
          throw new Failure('服务器尚未支持永久删除账号，请更新服务端后重试。');
        const token = await this.access();
        const userId = this.current!.user.id;
        if (erasureOwner !== undefined && erasureOwner !== 'account:' + userId)
          throw new Failure('账号已变化，请重新操作。');
        const erasures = this.options.erasures;
        const supported = caps.accountDeletionReceipt === 'sha256-v1';
        const pending = await erasures?.prepare(userId, supported);
        try {
          const response = await this.request('/v1/account/delete', 'POST', {
            password: call.password, confirm: 'DELETE',
            ...(supported && pending?.entry.proof ? { receiptHash: receiptHash(pending.entry.proof) } : {}),
          }, token);
          if (response.deleted !== true) throw new Failure('服务器未确认账号删除，请联系支持。');
        } catch (error) {
          if (!pending || !erasures) throw error;
          // A definite refusal only disposes the current attempt. An older unanswered request may have committed.
          if (pending.fresh && error instanceof Failure && error.status >= 400 && error.status < 500 &&
              ['invalid_credentials', 'confirmation_required', 'invalid_request', 'unauthorized',
                'rate_limited', 'account_disabled'].includes(String(error.code))) {
            await erasures.forget(userId);
            throw error;
          }
          if (!await erasures.confirmed(pending.entry)) {
            throw new Failure(pending.entry.proof
              ? '服务器尚未确认注销结果，本机资料已保留。重新打开后会继续核实。'
              : '服务器尚未确认注销结果，本机资料已保留。当前账号服务不支持回执核实。');
          }
        }
        if (pending) await erasures!.commit(pending.entry);
        // A local vault I/O failure must not hide an irreversible server confirmation.
        // Main retires all writers and retries the complete local erasure using its persisted marker.
        if (pending) {
          // The persisted session still identifies shared files if cleanup is interrupted.
          this.current = null;
          this.verified = false;
        } else await this.clear().catch(() => {});
        return { ok: true, state: this.state(), message: '账号已删除。' };
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
