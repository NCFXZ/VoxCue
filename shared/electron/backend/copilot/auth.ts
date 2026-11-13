import type { CopilotSession } from '@github/copilot-sdk';
import type { AuthSession, SignOutResult } from '../../contracts/auth';
import { abortable } from '../cancellable';
import {
  keychainFailureReason,
  ProviderCredentialUnavailable,
  type ProviderCredentialAccess,
} from '../auth/providerCredentialAccess';
import { CopilotError } from './errors';
import { copilotRequest } from './requests';

export interface CopilotLoginStorage {
  read(): Promise<AuthSession | null>;
  write(session: AuthSession | null): Promise<void>;
}
interface Dependencies {
  storage: CopilotLoginStorage;
  control(): Promise<CopilotSession>;
  openBrowser(url: string): Promise<void>;
  timeoutMs?: number;
  credentialEncryptionLabel?: string;
  credentialAccess?: ProviderCredentialAccess;
  retire?(): Promise<void>;
}

export function copilotAuthorizationUrl(value: string) {
  const url = new URL(value);
  if (
    url.origin !== 'https://github.com' ||
    url.pathname !== '/login/oauth/authorize' ||
    url.username ||
    url.password ||
    !url.searchParams.get('state') ||
    url.searchParams.get('code_challenge_method') !== 'S256' ||
    !url.searchParams.get('code_challenge') ||
    !url.searchParams.get('client_id')
  )
    throw new CopilotError('GitHub 授权地址校验失败，请重试。');
  const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
  if (
    callback.protocol !== 'http:' ||
    callback.hostname !== '127.0.0.1' ||
    !callback.port ||
    callback.username ||
    callback.password
  )
    throw new CopilotError('GitHub 授权回调校验失败，请重试。');
  return url.href;
}

