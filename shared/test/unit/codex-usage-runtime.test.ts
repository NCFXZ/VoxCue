import { it, expect, vi, afterEach } from 'vitest';
import { ProviderCredentialUnavailable } from '../../electron/backend/auth/providerCredentialAccess';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CodexUsageRuntime,
  unpackedUsagePath,
  managedAccess,
} from '../../electron/backend/chat/codexUsage';
const jwt = (claims: object) =>
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') +
  '.' +
  Buffer.from(JSON.stringify(claims)).toString('base64url') +
  '.synthetic';
const token = jwt({
  sub: 'synthetic',
  email: 'synthetic@example.test',
  exp: Math.floor(Date.now() / 1000) + 3600,
  'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-workspace' },
});
it('仅接受官方托管会话，拒绝 API key、过期令牌或不透明 SIWC 元数据冒充工作区', () => {
  expect(managedAccess({ authMethod: 'chatgpt', authToken: token })).toMatchObject({
    chatgptAccountId: 'synthetic-workspace',
    account: 'synthetic:synthetic-workspace',
  });
  for (const value of [
    { authMethod: 'apikey', authToken: token },
    { authMethod: 'chatgptAuthTokens', authToken: token },
    { authMethod: 'chatgpt', authToken: jwt({ sub: 'synthetic', exp: 1 }) },
    {
      authMethod: 'chatgpt',
      authToken: jwt({
        sub: 'synthetic',
        exp: Math.floor(Date.now() / 1000) + 3600,
        'https://api.openai.com/auth': { encrypted_auth_metadata: 'opaque' },
      }),
    },
  ])
    expect(() => managedAccess(value)).toThrow('暂不可用');
});
it('安装版进程路径指向已解包的可执行文件，开发路径不变', () => {
  expect(unpackedUsagePath('/owned/Resources/app.asar/node_modules/codex')).toBe(
    '/owned/Resources/app.asar.unpacked/node_modules/codex',
  );
  expect(unpackedUsagePath('C:\\owned\\resources\\app.asar\\node_modules\\codex.exe')).toBe(
    'C:\\owned\\resources\\app.asar.unpacked\\node_modules\\codex.exe',
  );
  expect(unpackedUsagePath('/owned/node_modules/codex')).toBe('/owned/node_modules/codex');
});
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('只有官方账户RPC、独立home和keyring，无环境令牌或任意服务端请求', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-usage-runtime-'));
  roots.push(directory);
  const child: any = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  const methods: string[] = [];
  let url = 'https://auth.openai.com/authorize?state=synthetic';
  const reply = (value: any) =>
    queueMicrotask(() => child.stdout.write(JSON.stringify(value) + '\n'));
  child.stdin = new Writable({
    write(bytes, _encoding, done) {
      const request = JSON.parse(bytes.toString());
      if (request.method) {
        methods.push(request.method);
        if (request.method === 'initialize')
          expect(request.params.clientInfo.version).toBe('0.5.9');
        let result: any = {};
        if (request.method === 'account/read')
          result = {
            account: { type: 'chatgpt', email: 'synthetic@example.test', planType: 'pro' },
          };
        if (request.method === 'getAuthStatus') {
          expect(request.params).toEqual({ includeToken: true, refreshToken: false });
          result = { authMethod: 'chatgpt', authToken: token };
        }
        if (request.method === 'account/login/start')
          result = { type: 'chatgpt', loginId: 'owned', authUrl: url };
        if (request.method === 'account/rateLimits/read') {
          expect(request.params).toEqual({ excludeResetCreditDetails: true });
          result = { rateLimits: { secondary: { usedPercent: 20, windowDurationMins: 10080 } } };
        }
        if (request.id) reply({ id: request.id, result });
      } else expect(request).toMatchObject({ id: 'server', error: { code: -32601 } });
      done();
    },
  });
  child.kill = vi.fn(() => {
    child.exitCode = 0;
    child.emit('exit', 0);
    return true;
  });
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-private');
  vi.stubEnv('CODEX_HOME', 'synthetic-other-app');
  const launch = vi.fn((_command: any, args: any, options: any) => {
    expect(args).toContain('cli_auth_credentials_store="keyring"');
    expect(options.env.CODEX_HOME).toBe(directory);
    expect(options.env.OPENAI_API_KEY).toBeUndefined();
    expect(options.env.RUST_LOG).toBe('codex_keyring_store=trace,codex_login::auth::storage=warn');
    expect(options.env.LOG_FORMAT).toBe('json');
    expect(options.cwd).toBe(path.join(directory, 'workspace'));
    return child;
  });
  const runtime = new CodexUsageRuntime(directory, launch as any, '0.5.9');
  try {
    expect((await runtime.account())?.planType).toBe('pro');
    expect((await runtime.access()).chatgptAccountId).toBe('synthetic-workspace');
    await runtime.limits();
    reply({ id: 'server', method: 'item/tool/call', params: {} });
    const open = vi.fn(async () =>
      reply({ method: 'account/login/completed', params: { loginId: 'owned', success: true } }),
    );
    await runtime.login(open, new AbortController().signal);
    expect(open).toHaveBeenCalledOnce();
    url = 'file:///private/unsupported';
    await expect(runtime.login(open, new AbortController().signal)).rejects.toThrow('暂不可用');
    expect(open).toHaveBeenCalledOnce();
    expect(
      methods.every((method) =>
        [
          'initialize',
          'initialized',
          'account/read',
          'getAuthStatus',
          'account/rateLimits/read',
          'account/login/start',
          'account/login/cancel',
        ].includes(method),
      ),
    ).toBe(true);
  } finally {
    await runtime.stop();
  }
  expect(child.kill).toHaveBeenCalled();
});

