import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { serverRoot } from './server-reference.mjs';

// Explicit, read-only checkout; every service/store below uses its own temporary database.
const { adminFixture } = await import(
  pathToFileURL(path.join(serverRoot, 'test/admin-fixture.ts')).href
);
const require = createRequire(path.join(workspace.platformRoot, 'package.json'));
const { Telemetry } = require(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/telemetry/service.js'),
);
const { CloudAccountClient } = require(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/cloud/client.js'),
);
const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-client-v2-http-'));
const previousTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
await mkdir(path.join(root, 'server-fixtures'));
process.env.TEMP = process.env.TMP = path.join(root, 'server-fixtures');
let f, client;
try {
  f = await adminFixture('owner', { startAt: Date.now() });
  assert.equal(new URL(f.origin).hostname, '127.0.0.1');
  const password = 'synthetic client protocol password 375!';
  f.store.run('UPDATE users SET password_hash=?', await f.auth.passwords.hash(password));
  let credentials = null,
    proofState = null;
  const account = new CloudAccountClient({
    origin: f.origin,
    deviceLabel: 'Synthetic client',
    vault: {
      read: async () => credentials,
      write: async (value) => {
        credentials = value;
      },
      clear: async () => {
        credentials = null;
      },
    },
  });
  const requests = [],
    receipts = [];
  let partial = true;
  client = new Telemetry({
    root,
    version: require('./package.json').version,
    platform: workspace.platformName === 'macos' ? 'macos' : 'windows',
    enabled: true,
    origin: f.origin,
    now: () => f.now(),
    monotonic: () => f.now(),
    proofVault: {
      read: async () => proofState,
      write: async (value) => {
        proofState = structuredClone(value);
      },
    },
    identityProvider: (installationId, userId, signal) =>
      account.telemetryIdentity(installationId, userId, signal),
    fetcher: async (url, init) => {
      assert.equal(new URL(url).origin, f.origin);
      if (init.method === 'POST') {
        assert.equal(new Headers(init.headers).has('authorization'), false);
        const body = JSON.parse(init.body);
        requests.push(body);
        const disk = JSON.parse(await readFile(path.join(root, 'telemetry-queue.json'), 'utf8'));
        const installation = JSON.parse(
          await readFile(path.join(root, 'telemetry-installation.json'), 'utf8'),
        );
        assert.equal(disk.sequence, body.health.sequence);
        assert.equal(installation.sequence, disk.sequence);
        assert.ok(body.events.every((e) => disk.events.some((d) => d.id === e.id)));
        const response = await fetch(url, init),
          receipt = await response.json();
        assert.equal(response.status, 200, JSON.stringify(receipt));
        receipts.push(receipt);
        if (partial && receipt.acceptedIds.length > 1) {
          partial = false;
          // Exercise a lossy acknowledgement without changing the real server's committed transaction.
          return Response.json({ ...receipt, acceptedIds: receipt.acceptedIds.slice(0, 1) });
        }
        return Response.json(receipt);
      }
      return fetch(url, init);
    },
  });
  const disk = async () => {
    await client.settle();
    return JSON.parse(await readFile(path.join(root, 'telemetry-queue.json'), 'utf8'));
  };
  client.setIdentity({ accountMode: 'local' });
  client.entry('local');
  client.activity('history_view');
  for (const userId of [f.first, f.second]) {
    const user = f.store.userById(userId);
    const result = await account.call({ action: 'login', email: user.email, password });
    assert.equal(result.ok, true, result.error);
    client.setIdentity({ accountMode: 'account', userId }, true);
    client.entry('login', user.created_at);
    client.activity('knowledge_view');
    await client.settle();
  }
  assert.equal((await account.call({ action: 'logout' })).ok, true);
  client.setIdentity({ accountMode: 'local' });
  const before = await disk();
  assert.equal(before.events.length, 6);
  assert.equal(JSON.stringify(before).includes('identityProof'), false);
  assert.equal(JSON.stringify(before).includes('userId'), false);
  await client.flush();
  assert.equal(
    (await disk()).events.length,
    5,
    'Only explicitly acknowledged records leave the queue',
  );
  f.advance(31000);
  await client.flush();
  assert.equal(
    (await disk()).events.length,
    0,
    'Real server accepts duplicate delivery idempotently',
  );
  assert.deepEqual(
    receipts.map((r) => r.rejected),
    [[], []],
  );
  const accountEvents = requests[0].events.filter((e) => e.accountMode === 'account');
  const subjects = accountEvents.map(
    (e) => JSON.parse(Buffer.from(e.identityProof.split('.')[1], 'base64url')).sub,
  );
  assert.deepEqual([...new Set(subjects)], [f.first, f.second]);
  assert.ok(requests[0].events.every((e) => !('userId' in e) && !('identityRef' in e)));
  f.advance(31000);
  await client.flush();
  assert.deepEqual(requests.at(-1).events, []);
  assert.equal(requests.at(-1).health.pendingEvents, 0);
  assert.deepEqual(
    requests.map((r) => r.health.sequence),
    [1, 2, 3],
  );
  const query = await f.call('/admin/api/telemetry');
  assert.equal(query.status, 200);
  console.log(
    'V2 real loopback HTTP | passed | capabilities, real login/tickets, local + two accounts, logout, durable sequence, partial receipt, duplicate replay, empty health and admin query',
  );
} finally {
  await client?.close();
  await f?.close();
  for (const [key, value] of Object.entries(previousTemp)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
}
