import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { CredentialEncryption } from '../../shared/electron/backend/auth/storage';
import {
  credentialRetainedItemIds,
  type CredentialCleanup,
} from '../../shared/electron/contracts/credentialMaintenance';
import { credentialProblemMessages } from '../../shared/electron/contracts/credentialProblems';
export type { CredentialCleanup } from '../../shared/electron/contracts/credentialMaintenance';

type Operation = 'encrypt' | 'decrypt' | 'validate' | 'probe' | 'cleanup';
class CredentialDataError extends Error {
  readonly code = 'VOXCUE_CREDENTIAL_INVALID_DATA';
}
class CredentialUnavailableError extends Error {
  readonly code = 'VOXCUE_CREDENTIAL_UNAVAILABLE';
}
class CredentialTimeoutError extends Error {
  readonly code = 'VOXCUE_CREDENTIAL_TIMEOUT';
}
class CredentialValidationError extends Error {}
export interface MacCredentialEncryption extends CredentialEncryption {
  readonly unavailableReason?: string;
  /**
   * Removes superseded historical Keychain copies without any system dialog,
   * only after `readable` confirms every stored record decrypts with the current key.
   */
  maintain(
    readable: (decrypt: (value: Buffer) => Promise<string>) => Promise<boolean>,
  ): Promise<CredentialCleanup | undefined>;
}

const probeStates = new Set(['ready', 'authorize', 'locked', 'conflict']);
const cleanupStates = new Set(['complete', 'partial', 'deferred']);
const cleanupReasons = new Set(['none', 'current', 'authorization', 'failed']);