async function credentialFixture(signedIn: boolean) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-usage-runtime-'));
  roots.push(directory);
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn(() => {
      child.signalCode = 'SIGTERM';
      child.emit('exit', null, 'SIGTERM');
      child.emit('close', null, 'SIGTERM');
      return true;
    }),
  });
  const requests: Array<{ method: string; id: number }> = [];
  let onRequest = (request: { method: string; id: number }) => {
    child.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\n');
  };
  child.stdin.on('data', (bytes) => {
    const request = JSON.parse(bytes.toString());
    requests.push(request);
    if (request.id) onRequest(request);
  });
  const launch = vi.fn(() => child);
  const status = vi.fn(
    async (
      _executable: string,
      _options: { cwd: string; env: NodeJS.ProcessEnv },
      _signal: AbortSignal,
    ): Promise<'signed-in' | 'empty'> => (signedIn ? 'signed-in' : 'empty'),
  );
  const runtime = new CodexUsageRuntime(directory, launch as any, 'synthetic', status);
  const respond = (id: number, result: unknown) =>
    child.stdout.write(JSON.stringify({ id, result }) + '\n');
  return {
    runtime,
    child,
    launch,
    status,
    requests,
    respond,
    onRequest(handler: typeof onRequest) {
      onRequest = handler;
    },
  };
}

it.each([
  'startup stderr',
  'RPC',
  'denied RPC',
  'interaction blocked RPC',
  'denied stderr',
  'stderr after exit',
  'silent existing item',
] as const)('本地凭据不可用后拒绝待处理和新增调用，不重启子进程 (%s)', async (scenario) => {
  const f = await credentialFixture(true);
  f.onRequest(({ id, method }) => {
    if (method === 'initialize') {
      if (scenario === 'startup stderr') {
        f.child.stderr.write('{"fields":{"message":"keyring.lo');
        f.child.stderr.write('ad error"},"target":"codex_keyring_store"}\n');
      } else f.respond(id, {});
    } else if (method === 'account/read') {
      if (scenario === 'silent existing item') f.respond(id, { account: null });
      else if (
        scenario === 'RPC' ||
        scenario === 'denied RPC' ||
        scenario === 'interaction blocked RPC'
      )
        f.child.stdout.write(
          JSON.stringify({
            id,
            error: {
              message:
                scenario === 'denied RPC'
                  ? 'failed to load CLI auth from keyring: errSecAuthFailed'
                  : scenario === 'interaction blocked RPC'
                    ? 'OSStatus -25308'
                    : 'failed to load CLI auth from keyring: synthetic-private diagnostic',
            },
          }) + '\n',
        );
      else if (scenario === 'denied stderr') {
        f.child.stderr.write('failed to load CLI auth from keyring: Platform secure ');
        f.child.stderr.write(
          'storage failure: The user name or passphrase you entered is not correct.\n',
        );
      } else {
        f.child.exitCode = 1;
        f.child.emit('exit', 1);
        f.child.stderr.write('failed to load CLI auth from keyring\n');
        f.child.emit('close', 1);
      }
    }
  });
  const open = vi.fn();
  const attempts = await Promise.allSettled([
    f.runtime.account(),
    f.runtime.access(),
    f.runtime.limits(),
    f.runtime.login(open, new AbortController().signal),
    f.runtime.logout(true),
  ]);
  for (const attempt of attempts) {
    expect(attempt.status).toBe('rejected');
    if (attempt.status === 'rejected') {
      expect(attempt.reason).toBeInstanceOf(ProviderCredentialUnavailable);
      expect(attempt.reason.reason).toBe(scenario.startsWith('denied') ? 'denied' : 'unavailable');
      expect(attempt.reason.message).not.toContain('synthetic-private');
    }
  }
  expect(open).not.toHaveBeenCalled();
  expect(f.requests.map((r) => r.method)).toEqual(
    scenario === 'startup stderr' ? ['initialize'] : ['initialize', 'initialized', 'account/read'],
  );
  await f.runtime.stop();
  await expect(f.runtime.account()).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
  expect(f.launch).toHaveBeenCalledOnce();
  expect(f.status).toHaveBeenCalledOnce();
});

