import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { decodeJwt } from 'jose';
import {
  ProviderCredentialAccess,
  ProviderCredentialUnavailable,
  keychainFailureReason,
} from '../auth/providerCredentialAccess';

const unavailable = () => new Error('ChatGPT 服务暂不可用，请稍后重试。');
// Codex 0.164 distinguishes a missing entry from a keyring API failure. Only
// its fixed local storage diagnostics are consumed; never retain raw messages.
const keyringErrors = [
  'keyring.load error',
  'keyring.save error',
  'keyring.delete error',
  'failed to load CLI auth from keyring',
  'failed to write OAuth tokens to keyring',
  'failed to delete auth from keyring',
];
function credentialFailure(value: unknown): ProviderCredentialUnavailable['reason'] | undefined {
  if (typeof value !== 'string') return;
  const reason = keychainFailureReason(value);
  if (reason) return reason;
  if (keyringErrors.some((marker) => value.includes(marker))) return 'unavailable';
}
// Between chunks remember only a prefix of a known marker.
function partialKeyringError(text: string) {
  let partial = '';
  for (const marker of keyringErrors) {
    for (let n = Math.min(text.length, marker.length - 1); n > partial.length; --n) {
      if (text.endsWith(marker.slice(0, n))) {
        partial = marker.slice(0, n);
        break;
      }
    }
  }
  return partial;
}
const requirePackage = createRequire(__filename);
export const codexRuntimeVersion = process.platform === 'win32' ? '0.170.0' : '0.171.0';
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
  if (
    requirePackage('@openai/codex/package.json').version !== codexRuntimeVersion ||
    requirePackage(manifest).version !== `${codexRuntimeVersion}-${target[0]}`
  )
    throw unavailable();
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
  private credentials = new ProviderCredentialAccess('chatgpt', () => {
    void this.stop();
  });
  private startupCheck?: AbortController;
  private checkedSignedIn = false;
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
    private readonly loginStatus?: (
      executable: string,
      options: { cwd: string; env: NodeJS.ProcessEnv },
      signal: AbortSignal,
    ) => Promise<'signed-in' | 'empty'>,
  ) {}
  // All starts run inside the credential queue. The standalone status command
  // can report keyring denial before app-server gets to load its AuthManager.
  private async start(method: string, signal?: AbortSignal) {
    if (this.child) return true;
    const generation = this.generation;
    const workingDirectory = path.join(this.directory, 'workspace');
    await mkdir(workingDirectory, { recursive: true });
    if (generation !== this.generation) throw unavailable();
    signal?.throwIfAborted();
    this.credentials.check();
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (/^(?:CODEX_|OPENAI_|AZURE_OPENAI_|OTEL_)/i.test(key)) delete env[key];
    env.CODEX_HOME = this.directory;
    // These exact upstream targets emit operation outcomes, never values.
    env.RUST_LOG = 'codex_keyring_store=trace,codex_login::auth::storage=warn';
    env.LOG_FORMAT = 'json';
    const executable = codexUsageExecutable();
    if (this.loginStatus) {
      const controller = new AbortController();
      this.startupCheck = controller;
      const checkSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try {
        const status = await this.loginStatus(
          executable,
          { cwd: workingDirectory, env },
          checkSignal,
        );
        checkSignal.throwIfAborted();
        if (status === 'empty' && method === 'account/read') return false;
        this.checkedSignedIn = status === 'signed-in';
      } catch (error) {
        signal?.throwIfAborted();
        if (controller.signal.aborted) throw unavailable();
        if (error instanceof ProviderCredentialUnavailable)
          throw this.credentials.block(error.reason);
        throw error;
      } finally {
        if (this.startupCheck === controller) this.startupCheck = undefined;
      }
    }
    const child = this.launch(
      executable,
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
    child.stdin.on('error', () => child.kill());
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child || this.credentials.denied) return;
      buffer += chunk;
      if (buffer.length > 2_000_000) {
        child.kill();
        return;
      }
      let end: number;
      while (this.child === child && (end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          this.message(JSON.parse(line));
        } catch {
          child.kill();
        }
      }
    });
    // Trace and warning output is newline-framed. Keep only a fixed marker
    // prefix across chunks until the local error starts, then at most 4 KiB. A denial
    // can follow the generic wrapper in the next chunk of the same line.
    let diagnosticTail = '',
      diagnostic = '';
    const finishDiagnostic = () => {
      const reason = credentialFailure(diagnostic);
      diagnosticTail = diagnostic = '';
      if (reason) this.credentials.block(reason);
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      for (const [index, line] of chunk.split('\n').entries()) {
        if (this.child !== child || this.credentials.denied) return;
        if (index) finishDiagnostic();
        if (this.credentials.denied) return;
        if (diagnostic) diagnostic += line.slice(0, 4096 - diagnostic.length);
        else {
          const text = diagnosticTail + line;
          const marker = keyringErrors.find((candidate) => text.includes(candidate));
          if (marker) {
            diagnostic = text.slice(text.indexOf(marker), text.indexOf(marker) + 4096);
          } else {
            const reason = keychainFailureReason(line);
            if (reason) {
              this.credentials.block(reason);
              return;
            }
            diagnosticTail = partialKeyringError(text);
          }
        }
      }
    });
    child.stderr.once('end', () => {
      if (this.child === child && !this.credentials.denied) finishDiagnostic();
    });
    // Node follows a spawn error with 'close'. Drain diagnostic bytes first
    // even when a broken input pipe or a failed spawn ends the process.
    child.once('error', () => {});
    // 'close' follows stdio drainage. An exit event alone can precede the
    // local denial on stderr; restarting at that point would retry it.
    child.once('close', () => this.closed(child));
    try {
      await this.call('initialize', {
        clientInfo: { name: 'voxcue', title: 'VoxCue', version: this.version },
        capabilities: { experimentalApi: false },
      });
      this.write({ method: 'initialized' });
      return true;
    } catch (error) {
      if (this.child === child) await this.stop();
      throw error;
    }
  }
  private closed(child: ChildProcessWithoutNullStreams) {
    if (this.child !== child) return;
    this.child = undefined;
    this.checkedSignedIn = false;
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
      if (message.error) {
        const reason = credentialFailure(message.error.message);
        pending.reject(reason ? this.credentials.block(reason) : unavailable());
      } else pending.resolve(message.result);
    } else if (
      message.method === 'account/login/completed' &&
      typeof message.params?.loginId === 'string'
    ) {
      const reason = !message.params.success && credentialFailure(message.params.error);
      if (reason) {
        this.credentials.block(reason);
        return;
      }
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
        // A credential operation that stops replying may still own a system
        // prompt. Stop this provider before the next queued RPC can run.
        const credentialTimeout =
          this.loginStatus &&
          (method === 'initialize' ||
            method === 'account/read' ||
            method === 'getAuthStatus' ||
            method === 'account/login/start' ||
            method === 'account/logout');
        reject(credentialTimeout ? this.credentials.block() : unavailable());
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
  private request(method: string, params?: unknown, signal?: AbortSignal) {
    const generation = this.generation;
    return this.credentials.run(async () => {
      if (generation !== this.generation) throw unavailable();
      signal?.throwIfAborted();
      const started = await this.start(method, signal);
      this.credentials.check();
      signal?.throwIfAborted();
      if (!started) return { account: null };
      const reply = await this.call(method, params);
      if (method === 'account/read' && this.checkedSignedIn && reply?.account === null)
        throw this.credentials.block();
      if (method === 'account/logout') this.checkedSignedIn = false;
      return reply;
    });
  }
  async account(): Promise<UsageAccount | null> {
    const result = await this.request('account/read', { refreshToken: false });
    if (result?.account === null || result?.account?.type === 'apiKey') return null;
    if (result?.account?.type !== 'chatgpt' || typeof result.account.email !== 'string')
      throw unavailable();
    return {
      email: result.account.email.slice(0, 320),
      planType: String(result.account.planType ?? 'unknown'),
    };
  }
  async limits() {
    // VoxCue displays usage windows, not the separate reset-credit inventory.
    return this.request('account/rateLimits/read', { excludeResetCreditDetails: true });
  }
  async access(): Promise<ManagedAccess> {
    // true forces a remote renewal even for a valid token. The official runtime
    // already renews credentials when needed with refreshToken: false.
    return managedAccess(
      await this.request('getAuthStatus', { includeToken: true, refreshToken: false }),
    );
  }
  async login(open: (url: string) => Promise<void>, signal: AbortSignal) {
    signal.throwIfAborted();
    const login = await this.request(
      'account/login/start',
      { type: 'chatgpt', useHostedLoginSuccessPage: true },
      signal,
    );
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
      this.credentials.check();
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
      this.credentials.check();
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
    if (loginId && !this.credentials.denied)
      void this.call('account/login/cancel', { loginId }).catch(() => {});
  }
  async logout(ensureRunning = false) {
    this.credentials.check();
    if (ensureRunning || this.child) await this.request('account/logout');
  }
  async stop() {
    ++this.generation;
    this.startupCheck?.abort();
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
    this.checkedSignedIn = false;
  }
}
