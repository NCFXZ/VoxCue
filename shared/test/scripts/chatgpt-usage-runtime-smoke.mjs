import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { CodexUsageRuntime } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/chat/codexUsage.js'),
);

const runtime = new CodexUsageRuntime(path.join(testRoot, 'usage'), (binary, args, options) => {
  // Only this synthetic test uses a private file store containing fabricated
  // tokens. Production uses keyring only, never a plaintext fallback.
  const argv = args.map((value) =>
    value === 'cli_auth_credentials_store="keyring"' ? 'cli_auth_credentials_store="file"' : value,
  );
  const env = {
    ...options.env,
    HTTP_PROXY: 'http://127.0.0.1:1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: '',
    CFFIXED_USER_HOME: testRoot,
  };
  return process.platform === 'darwin'
    ? spawnTestProcess(
        '/usr/bin/sandbox-exec',
        ['-p', '(version 1)(allow default)(deny network*)', binary, ...argv],
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
  assert.equal((await runtime.access()).token, token);
  console.log(
    'PASS: pinned official OAuth RPC, empty account and fabricated managed-session token handoff; no network, real OAuth or system credential access.',
  );
} finally {
  await runtime.stop();
}