// Only the trusted main process supplies this fixed native resource path.
// The native helper authenticates its signed parent before touching Keychain.
// `confirmMigration` is asked once per launch, only when the next request is
// expected to open the one-time system authorization for copying the key.
export function createCredentialEncryption(
  executable: string,
  confirmMigration?: () => Promise<boolean>,
  language: () => 'zh-CN' | 'en' | Promise<'zh-CN' | 'en'> = () => 'zh-CN',
  packaged = true,
): MacCredentialEncryption {
  if (!packaged) {
    const code = 'VOXCUE_CREDENTIAL_SIGNED_APP_REQUIRED';
    const unavailableReason = credentialProblemMessages[code];
    const reject = async (): Promise<never> => { throw Object.assign(Error(unavailableReason), { code }); };
    return { unavailableReason, encrypt: reject, decrypt: reject, maintain: async () => undefined };
  }
  type Request = {
    operation: Operation;
    value?: Buffer;
    resolve: (reply: unknown) => void;
    reject: (error: Error) => void;
  };
  const waiting: Request[] = [];
  let active = false;
  let failed: Error | undefined;
  let noticeAccepted = !confirmMigration;
  const unavailable = () =>
    new CredentialUnavailableError(credentialProblemMessages.VOXCUE_CREDENTIAL_UNAVAILABLE);
  const invalid = () =>
    new CredentialUnavailableError(
      'macOS 凭据加密助手返回无效，登录信息未更改；已停止重复请求，请重新启动 VoxCue 后重试。',
    );

  function run(operation: Operation, value?: Buffer): Promise<unknown> {
    try {
      const selected = language();
      return typeof selected === 'string'
        ? runNative(operation, selected, value)
        : Promise.resolve(selected).then((resolved) => runNative(operation, resolved, value));
    } catch {
      return Promise.reject(invalid());
    }
  }

  function runNative(
    operation: Operation,
    requestLanguage: 'zh-CN' | 'en',
    value?: Buffer,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (requestLanguage !== 'zh-CN' && requestLanguage !== 'en') {
        reject(invalid());
        return;
      }
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(executable, [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          // Security.framework selects the current OS user's Keychain. No shell,
          // Node, DYLD, profile or authentication environment reaches this fixed
          // hardened binary.
          env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        });
      } catch {
        reject(unavailable());
        return;
      }
      const output: Buffer[] = [];
      let size = 0;
      let diagnostic = '';
      let oversized = false;
      let processError = false;
      let closed = false;
      let stopping = false;
      let forceStop: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (closed || stopping) return;
        stopping = true;
        try {
          child.kill('SIGTERM');
        } catch {
          /* Close remains the retirement evidence. */
        }
        if (!closed)
          forceStop = setTimeout(() => {
            if (!closed) {
              try {
                child.kill('SIGKILL');
              } catch {
                /* No replacement is allowed after failure. */
              }
            }
          }, 2000);
      };
      const stopOnExit = () => {
        if (!closed) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* The parent cannot wait during exit. */
          }
        }
      };
      process.once('exit', stopOnExit);
      const timer = setTimeout(() => {
        // The caller must finish even if a stuck helper never closes. Failure
        // latches below, so neither queued nor later background work can open
        // another authorization dialog or bypass this still-running child.
        reject(new CredentialTimeoutError(credentialProblemMessages.VOXCUE_CREDENTIAL_TIMEOUT));
        stop();
      }, 120000);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          oversized = true;
          stop();
        } else output.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (diagnostic.length < 512)
          diagnostic += chunk.toString('utf8').slice(0, 512 - diagnostic.length);
      });
      child.once('error', () => {
        processError = true;
        // A live child can emit error before close. Keep the shared queue fenced.
        if (child.pid) stop();
      });
      child.stdin.on('error', () => {}); // Exit/denial is reported by close.
      child.once('close', (code) => {
        closed = true;
        process.removeListener('exit', stopOnExit);
        clearTimeout(timer);
        clearTimeout(forceStop);
        if (code !== 0 || processError) {
          // A damaged record must not prevent the user from explicitly signing
          // in again. Only this exact, closed native data failure is recoverable;
          // permission, identity, protocol and process errors remain fenced.
          if (
            !processError &&
            code === 80 &&
            operation === 'decrypt' &&
            /^VoxCue credential operation failed \(-26275\)\.\s*$/.test(diagnostic)
          ) {
            reject(new CredentialDataError('登录凭据无效，请重新登录。'));
            return;
          }
          const denied = /\(-128\)|\(-25293\)|\(-25308\)/.test(diagnostic);
          reject(
            new CredentialUnavailableError(
              denied
                ? 'macOS 钥匙串授权未完成，登录信息保持原样；已停止重复请求，请重新启动 VoxCue 后重试。'
                : unavailable().message,
            ),
          );
          return;
        }
        try {
          if (oversized) throw Error('Oversized credential helper response');
          resolve(JSON.parse(Buffer.concat(output).toString('utf8')));
        } catch {
          reject(invalid());
        }
      });
      child.stdin.end(
        JSON.stringify({
          operation,
          language: requestLanguage,
          ...(value ? { data: value.toString('base64') } : {}),
        }),
      );
    });
  }

  const record = (reply: unknown, keys: string[]) => {
    if (
      !reply ||
      typeof reply !== 'object' ||
      Array.isArray(reply) ||
      Object.keys(reply).sort().join() !== [...keys].sort().join()
    )
      throw invalid();
    return reply as Record<string, unknown>;
  };
  const payload = (reply: unknown) => {
    const { data } = record(reply, ['data']);
    if (
      typeof data !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
    )
      throw invalid();
    return Buffer.from(data, 'base64');
  };
  const probeState = (reply: unknown) => {
    const { state } = record(reply, ['state']);
    if (typeof state !== 'string' || !probeStates.has(state)) throw invalid();
    return state;
  };
  const validationPayload = (reply: unknown) => {
    if (reply && typeof reply === 'object' && 'validation' in reply) {
      const { validation } = record(reply, ['validation']);
      if (validation !== 'unavailable' && validation !== 'invalid') throw invalid();
      return undefined;
    }
    return payload(reply);
  };
  const cleanupResult = (reply: unknown): CredentialCleanup => {
    const value = record(reply, ['cleanup', 'removed', 'retained', 'retainedItems', 'reason']);
    const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 32;
    const aliases = value.retainedItems;
    if (
      !cleanupStates.has(value.cleanup as string) ||
      !cleanupReasons.has(value.reason as string) ||
      !count(value.removed) ||
      !Array.isArray(aliases) ||
      aliases.length > credentialRetainedItemIds.length ||
      aliases.some(
        (id: unknown) =>
          !credentialRetainedItemIds.includes(id as (typeof credentialRetainedItemIds)[number]),
      ) ||
      new Set(aliases).size !== aliases.length
    )
      throw invalid();
    if (value.retained === null) {
      if (
        value.cleanup !== 'deferred' ||
        value.removed !== 0 ||
        aliases.length ||
        value.reason === 'none'
      )
        throw invalid();
    } else if (
      !count(value.retained) ||
      (value.removed as number) + (value.retained as number) > 32 ||
      (value.retained === 0
        ? aliases.length !== 0
        : !aliases.length || aliases.length > (value.retained as number)) ||
      (value.cleanup === 'complete'
        ? value.retained !== 0 || value.reason !== 'none'
        : value.reason === 'none' ||
          value.retained === 0 ||
          (value.cleanup === 'partial' ? value.removed === 0 : value.removed !== 0))
    )
      throw invalid();
    return {
      cleanup: value.cleanup as CredentialCleanup['cleanup'],
      removed: value.removed as number,
      retained: value.retained as number | null,
      retainedItems: aliases as CredentialCleanup['retainedItems'],
      reason: value.reason as CredentialCleanup['reason'],
    };
  };

  async function execute(request: Request): Promise<unknown> {
    if (!noticeAccepted && (request.operation === 'encrypt' || request.operation === 'decrypt')) {
      // The probe never opens a dialog. Explain the single system authorization
      // before it appears; declining keeps every entry and file untouched.
      const state = probeState(await run('probe'));
      if (state === 'locked' || state === 'conflict') {
        const error = Object.assign(unavailable(), {
          code: state === 'conflict' ? 'VOXCUE_CREDENTIAL_CONFLICT' : 'VOXCUE_CREDENTIAL_LOCKED',
        });
        throw error;
      }
      if (state === 'authorize') {
        if (!(await confirmMigration!()))
          throw new CredentialUnavailableError(
            'macOS 钥匙串迁移已暂停，登录信息保持原样；请重新启动 VoxCue 后继续。',
          );
        noticeAccepted = true;
      }
    }
    const reply = await run(request.operation, request.value);
    if (request.operation === 'probe') probeState(reply);
    else if (request.operation === 'cleanup') cleanupResult(reply);
    else if (request.operation === 'validate') validationPayload(reply);
    else payload(reply);
    return reply;
  }

  function drain() {
    if (active || failed) return;
    const request = waiting.shift();
    if (!request) return;
    active = true;
    void execute(request)
      .then(request.resolve, (error: unknown) => {
        if (error instanceof CredentialDataError) {
          request.reject(error);
          return;
        }
        // All stores share this instance. Re-running a request after denial or
        // partial failure would repeat system prompts. Cache only failure, never
        // a password or a successful authorization flag.
        failed =
          error instanceof CredentialUnavailableError || error instanceof CredentialTimeoutError
            ? error
            : unavailable();
        request.reject(failed);
        for (const pending of waiting.splice(0)) pending.reject(failed);
      })
      .finally(() => {
        active = false;
        drain();
      });
  }
  function enqueue(operation: Operation, value?: Buffer): Promise<unknown> {
    if (failed) return Promise.reject(failed);
    if (waiting.length + Number(active) >= 32)
      return Promise.reject(Error('macOS 凭据操作繁忙，请稍后重试。'));
    return new Promise((resolve, reject) => {
      waiting.push({
        operation,
        value: value ? Buffer.from(value) : undefined,
        resolve,
        reject,
      });
      drain();
    });
  }
  return {
    encrypt: async (value) => payload(await enqueue('encrypt', Buffer.from(value, 'utf8'))),
    decrypt: async (value) => payload(await enqueue('decrypt', value)).toString('utf8'),
    async maintain(readable) {
      if (failed || probeState(await enqueue('probe')) !== 'ready') return undefined;
      let validationFailed = false;
      try {
        if (
          !(await readable(async (value) => {
            // Native validate only reads the existing owned item, with UI
            // disabled. A probe cannot make a later interactive decrypt safe.
            const plain = validationPayload(await enqueue('validate', value));
            if (!plain) {
              validationFailed = true;
              throw new CredentialValidationError();
            }
            return plain.toString('utf8');
          })) ||
          validationFailed
        )
          return undefined;
      } catch (error) {
        if (error instanceof CredentialValidationError) return undefined;
        throw error;
      }
      return cleanupResult(await enqueue('cleanup'));
    },
  };
}
