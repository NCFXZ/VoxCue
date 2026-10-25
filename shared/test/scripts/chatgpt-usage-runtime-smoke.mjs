import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
const { CodexUsageRuntime } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/chat/codexUsage.js'),
);

// A dead port makes forced refresh fail immediately and hides the latency bug.
// Accept connections without answering instead; this proxy never forwards data.
const sockets = new Set();
const proxy = createServer((socket) => {
  sockets.add(socket);
  socket.on('error', () => {});
  socket.once('close', () => sockets.delete(socket));
  socket.resume();
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
const runtime = new CodexUsageRuntime(path.join(testRoot, 'usage'), (binary, args, options) => {
  // Only this synthetic test uses a private file store containing fabricated
  // tokens. Production uses keyring only, never a plaintext fallback.
  const argv = args.map((value) =>
    value === 'cli_auth_credentials_store="keyring"' ? 'cli_auth_credentials_store="file"' : value,
  );
  const env = {
    ...options.env,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    NO_PROXY: '',
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
    no_proxy: '',
    CFFIXED_USER_HOME: testRoot,
  };
  return process.platform === 'darwin'
    ? spawnTestProcess(
        '/usr/bin/sandbox-exec',
        [
          '-p',
          `(version 1)(allow default)(deny network*)(allow network-outbound (remote tcp "localhost:${proxy.address().port}"))`,
          binary,
          ...argv,
        ],
        { ...options, env },
      )
    : spawnTestProcess(binary, argv, { ...options, env });
});
try {
  assert.equal(await runtime.account(), null);
  await runtime.stop();
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token =
    part({ alg: 'none' }) +
    '.' +
    part({
      sub: 'synthetic',
      email: 'synthetic@example.test',
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'synthetic-workspace',
        chatgpt_plan_type: 'plus',
      },
    }) +
    '.synthetic';
  await writeFile(
    path.join(testRoot, 'usage/auth.json'),
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        id_token: token,
        access_token: token,
        refresh_token: 'synthetic-refresh',
        account_id: 'synthetic-workspace',
      },
      last_refresh: new Date().toISOString(),
    }),
  );
  // account/read performs workspace discovery for managed accounts and requires
  // the remote service. This offline check covers the public token handoff only.
  const started = performance.now();
  let timer;
  try {
    const access = await Promise.race([
      runtime.access(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Valid session waited for remote renewal')), 5000);
      }),
    ]);
    assert.equal(access.token, token);
  } finally {
    clearTimeout(timer);
  }
  console.log(
    `PASS: pinned official OAuth RPC, empty account and valid fabricated session restored in ${Math.round(performance.now() - started)}ms with remote traffic stalled (Mac permits only this owned loopback port); no real OAuth or system credential access.`,
  );
} finally {
  await runtime.stop();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => proxy.close(resolve));
}