it('不存在的条目和无关 OAuth 拒绝不锁存，同一次运行仍能读取或发起授权', async () => {
  const f = await credentialFixture(false);
  f.onRequest(({ id, method }) => {
    if (method === 'account/read') {
      f.child.stderr.write(
        '{"fields":{"message":"keyring.load no entry"},"target":"codex_keyring_store"}\n',
      );
      f.respond(id, { account: null });
    } else if (method === 'account/login/start') {
      f.respond(id, {
        type: 'chatgpt',
        loginId: 'owned',
        authUrl: 'https://auth.openai.com/authorize',
      });
    } else f.respond(id, {});
  });
  try {
    expect(await f.runtime.account()).toBeNull();
    expect(f.launch).not.toHaveBeenCalled();
    const open = vi.fn(async () => {
      f.child.stdout.write(
        JSON.stringify({
          method: 'account/login/completed',
          params: {
            loginId: 'owned',
            success: false,
            error: 'provider OAuth authorization was denied',
          },
        }) + '\n',
      );
    });
    await expect(f.runtime.login(open, new AbortController().signal)).rejects.toThrow('登录未完成');
    expect(open).toHaveBeenCalledOnce();
    expect(await f.runtime.account()).toBeNull();
    expect(f.launch).toHaveBeenCalledOnce();
  } finally {
    await f.runtime.stop();
  }
});

it('状态已登录后仅执行所请求的 account/read', async () => {
  const f = await credentialFixture(true);
  f.onRequest(({ id, method }) =>
    f.respond(
      id,
      method === 'account/read'
        ? { account: { type: 'chatgpt', email: 'synthetic@example.test', planType: 'plus' } }
        : {},
    ),
  );
  try {
    expect(await f.runtime.account()).toEqual({
      email: 'synthetic@example.test',
      planType: 'plus',
    });
    expect(f.requests.map((r) => r.method)).toEqual(['initialize', 'initialized', 'account/read']);
  } finally {
    await f.runtime.stop();
  }
});
it('登录完成通知中的钥匙串写入失败立即停止，重新登录或注销不再触发请求', async () => {
  const f = await credentialFixture(false);
  f.onRequest(({ id, method }) => {
    f.respond(
      id,
      method === 'account/login/start'
        ? {
            type: 'chatgpt',
            loginId: 'owned',
            authUrl: 'https://auth.openai.com/authorize',
          }
        : {},
    );
  });
  const open = vi.fn(async () => {
    f.child.stdout.write(
      JSON.stringify({
        method: 'account/login/completed',
        params: {
          loginId: 'owned',
          success: false,
          error: 'failed to write OAuth tokens to keyring: synthetic-private',
        },
      }) + '\n',
    );
  });
  await expect(f.runtime.login(open, new AbortController().signal)).rejects.toBeInstanceOf(
    ProviderCredentialUnavailable,
  );
  await expect(f.runtime.logout(true)).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
  expect(f.requests.map((r) => r.method)).toEqual([
    'initialize',
    'initialized',
    'account/login/start',
  ]);
  expect(open).toHaveBeenCalledOnce();
});

