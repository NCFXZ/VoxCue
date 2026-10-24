import { it, expect, vi, afterEach } from 'vitest';
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
          expect(request.params).toEqual({ includeToken: true, refreshToken: true });
          result = { authMethod: 'chatgpt', authToken: token };
        }
        if (request.method === 'account/login/start')
          result = { type: 'chatgpt', loginId: 'owned', authUrl: url };
        if (request.method === 'account/rateLimits/read')
          result = { rateLimits: { secondary: { usedPercent: 20, windowDurationMins: 10080 } } };
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
