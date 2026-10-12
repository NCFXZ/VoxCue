import { createServer, type Server } from 'node:http';
import type { AuthSession, SignOutResult } from '../../contracts/auth';
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
  storage: AuthStorage;
  openBrowser(url: string): Promise<void>;
  fetch?: typeof fetch;
  verify?: typeof verifyIdentity;
  timeoutMs?: number;
}
export class ChatGPTAuthService {
  private record: CredentialRecord | null = null;
  private loaded: Promise<void> | undefined;
  private pending: AbortController | null = null;
  private signingOut = false;
  constructor(private dependencies: Dependencies) {}
  private load() {
    return (this.loaded ??= this.dependencies.storage.read().then((record) => {
      this.record = record;
    }));
  }
  async session(): Promise<AuthSession | null> {
    await this.load();
    const record = this.record;
    return record?.idToken && record.expiresAt > Date.now()
      ? {
          mode: 'chatgpt',
          user: { id: record.subject, name: record.name, email: record.email },
          expiresAt: record.expiresAt,
        }
      : null;
  }
  cancel() {
    this.pending?.abort();
  }
  isPending() {
    return this.pending !== null;
  }
  async signIn(): Promise<AuthSession> {
    if (this.pending || this.signingOut) throw new Error('已有登录操作正在进行。');
    const controller = new AbortController();
    this.pending = controller;
    let server: Server | undefined;
    const timer = setTimeout(() => controller.abort(), this.dependencies.timeoutMs ?? 180000);
    try {
      await this.load();
      const hostId = await this.dependencies.storage.hostId();
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
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        if (
          !transaction ||
          request.method !== 'GET' ||
          request.headers.host !== new URL(transaction.redirectUri).host ||
          !request.url ||
          request.url.length > 20000
        ) {
          response.writeHead(400).end('Invalid callback');
          return;
        }
        let url: URL;
        try {
          url = new URL(request.url!, transaction.redirectUri);
        } catch {
          response.writeHead(400).end('Invalid URL');
          return;
        }
        if (url.origin !== new URL(transaction.redirectUri).origin) {
          response.writeHead(400).end('Invalid origin');
          return;
        }
        if (url.pathname !== '/auth/callback') {
          response.writeHead(404).end('Not found');
          return;
        }
        if (consumed) {
          response.writeHead(409).end('Callback already used');
          return;
        }
        try {
          const value = validateCallback(url, transaction);
          consumed = true;
          resolveCallback(value);
          response.end('已收到授权。请返回 AI Interview Copilot 查看登录结果。');
        } catch (error) {
          response.writeHead(400).end('授权回调无效。请返回应用重试。');
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
    if (this.signingOut) throw new Error('正在退出登录，请稍候。');
    if (this.pending) throw new Error('请先取消正在进行的登录。');
    this.signingOut = true;
    try {
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