it('状态检查报告拒绝时不启动 app-server，排队和后续调用保持拒绝', async () => {
  const f = await credentialFixture(true);
  f.status.mockRejectedValueOnce(new ProviderCredentialUnavailable('chatgpt', 'denied'));
  const result = await Promise.allSettled([
    f.runtime.account(),
    f.runtime.access(),
    f.runtime.logout(true),
  ]);
  for (const entry of result)
    expect(entry).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ reason: 'denied' }),
    });
  expect(f.launch).not.toHaveBeenCalled();
  expect(f.status).toHaveBeenCalledOnce();
});
it('退出会中止进行中的状态检查，即使迟到返回成功也不启动 app-server', async () => {
  const f = await credentialFixture(true);
  let ready!: () => void;
  const entered = new Promise<void>((resolve) => {
    ready = resolve;
  });
  f.status.mockImplementationOnce(async (_file, _opts, signal) => {
    ready();
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    return 'signed-in';
  });
  const pending = f.runtime.account();
  await entered;
  await f.runtime.stop();
  await expect(pending).rejects.toThrow();
  expect(f.launch).not.toHaveBeenCalled();
});

it('取消 OAuth 登录立即中止独立状态检查，迟到成功不启动进程，再次主动登录仍可用', async () => {
  const f = await credentialFixture(false);
  const login = new AbortController();
  let enter!: (signal: AbortSignal) => void;
  const began = new Promise<AbortSignal>((resolve) => {
    enter = resolve;
  });
  f.status.mockImplementationOnce(async (_file, _options, signal) => {
    enter(signal);
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    return 'signed-in';
  });
  const open = vi.fn();
  const pending = f.runtime.login(open, login.signal);
  const running = await began;
  login.abort();
  expect(running.aborted).toBe(true);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(open).not.toHaveBeenCalled();
  expect(f.launch).not.toHaveBeenCalled();
  expect(await f.runtime.account()).toBeNull();
  expect(f.status).toHaveBeenCalledTimes(2);
});

it.each([
  'initialize',
  'account/read',
  'getAuthStatus',
  'account/login/start',
  'account/logout',
  'account/rateLimits/read',
])('Mac 凭据 RPC 超时收尾，远端额度超时保留原运行时 (%s)', async (method) => {
  const f = await credentialFixture(true);
  let enter!: () => void;
  const hanging = new Promise<void>((resolve) => {
    enter = resolve;
  });
  f.onRequest(({ id, method: requested }) => {
    if (requested === method) enter();
    else if (requested === 'account/read')
      f.respond(id, {
        account: { type: 'chatgpt', email: 'synthetic@example.test', planType: 'plus' },
      });
    else f.respond(id, {});
  });
  vi.useFakeTimers();
  try {
    const request =
      method === 'account/logout'
        ? f.runtime.logout(true)
        : method === 'account/login/start'
          ? f.runtime.login(vi.fn(), new AbortController().signal)
          : method === 'getAuthStatus'
            ? f.runtime.access()
            : method === 'account/rateLimits/read'
              ? f.runtime.limits()
              : f.runtime.account();
    const results = Promise.allSettled([request, f.runtime.account()]);
    await hanging;
    await vi.advanceTimersByTimeAsync(15000);
    const [first, queued] = await results;
    if (method === 'account/rateLimits/read') {
      expect(first).toMatchObject({ status: 'rejected', reason: expect.any(Error) });
      if (first.status === 'rejected')
        expect(first.reason).not.toBeInstanceOf(ProviderCredentialUnavailable);
      expect(queued).toMatchObject({ status: 'fulfilled', value: { planType: 'plus' } });
      expect(f.child.kill).not.toHaveBeenCalled();
    } else {
      expect(first).toMatchObject({
        status: 'rejected',
        reason: expect.any(ProviderCredentialUnavailable),
      });
      expect(queued).toMatchObject({
        status: 'rejected',
        reason: expect.any(ProviderCredentialUnavailable),
      });
      if (first.status === 'rejected') expect(first.reason.reason).toBe('unavailable');
      expect(f.child.kill).toHaveBeenCalledOnce();
      expect(f.requests.map((r) => r.method)).toEqual(
        method === 'initialize' ? ['initialize'] : ['initialize', 'initialized', method],
      );
      await expect(f.runtime.limits()).rejects.toBeInstanceOf(ProviderCredentialUnavailable);
    }
    expect(f.status).toHaveBeenCalledOnce();
    expect(f.launch).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
    await f.runtime.stop();
  }
});
