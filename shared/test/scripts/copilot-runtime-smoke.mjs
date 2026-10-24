import { testRoot, trackTestProcess } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const { CopilotClient } = workspace.platformRequire('@github/copilot-sdk');
const directory = path.join(testRoot, 'copilot');
await mkdir(directory, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/^(?:COPILOT_|GITHUB_|GH_|OTEL_)/i.test(key)) delete env[key];
Object.assign(env, {
  GH_CONFIG_DIR: path.join(directory, 'gh-unused'),
  CFFIXED_USER_HOME: directory,
  XDG_CONFIG_HOME: directory,
  XDG_CACHE_HOME: directory,
  XDG_STATE_HOME: directory,
  HTTP_PROXY: 'http://127.0.0.1:1',
  HTTPS_PROXY: 'http://127.0.0.1:1',
  ALL_PROXY: 'http://127.0.0.1:1',
  NO_PROXY: '',
});
// Handshake only: empty mode disables the OS vault, ambient login and telemetry.
// No session, account query, OAuth flow, model query or inference is created.
const client = new CopilotClient({
  mode: 'empty',
  baseDirectory: directory,
  workingDirectory: directory,
  env,
  useLoggedInUser: false,
  enableRemoteSessions: false,
  logLevel: 'none',
});
let timer;
try {
  await Promise.race([
    (async () => {
      await client.start();
      if (client.cliProcess) trackTestProcess(client.cliProcess);
      const reply = await client.ping('voxcue-isolated-runtime');
      assert.equal(reply.message, 'pong: voxcue-isolated-runtime');
    })(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Copilot runtime handshake timed out')), 20000);
    }),
  ]);
  console.log(
    'PASS: pinned official Copilot subprocess starts, completes JSON-RPC handshake and ping, without login or credential access.',
  );
} finally {
  clearTimeout(timer);
  const errors = await client.stop();
  assert.equal(errors.length, 0, 'The owned Copilot subprocess must stop cleanly');
}
