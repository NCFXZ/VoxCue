import { createHash } from 'node:crypto';
import type { AuthSession, SignOutResult } from '../../contracts/auth';
import { codexRuntimeVersion, type CodexUsagePort } from '../chat/codexUsage';

/** One official, app-owned OAuth session for chat and account limits. */
export class ChatGPTAuthService {
  private pending?: AbortController;
  private signingOut = false;
  private generation = 0;
  constructor(
    private runtime: CodexUsagePort,
    private openBrowser: (url: string) => Promise<void>,
  ) {}
  private async current(): Promise<AuthSession | null> {
    const account = await this.runtime.account();
    if (!account) return null;
    const access = await this.runtime.access();
    if (access.email && access.email.toLowerCase() !== account.email.toLowerCase())
      throw new Error('ChatGPT 账户正在变更，请重新登录。');
    return {
      mode: 'chatgpt',
      user: {
        id: 'chatgpt-' + createHash('sha256').update(access.account).digest('hex'),
        name: access.name || account.email || 'ChatGPT 用户',
        email: account.email,
      },
      expiresAt: access.expiresAt,
    };
  }
  async session() {
    if (this.pending || this.signingOut) return null;
    const generation = this.generation;
    try {
      const session = await this.current();
      return generation === this.generation && !this.pending && !this.signingOut ? session : null;
    } catch (error) {
      if (generation !== this.generation) return null;
      throw error;
    }
  }
  async access() {
    if (this.pending || this.signingOut) throw new Error('账户正在变更，请稍后重试。');
    const generation = this.generation;
    const access = await this.runtime.access();
    if (generation !== this.generation || this.pending || this.signingOut)
      throw new Error('账户正在变更，请稍后重试。');
    return { ...access, kind: 'codex' as const, runtimeVersion: codexRuntimeVersion };
  }
  async usageIdentity() {
    const { account, email, chatgptAccountId } = await this.access();
    return { account, email, chatgptAccountId };
  }
  isPending() {
    return !!this.pending;
  }
  cancel() {
    this.pending?.abort();
    this.runtime.cancel();
  }
  async signIn(): Promise<AuthSession> {
    if (this.pending || this.signingOut) throw new Error('已有登录操作正在进行。');
    const controller = new AbortController();
    this.pending = controller;
    ++this.generation;
    let completed = false;
    try {
      await this.runtime.login(this.openBrowser, controller.signal);
      completed = true;
      controller.signal.throwIfAborted();
      const session = await this.current();
      controller.signal.throwIfAborted();
      if (!session) throw new Error('ChatGPT 登录未完成，请重试。');
      return session;
    } catch (error) {
      if (completed || controller.signal.aborted) await this.runtime.logout().catch(() => {});
      if (controller.signal.aborted) {
        throw new Error('登录已取消或超时，请重试。');
      }
      throw error;
    } finally {
      this.pending = undefined;
    }
  }
  async signOut(): Promise<SignOutResult> {
    if (this.signingOut) throw new Error('正在退出登录，请稍候。');
    this.signingOut = true;
    ++this.generation;
    this.cancel();
    let warning: string | null = null;
    try {
      // Logging out must work even when remote workspace discovery is offline.
      await this.runtime.logout(true);
    } catch {
      warning = '未能确认 ChatGPT 授权已退出，可在官方账户设置中撤销应用授权。';
    } finally {
      await this.runtime.stop();
      this.signingOut = false;
    }
    return { warning };
  }
}
