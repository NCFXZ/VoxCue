import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { decodeJwt } from 'jose';

const unavailable = () => new Error('ChatGPT 服务暂不可用，请稍后重试。');
const requirePackage = createRequire(__filename);
// node_modules is unpacked by both platform packagers; spawn needs its real path.
export function unpackedUsagePath(file: string) {
  return file.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}
export function codexUsageExecutable() {
  const target =
    process.platform === 'darwin' && process.arch === 'arm64'
      ? ['darwin-arm64', 'aarch64-apple-darwin', 'codex']
      : process.platform === 'win32' && process.arch === 'x64'
        ? ['win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe']
        : null;
  if (!target) throw unavailable();
  const manifest = requirePackage.resolve(`@openai/codex-${target[0]}/package.json`);
  if (requirePackage(manifest).version !== `0.164.0-${target[0]}`) throw unavailable();
  return unpackedUsagePath(
    path.join(path.dirname(manifest), 'vendor', target[1], 'bin', target[2]),
  );
}
export interface UsageAccount {
  email: string;
  planType: string;
}
export interface ManagedAccess {
  token: string;
  account: string;
  chatgptAccountId: string;
  email: string;
  name: string;
  expiresAt: number;
}
/** Input comes only from the official process's authenticated getAuthStatus RPC. */
export function managedAccess(result: any): ManagedAccess {
  if (
    result?.authMethod !== 'chatgpt' ||
    typeof result.authToken !== 'string' ||
    result.authToken.length > 64000
  )
    throw unavailable();
  try {
    const claims = decodeJwt(result.authToken);
    const metadata = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
    const account = metadata?.chatgpt_account_id;
    if (
      typeof account !== 'string' ||
      !/^[\w-]{1,160}$/.test(account) ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      claims.sub.length > 256 ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp * 1000 <= Date.now()
    )
      throw unavailable();
    return {
      token: result.authToken,
      account: `${claims.sub}:${account}`,
      chatgptAccountId: account,
      email: typeof claims.email === 'string' ? claims.email.slice(0, 320) : '',
      name: typeof claims.name === 'string' ? claims.name.slice(0, 120) : '',
      expiresAt: claims.exp * 1000,
    };
  } catch {
    throw unavailable();
  }
}
export interface CodexUsagePort {
  account(): Promise<UsageAccount | null>;
  access(): Promise<ManagedAccess>;
  limits(): Promise<unknown>;
  login(open: (url: string) => Promise<void>, signal: AbortSignal): Promise<void>;
  cancel(): void;
  logout(ensureRunning?: boolean): Promise<void>;
  stop(): Promise<void>;
}
/** OAuth and account-only process. Never starts threads, tools or inference. */
export class CodexUsageRuntime implements CodexUsagePort {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private sequence = 0;
  private generation = 0;
  private pending = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >();
  private completions = new Map<string, boolean>();
  private loginId?: string;
  private listeners = new Set<() => void>();
  constructor(
    private directory: string,
    private launch = spawn,
    private version = 'development',
  ) {}
  private async start() {
    if (!this.starting)
      this.starting = (async () => {
        const generation = this.generation;
        const workingDirectory = path.join(this.directory, 'workspace');
        await mkdir(workingDirectory, { recursive: true });
        if (generation !== this.generation) throw unavailable();
        const env = { ...process.env };
        for (const key of Object.keys(env))
          if (/^(?:CODEX_|OPENAI_|AZURE_OPENAI_|OTEL_)/i.test(key)) delete env[key];
        env.CODEX_HOME = this.directory;
        const child = this.launch(
          codexUsageExecutable(),
          [
            'app-server',
            '--listen',
            'stdio://',
            '-c',
            'cli_auth_credentials_store="keyring"',
            '-c',
            'approval_policy="never"',
            '-c',
            'sandbox_mode="read-only"',
            '-c',
            'analytics.enabled=false',
            '-c',
            'otel.exporter="none"',
          ],
          { cwd: workingDirectory, env, stdio: 'pipe', windowsHide: true },
        );
        this.child = child;
        child.stdin.on('error', () => this.closed(child));
        let buffer = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          buffer += chunk;
          if (buffer.length > 2_000_000) {
            child.kill();
            return;
          }
          let end: number;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            try {
              this.message(JSON.parse(line));
            } catch {
              child.kill();
            }
          }
        });
        // Diagnostic output can include account context. Drain it without logging.
        child.stderr.resume();
        child.once('error', () => this.closed(child));
        child.once('exit', () => this.closed(child));
        await this.call('initialize', {
          clientInfo: { name: 'voxcue', title: 'VoxCue', version: this.version },
          capabilities: { experimentalApi: false },
        });
        this.write({ method: 'initialized' });
      })().catch(async (error) => {
        await this.stop();
        throw error;
      });
    return this.starting;
  }
  private closed(child: ChildProcessWithoutNullStreams) {
    if (this.child !== child) return;
    this.child = undefined;
    this.starting = undefined;
    this.loginId = undefined;
    this.completions.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(unavailable());
    }
    this.pending.clear();
    for (const listener of this.listeners) listener();
  }
  private write(message: unknown) {
    if (!this.child?.stdin.writable) throw unavailable();
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  private message(message: any) {
    if (Number.isSafeInteger(message.id) && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(unavailable());
      else pending.resolve(message.result);
    } else if (
      message.method === 'account/login/completed' &&
      typeof message.params?.loginId === 'string'
    ) {
      if (this.completions.size >= 8) this.completions.clear();
      this.completions.set(message.params.loginId, message.params.success === true);
      for (const listener of this.listeners) listener();
    } else if (message.id !== undefined && message.method) {
      // No tool, filesystem, approval or token-export capability is accepted.
      this.write({ id: message.id, error: { code: -32601, message: 'Unsupported request' } });
    }
  }
  private call(method: string, params?: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(unavailable());
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, ...(params === undefined ? {} : { params }) });
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(unavailable());
      }
    });
  }
  async account(): Promise<UsageAccount | null> {
    await this.start();
    const result = await this.call('account/read', { refreshToken: false });
    return result?.account?.type === 'chatgpt' && typeof result.account.email === 'string'
      ? {
          email: result.account.email.slice(0, 320),
          planType: String(result.account.planType ?? 'unknown'),
        }
      : null;
  }
  async limits() {
    await this.start();
    return this.call('account/rateLimits/read');
  }
  async access(): Promise<ManagedAccess> {
    await this.start();
    return managedAccess(
      await this.call('getAuthStatus', { includeToken: true, refreshToken: true }),
    );
  }
  async login(open: (url: string) => Promise<void>, signal: AbortSignal) {
    signal.throwIfAborted();
    await this.start();
    signal.throwIfAborted();
    const login = await this.call('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
    });
    if (
      login?.type !== 'chatgpt' ||
      typeof login.loginId !== 'string' ||
      typeof login.authUrl !== 'string'
    )
      throw unavailable();
    this.loginId = login.loginId;
    try {
      const url = new URL(login.authUrl);
      if (
        url.protocol !== 'https:' ||
        !['auth.openai.com', 'chatgpt.com'].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw unavailable();
      signal.throwIfAborted();
      await open(url.toString());
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          this.listeners.delete(check);
          signal.removeEventListener('abort', abort);
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        const check = () => {
          if (!this.child) finish(unavailable());
          else if (this.completions.has(login.loginId)) {
            const success = this.completions.get(login.loginId);
            this.completions.delete(login.loginId);
            finish(success ? undefined : new Error('ChatGPT 登录未完成，请重试。'));
          }
        };
        const abort = () => finish(new Error('已取消 ChatGPT 登录。'));
        const timer = setTimeout(() => finish(new Error('ChatGPT 登录超时，请重试。')), 180000);
        this.listeners.add(check);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        else check();
      });
    } catch (error) {
      this.cancel();
      const message = error instanceof Error ? error.message : '';
      if (
        [
          '已取消 ChatGPT 登录。',
          'ChatGPT 登录超时，请重试。',
          'ChatGPT 登录未完成，请重试。',
        ].includes(message)
      )
        throw error;
      throw unavailable();
    } finally {
      this.loginId = undefined;
    }
  }
  cancel() {
    const loginId = this.loginId;
    this.loginId = undefined;
    if (loginId) void this.call('account/login/cancel', { loginId }).catch(() => {});
  }
  async logout(ensureRunning = false) {
    if (ensureRunning) await this.start();
    if (this.child) await this.call('account/logout');
  }
  async stop() {
    ++this.generation;
    const child = this.child;
    if (child) {
      child.kill();
      this.closed(child);
      if (child.exitCode === null && child.signalCode === null)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 2000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
    }
    this.starting = undefined;
  }
}
