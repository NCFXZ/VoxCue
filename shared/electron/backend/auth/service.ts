import { createServer, type Server } from 'node:http';
import { decodeJwt } from 'jose';
import type { AuthSession, SignOutResult } from '../../contracts/auth';
import { createAuthCallbackPage } from './callbackPage';
import type { ManagedChatGPTAuth } from './managed';
import {
  authorizationURL,
  createTransaction,
  validateCallback,
  verifyIdentity,
  issuer,
  tokenEndpoint,
  resource,
} from './oauth';
export interface CredentialRecord {
  version: 1;
  hostId: string;
  clientId: string;
  subject: string;
  name: string;
  email: string;
  expiresAt: number;
  accessExpiresAt?: number;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  grantedScopes?: string[];
}
export interface AuthStorage {
  hostId(): Promise<string>;
  read(): Promise<CredentialRecord | null>;
  write(record: CredentialRecord): Promise<void>;
}
interface Dependencies {
  managed?: ManagedChatGPTAuth;
  storage: AuthStorage;
  openBrowser(url: string): Promise<void>;
  callbackLogo?: () => Promise<Buffer>;
  fetch?: typeof fetch;
  verify?: typeof verifyIdentity;
  timeoutMs?: number;
}
export class ChatGPTAuthService {
  private record: CredentialRecord | null = null;
  private loaded: Promise<void> | undefined;
  private pending: AbortController | null = null;
  private signingOut = false;
  private refreshing: Promise<void> | undefined;
  constructor(private dependencies: Dependencies) {}
  private load() {
    return (this.loaded ??= this.dependencies.storage
      .read()
      .then((record) => {
        this.record = record;
      })
      .catch((error) => {
        // Denied/temporarily locked Keychain must not poison every later login
        // attempt in this process. Keep storage untouched and permit a retry.
        this.loaded = undefined;
        throw error;
      }));
  }
  async session(): Promise<AuthSession | null> {
    if (this.dependencies.managed) return this.dependencies.managed.session();
    await this.load();
    const record = this.record;
    return record?.idToken && (record.expiresAt > Date.now() || !!record.refreshToken)
      ? {
          mode: 'chatgpt',
          user: { id: record.subject, name: record.name, email: record.email },
          expiresAt: record.expiresAt,
        }
      : null;
  }
  cancel() {
    if (this.dependencies.managed) return this.dependencies.managed.cancel();
    this.pending?.abort();
  }
  isPending() {
    if (this.dependencies.managed) return this.dependencies.managed.isPending();
    return this.pending !== null;
  }
  async usageIdentity() {
    if (this.dependencies.managed) {
      const access = await this.dependencies.managed.access();
      return {
        account: access.account,
        email: access.email,
        chatgptAccountId: access.chatgptAccountId,
      };
    }
    await this.load();
    const record = this.record;
    if (
      this.signingOut ||
      this.pending ||
      !record?.idToken ||
      (!record.refreshToken && record.expiresAt <= Date.now())
    )
      throw new Error('请先登录 ChatGPT。');
    const account = `${record.clientId}:${record.subject}`;
    if (this.signingOut || this.pending || this.record !== record)
      throw new Error('账户正在变更，请稍后重试。');
    return { account, email: record.email };
  }
  // This method is native-only. Never expose its result through IPC.
  async access(): Promise<{ token: string; account: string; chatgptAccountId?: string }> {
    if (this.dependencies.managed) return this.dependencies.managed.access();
    await this.load();
    if (this.signingOut || this.pending) throw new Error('账户正在变更，请稍后重试。');
    let record = this.record;
    if (!record?.accessToken) throw new Error('请重新登录 ChatGPT。');
    if (!record.grantedScopes?.includes('chatgpt.tokens.use.direct'))
      throw new Error('账户尚未授权使用 ChatGPT 套餐，请退出后重新登录并授权。');
    let expiry = record.accessExpiresAt;
    if (!expiry) {
      try {
        expiry = Number(decodeJwt(record.accessToken).exp) * 1000;
      } catch {
        /* Old records require renewal. */
      }
    }
    if (!expiry || expiry < Date.now() + 60000) {
      if (!this.refreshing)
        this.refreshing = this.refresh().finally(() => {
          this.refreshing = undefined;
        });
      await this.refreshing;
    }
    record = this.record;
    if (this.signingOut || !record?.accessToken) throw new Error('请重新登录 ChatGPT。');
    if (!record.grantedScopes?.includes('chatgpt.tokens.use.direct'))
      throw new Error('账户未授权 ChatGPT 套餐调用，请重新登录并授权。');
    return { token: record.accessToken, account: `${record.clientId}:${record.subject}` };
  }
  private async refresh() {
    const record = this.record;
    if (!record?.refreshToken) throw new Error('登录已过期，请重新登录 ChatGPT。');
    const response = await (this.dependencies.fetch ?? fetch)(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: record.clientId,
        refresh_token: record.refreshToken,
        resource,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    }).catch(() => {
      throw new Error('无法续期登录，请检查网络后重试。');
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        const cleared = {
          ...record,
          accessToken: undefined,
          refreshToken: undefined,
          idToken: undefined,
          expiresAt: 0,
        };
        await this.dependencies.storage.write(cleared);
        this.record = cleared;
        throw new Error('登录授权已失效，请退出后重新登录 ChatGPT。');
      }
      throw new Error('登录续期暂时不可用，请稍后重试。');
    }
    const tokens = (await response.json()) as Record<string, unknown>;
    if (
      typeof tokens.access_token !== 'string' ||
      typeof tokens.refresh_token !== 'string' ||
      typeof tokens.expires_in !== 'number' ||
      !Number.isFinite(tokens.expires_in) ||
      tokens.expires_in <= 0
    )
      throw new Error('登录续期响应无效，请重新登录。');
    const updated = {
      ...record,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessExpiresAt: Date.now() + tokens.expires_in * 1000,
      grantedScopes:
        typeof tokens.scope === 'string' ? tokens.scope.split(' ') : record.grantedScopes,
    };
    await this.dependencies.storage.write(updated);
    this.record = updated;
  }
  async signIn(): Promise<AuthSession> {
    if (this.dependencies.managed) return this.dependencies.managed.signIn();
    if (this.pending || this.signingOut) throw new Error('已有登录操作正在进行。');
    const controller = new AbortController();
    this.pending = controller;
    let server: Server | undefined;
    const timer = setTimeout(() => controller.abort(), this.dependencies.timeoutMs ?? 180000);
    try {
      // An explicit new login can recover unreadable credentials. Keep the file
      // untouched until a complete, verified authorization replaces it.
      await this.load().catch(() => {
        this.record = null;
        this.loaded = Promise.resolve();
      });
      const hostId = await this.dependencies.storage.hostId();
      // A missing branding asset must not prevent an otherwise valid login.
      const logo = await this.dependencies.callbackLogo?.().catch(() => undefined);
      const page = createAuthCallbackPage(logo);
      if (controller.signal.aborted) throw new Error('登录已取消或超时，请重试。');
      let consumed = false;
      let resolveCallback!: (value: { code: string; clientId: string }) => void;
      let rejectCallback!: (error: Error) => void;
      const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
      });
      // Register rejection handling before browser launch or cancellation can settle it.
      void callback.catch(() => {});
      let transaction: ReturnType<typeof createTransaction>;
      server = createServer((request, response) => {
        for (const [header, value] of Object.entries(page.headers))
          response.setHeader(header, value);
        if (
          !transaction ||
          request.method !== 'GET' ||
          request.headers.host !== new URL(transaction.redirectUri).host ||
          !request.url ||
          request.url.length > 20000
        ) {
          response.writeHead(400).end(page.render('invalid'));
          return;
        }
        let url: URL;
        try {
          url = new URL(request.url!, transaction.redirectUri);
        } catch {
          response.writeHead(400).end(page.render('invalid'));
          return;
        }
        if (url.origin !== new URL(transaction.redirectUri).origin) {
          response.writeHead(400).end(page.render('invalid'));
          return;
        }
        if (url.pathname !== '/auth/callback') {
          response.writeHead(404).end(page.render('not-found'));
          return;
        }
        if (consumed) {
          response.writeHead(409).end(page.render('used'));
          return;
        }
        try {
          const value = validateCallback(url, transaction);
          consumed = true;
          resolveCallback(value);
          response.end(page.render('received'));
        } catch (error) {
          response.writeHead(400).end(page.render('invalid'));
          // An unrelated request cannot terminate the genuine pending attempt.
          if (url.searchParams.get('state') === transaction.state) {
            consumed = true;
            rejectCallback(error as Error);
          }
        }
      });
      server.requestTimeout = 10000;
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('无法启动本地登录回调。');
      transaction = createTransaction(
        `http://127.0.0.1:${address.port}/auth/callback`,
        hostId,
        this.record?.clientId,
        this.record?.subject,
        this.record?.email,
      );
      const abort = () => rejectCallback(new Error('登录已取消或超时，请重试。'));
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
      else await this.dependencies.openBrowser(authorizationURL(transaction));
      const { code, clientId } = await callback;
      const network = this.dependencies.fetch ?? fetch;
      const response = await network(tokenEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: transaction.verifier,
          redirect_uri: transaction.redirectUri,
          resource,
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('ChatGPT 授权交换失败，请重新登录。');
      const tokens = (await response.json()) as Record<string, unknown>;
      if (typeof tokens.id_token !== 'string')
        throw new Error('授权结果缺少身份信息，请重新登录。');
      const identity = await (this.dependencies.verify ?? verifyIdentity)(
        tokens.id_token,
        clientId,
        transaction.nonce,
      );
      if (transaction.subject && identity.subject !== transaction.subject)
        throw new Error('ChatGPT 账户与本机注册信息不匹配。');
      if (controller.signal.aborted) throw new Error('登录已取消或超时，请重试。');
      const record: CredentialRecord = {
        version: 1,
        hostId,
        clientId,
        ...identity,
        accessExpiresAt:
          typeof tokens.expires_in === 'number' && tokens.expires_in > 0
            ? Date.now() + tokens.expires_in * 1000
            : undefined,
        idToken: tokens.id_token,
        accessToken: typeof tokens.access_token === 'string' ? tokens.access_token : undefined,
        refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined,
        grantedScopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ') : [],
      };
      await this.dependencies.storage.write(record);
      if (controller.signal.aborted) {
        await this.dependencies.storage.write({
          ...record,
          idToken: undefined,
          accessToken: undefined,
          refreshToken: undefined,
          expiresAt: 0,
        });
        throw new Error('登录已取消，请重试。');
      }
      this.record = record;
      return (await this.session())!;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('登录已取消或超时，请重试。');
      if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) throw error;
      throw new Error('无法完成 ChatGPT 登录，请检查网络后重试。');
    } finally {
      clearTimeout(timer);
      server?.close();
      server?.closeAllConnections();
      this.pending = null;
    }
  }
  async signOut(): Promise<SignOutResult> {
    if (this.dependencies.managed) return this.dependencies.managed.signOut();
    if (this.signingOut) throw new Error('正在退出登录，请稍候。');
    if (this.pending) throw new Error('请先取消正在进行的登录。');
    this.signingOut = true;
    try {
      await this.refreshing?.catch(() => {});
      await this.load();
      const record = this.record;
      let warning: string | null = null;
      if (record?.refreshToken) {
        const network = this.dependencies.fetch ?? fetch;
        let revoked = false;
        try {
          const discoveryResponse = await network(`${issuer}/.well-known/openid-configuration`, {
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
          });
          if (!discoveryResponse.ok) throw new Error();
          const discovery = (await discoveryResponse.json()) as { revocation_endpoint?: string };
          const endpoint = new URL(discovery.revocation_endpoint ?? '');
          if (endpoint.origin !== issuer) throw new Error();
          for (let attempt = 0; attempt < 2 && !revoked; attempt++) {
            if (attempt) await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              const response = await network(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  token: record.refreshToken,
                  token_type_hint: 'refresh_token',
                  client_id: record.clientId,
                }),
                signal: AbortSignal.timeout(10000),
                redirect: 'error',
              });
              revoked = response.status === 200;
              if (!revoked && response.status < 500) break;
            } catch {
              /* Retry once, then clear local credentials and report unconfirmed revocation. */
            }
          }
        } catch {
          /* Local sign-out still completes. */
        }
        if (!revoked)
          warning = '已在本机退出，未能确认远端授权撤销。可在 ChatGPT 设置中断开此应用。';
      }
      if (record) {
        const cleared = {
          ...record,
          idToken: undefined,
          accessToken: undefined,
          refreshToken: undefined,
          grantedScopes: undefined,
          expiresAt: 0,
        };
        await this.dependencies.storage.write(cleared);
        this.record = cleared;
      }
      return { warning };
    } finally {
      this.signingOut = false;
    }
  }
}
