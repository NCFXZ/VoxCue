// Bundled into the read-only input of a fresh, offline Windows Sandbox only.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { isolatedSession } from '../../../shared/electron/backend/copilot/runtime.ts';
import { CopilotAuthService } from '../../../shared/electron/backend/copilot/auth.ts';

async function main() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.USERNAME?.toLowerCase(), 'wdagutilityaccount');
  const [configFile, outputFile, work] = process.argv.slice(2);
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  assert.equal(config.task, 'copilot-vault');
  assert.ok(work.toLowerCase().startsWith('c:\\users\\wdagutilityaccount\\'));
  const clients = new Set();
  const login = 'VoxCueSyntheticVault';
  const tokenA = 'gho_' + 'A'.repeat(36);
  const tokenB = 'gho_' + 'B'.repeat(36);
  const vaultTargets = () =>
    JSON.parse(
      execFileSync(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Add-Type -Path 'C:\\VoxCueStoreInput\\CopilotVaultTargets.cs'; ConvertTo-Json -InputObject @([CopilotVaultTargets]::Names()) -Compress",
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 },
      ).trim(),
    );
  let stage = 'starting';
  const api = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/user') response.end(JSON.stringify({ login, id: 123456, type: 'User' }));
    else if (pathname === '/copilot_internal/user')
      response.end(
        JSON.stringify({
          login,
          copilot_plan: 'individual',
          access_type_sku: 'copilot_individual',
          chat_enabled: true,
          assigned_date: '2026-01-01T00:00:00Z',
        }),
      );
    else if (pathname === '/copilot_internal/v2/token')
      response.end(
        JSON.stringify({
          token: 'synthetic-local-service-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_in: 3000,
          endpoints: { api: `http://127.0.0.1:${api.address().port}` },
        }),
      );
    else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${api.address().port}`;
  async function start(name) {
    const directory = path.join(work, name);
    await mkdir(directory, { recursive: true });
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (/^(?:COPILOT_|GITHUB_|GH_|OTEL_)/i.test(key)) delete env[key];
    Object.assign(env, {
      GH_CONFIG_DIR: path.join(directory, 'gh-unused'),
      COPILOT_DEBUG_GITHUB_API_URL: origin,
      COPILOT_API_URL: origin,
      HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1',
      ALL_PROXY: 'http://127.0.0.1:1',
      NO_PROXY: '127.0.0.1,localhost',
    });
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({
        path: 'C:\\VoxCueStoreInput\\runtime\\copilot-runtime.exe',
      }),
      mode: 'copilot-cli',
      // The independent CLI keeps its actual default guest profile; VoxCue has
      // its explicit baseDirectory, exactly as in the shipped integration.
      ...(name === 'system-cli' ? {} : { baseDirectory: directory }),
      workingDirectory: directory,
      env,
      useLoggedInUser: true,
      enableRemoteSessions: false,
      logLevel: 'none',
    });
    clients.add(client);
    await client.start();
    return client;
  }
  async function stop(client) {
    await client.stop();
    clients.delete(client);
  }
  async function containsToken(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (await containsToken(file)) return true;
      } else if (entry.isFile()) {
        const bytes = await readFile(file);
        if ([tokenA, tokenB].some((token) => bytes.includes(Buffer.from(token)))) return true;
      }
    }
    return false;
  }
  let result;
  const deadline = setTimeout(() => process.exit(2), 120000);
  try {
    const baselineTargets = vaultTargets();
    stage = 'seed-cli';
    let cli = await start('system-cli');
    assert.equal(
      (await cli.rpc.account.login({ host: 'https://github.com', login, token: tokenB }))
        .storedInVault,
      true,
    );
    await stop(cli);
    const cliTargets = vaultTargets();
    const ownedTargets = cliTargets.filter((name) => !baselineTargets.includes(name));
    assert.ok(ownedTargets.length > 0, 'The synthetic CLI must create a real guest vault entry');
    stage = 'seed-voxcue';
    const voxcue = await start('voxcue');
    assert.equal(
      (await voxcue.rpc.account.login({ host: 'https://github.com', login, token: tokenA }))
        .storedInVault,
      true,
    );
    await stop(voxcue);
    const appTargets = vaultTargets();
    const sharedSlot =
      ownedTargets.every((name) => appTargets.includes(name)) &&
      appTargets.every((name) => cliTargets.includes(name));
    stage = 'read-cli-after-other-login';
    cli = await start('system-cli');
    const { authInfo: afterLogin } = await cli.rpc.account.getCurrentAuth();
    assert.equal(afterLogin?.type, 'user');
    assert.equal(afterLogin?.login, login);
    await stop(cli);
    stage = 'logout-voxcue';
    const app = await start('voxcue');
    const control = await app.createSession({ ...isolatedSession });
    const loggedOut = await control.rpc.accounts.set({ command: { kind: 'logout' } });
    assert.equal(loggedOut.ok, true);
    await stop(app);
    stage = 'read-cli-after-other-logout';
    cli = await start('system-cli');
    const { authInfo: afterLogout } = await cli.rpc.account.getCurrentAuth();
    const crossLogout = afterLogout?.type !== 'user' || afterLogout.login !== login;
    await stop(cli);
    const remainingTargets = vaultTargets();
    const removedCliSlot = ownedTargets.some((name) => !remainingTargets.includes(name));
    stage = 'reseed-cli';
    cli = await start('system-cli');
    assert.equal(
      (await cli.rpc.account.login({ host: 'https://github.com', login, token: tokenB }))
        .storedInVault,
      true,
    );
    await stop(cli);
    stage = 'voxcue-local-logout';
    const appRuntime = await start('voxcue');
    assert.equal(
      (await appRuntime.rpc.account.login({ host: 'https://github.com', login, token: tokenA }))
        .storedInVault,
      true,
    );
    const ownedSession = await appRuntime.createSession({ ...isolatedSession });
    let localSession = {
      mode: 'copilot',
      user: { id: 'github.com:' + login, name: login, email: '' },
      expiresAt: null,
    };
    let runtimeTouched = false;
    const auth = new CopilotAuthService({
      storage: {
        read: async () => localSession,
        write: async (value) => {
          localSession = value;
        },
      },
      control: async () => {
        runtimeTouched = true;
        throw Error('Global vault operations are forbidden on local logout');
      },
      openBrowser: async () => {
        throw Error('No real login is used');
      },
    });
    assert.deepEqual(await auth.signOut(), { warning: null });
    assert.equal(runtimeTouched, false);
    const localSessionCleared = (await auth.session()) === null;
    assert.equal(localSessionCleared, true);
    await assert.rejects(auth.access());
    // Match main's normal logout retirement: remove its own SDK session and
    // terminate the runtime, without deleting the provider's shared account.
    await appRuntime.deleteSession(ownedSession.sessionId);
    await stop(appRuntime);
    stage = 'read-cli-after-voxcue-local-logout';
    cli = await start('system-cli');
    const { authInfo: preserved } = await cli.rpc.account.getCurrentAuth();
    const preservedCliAfterVoxCueLogout = preserved?.type === 'user' && preserved.login === login;
    assert.equal(preservedCliAfterVoxCueLogout, true);
    await stop(cli);
    assert.equal(
      await containsToken(work),
      false,
      'Synthetic OAuth values must stay out of plaintext files',
    );
    assert.equal(await containsToken(path.join(process.env.USERPROFILE, '.copilot')), false);
    result = {
      ok: true,
      sharedSlot,
      crossLogout,
      removedCliSlot,
      preservedCliAfterVoxCueLogout,
      localSessionCleared,
      storedInVault: true,
      plaintext: false,
    };
  } catch (error) {
    // No runtime errors or account objects leave the guest: they can carry tokens.
    result = { ok: false, stage, errorType: error?.name ?? 'Error' };
  } finally {
    clearTimeout(deadline);
    await Promise.allSettled([...clients].map((client) => client.stop()));
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  }
  await writeFile(outputFile, JSON.stringify({ nonce: config.nonce, ...result }));
  process.exitCode = result.ok ? 0 : 1;
}

void main().catch(() => {
  process.exitCode = 1;
});