export class CopilotAuthService {
  private pending: AbortController | null = null;
  private signingOut = false;
  private generation = 0;
  constructor(private dependencies: Dependencies) {}
  private loginStep(
    step: Awaited<ReturnType<CopilotSession['rpc']['accounts']['login']['advance']>>,
  ) {
    if (step.kind === 'completed' && step.result.status === 'needs-plaintext-consent')
      throw (
        this.dependencies.credentialAccess?.block() ??
        new CopilotError(
          `${this.dependencies.credentialEncryptionLabel ?? '系统凭据加密'}存储不可用，GitHub Copilot 登录未保存，请重试。`,
        )
      );
    if (step.kind === 'error' && this.dependencies.credentialAccess) {
      const reason = keychainFailureReason(step.message);
      if (reason) throw this.dependencies.credentialAccess.block(reason);
    }
    return step;
  }
  async session() {
    this.dependencies.credentialAccess?.check();
    if (this.pending || this.signingOut) return null;
    const generation = this.generation;
    try {
      const session = await this.dependencies.storage.read();
      this.dependencies.credentialAccess?.check();
      return generation === this.generation && !this.pending && !this.signingOut ? session : null;
    } catch (error) {
      if (generation !== this.generation) return null;
      throw error;
    }
  }
  isPending() {
    return !!this.pending;
  }
  cancel() {
    this.pending?.abort();
  }
  async verifiedSession(signal?: AbortSignal) {
    try {
      this.dependencies.credentialAccess?.check();
      if (this.pending || this.signingOut) throw new CopilotError('账户正在变更，请稍后重试。');
      const generation = this.generation;
      const session = await this.session();
      if (!session) return null;
      const identity = await copilotRequest(
        this.dependencies.credentialAccess,
        async () => {
          if (generation !== this.generation || this.pending || this.signingOut)
            throw new CopilotError('账户正在变更，请稍后重试。');
          const control = await this.dependencies.control();
          signal?.throwIfAborted();
          return control.rpc.accounts.get({ query: { kind: 'activeAccount' } });
        },
        signal,
        this.dependencies.retire,
      );
      if (generation !== this.generation || this.pending || this.signingOut)
        throw new CopilotError('账户正在变更，请稍后重试。');
      if (identity.kind !== 'activeAccount')
        throw new CopilotError('无法检查 GitHub Copilot 授权，请重新登录。');
      if (
        identity.authInfo?.type !== 'user' ||
        identity.authInfo.host !== 'https://github.com' ||
        identity.authInfo.login !== session.user.name
      )
        return null;
      return session;
    } catch (error) {
      if (error instanceof CopilotError || error instanceof ProviderCredentialUnavailable)
        throw error;
      throw new CopilotError('无法检查 GitHub Copilot 授权，请重新登录。');
    }
  }
  async access(signal?: AbortSignal) {
    const session = await this.verifiedSession(signal);
    if (!session) throw new CopilotError('GitHub Copilot 授权已失效或账户已变更，请重新登录。');
    return { account: `copilot:${session.user.id}` };
  }
  async signIn(): Promise<AuthSession> {
    this.dependencies.credentialAccess?.check();
    if (this.pending || this.signingOut) throw new CopilotError('已有登录操作正在进行。');
    const controller = new AbortController();
    this.pending = controller;
    ++this.generation;
    const timer = setTimeout(() => controller.abort(), this.dependencies.timeoutMs ?? 300000);
    let control: CopilotSession | undefined;
    let flowId: string | undefined;
    let cleanup: Promise<void> | undefined;
    const finishFlow = () => {
      if (this.dependencies.credentialAccess?.denied) return Promise.resolve();
      if (!cleanup)
        cleanup = (async () => {
          if (control && flowId) {
            try {
              await abortable(
                control.rpc.accounts.login.cancel({ flowId }),
                AbortSignal.timeout(5000),
              );
              return;
            } catch {
              /* An unconfirmed flow must retire with its own runtime. */
            }
          }
          await this.dependencies.retire?.();
        })();
      return cleanup;
    };
    const loginRequest = <T>(operation: () => Promise<T>) =>
      copilotRequest(this.dependencies.credentialAccess, operation, controller.signal, finishFlow);
    try {
      const login = await loginRequest(() => this.dependencies.control());
      control = login;
      const flow = await loginRequest(async () => {
        const progress = await login.rpc.accounts.login.begin({ kind: 'githubDotCom' });
        if (controller.signal.aborted) {
          if (!this.dependencies.retire && !this.dependencies.credentialAccess?.denied)
            void login.rpc.accounts.login.cancel({ flowId: progress.flowId }).catch(() => {});
          controller.signal.throwIfAborted();
        }
        flowId = progress.flowId;
        this.loginStep(progress.step);
        return progress;
      });
      let step = flow.step;
      for (let count = 0; count < 1000; count++) {
        controller.signal.throwIfAborted();
        if (step.kind === 'open-url')
          await abortable(
            this.dependencies.openBrowser(copilotAuthorizationUrl(step.url)),
            controller.signal,
          );
        else if (step.kind === 'completed') {
          if (
            step.result.status !== 'completed' ||
            step.result.host !== 'https://github.com' ||
            !step.result.login ||
            !/^[A-Za-z0-9-]{1,100}$/.test(step.result.login)
          )
            throw new CopilotError('GitHub Copilot 授权未完成，请重试。');
          const session: AuthSession = {
            mode: 'copilot',
            user: { id: `github.com:${step.result.login}`, name: step.result.login, email: '' },
            expiresAt: null,
          };
          await this.dependencies.storage.write(session);
          if (controller.signal.aborted) {
            await this.dependencies.storage.write(null);
            throw new CopilotError('登录已取消，请重试。');
          }
          return session;
        } else if (step.kind !== 'awaiting') {
          throw new CopilotError('GitHub Copilot 授权未完成，请重新登录。');
        }
        step = await loginRequest(async () => {
          const next = await login.rpc.accounts.login.advance({ flowId: flow.flowId });
          controller.signal.throwIfAborted();
          return this.loginStep(next);
        });
      }
      throw new CopilotError('GitHub Copilot 登录超时，请重试。');
    } catch (error) {
      if (controller.signal.aborted) throw new CopilotError('登录已取消或超时，请重试。');
      if (error instanceof CopilotError || error instanceof ProviderCredentialUnavailable)
        throw error;
      throw Error('无法完成 GitHub Copilot 登录，请检查网络和 Copilot 权限后重试。');
    } finally {
      clearTimeout(timer);
      try {
        if (flowId || cleanup) await finishFlow();
      } finally {
        this.pending = null;
      }
    }
  }
  async signOut(): Promise<SignOutResult> {
    if (this.pending || this.signingOut) throw Error('请先取消正在进行的登录。');
    this.signingOut = true;
    ++this.generation;
    try {
      // The official runtime's OS vault slot is shared with Copilot CLI.
      // Disconnect only this app's metadata; a global logout would remove CLI auth.
      await this.dependencies.storage.write(null);
      return { warning: null };
    } finally {
      this.signingOut = false;
    }
  }
}
