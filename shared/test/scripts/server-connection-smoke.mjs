import assert from 'node:assert/strict';
import path from 'node:path';
import workspace from '../../scripts/workspace.mjs';
import { testRoot } from './test-workspace.mjs';
import { Store, Auth, loadConfig, createApi, Services, routes } from './server-reference.mjs';
import { once } from 'node:events';

// Actual client transport against a read-only 0.5.3 checkout and owner-only temporary database.
// No production origin, mail, accounts or cloud data participate.
const { CloudAccountClient, cloudOrigin } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/cloud/client.js'),
);
const config = loadConfig({
  AUTH_KEY: 'de'.repeat(32),
  DATABASE_FILE: path.join(testRoot, 'connection.sqlite'),
  FEATURE_BACKUPS: '1',
});
const store = new Store(config.database),
  auth = new Auth(store, config, true),
  services = new Services(auth);
await services.start();
const api = createApi(auth, () => {}, routes(services));
api.server.listen(0, '127.0.0.1');
await once(api.server, 'listening');
const origin = cloudOrigin('http://127.0.0.1:' + api.server.address().port, true);
assert.ok(origin);
try {
  const get = async (route) => {
    const response = await fetch(origin + route, {
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    });
    return { status: response.status, body: await response.json() };
  };
  const capabilities = await get('/v1/capabilities');
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.body.apiVersion, 'v1');
  assert.equal(capabilities.body.backupFormat, 'opaque-bundle-v1');
  assert.deepEqual(capabilities.body.backupKinds, ['profile', 'history', 'knowledgebase']);
  assert.equal(capabilities.body.access, 'free');
  assert.equal(capabilities.body.serverVersion, '0.5.3');
  assert.deepEqual(Object.keys(capabilities.body.features), ['backups']);
  assert.equal(capabilities.body.accountDeletion, 'account-erasure-v1');
  assert.equal(capabilities.body.billing, undefined);
  assert.equal(capabilities.body.zeroCreditRetentionDays, undefined);
  assert.equal(capabilities.body.limits.storageCapacityBytes, 100000000);
  assert.equal(capabilities.body.limits.profileExemptFromStorageCapacity, true);
  assert.equal(capabilities.body.limits.passwordMinLength, 8);
  assert.equal(capabilities.body.limits.passwordMaxLength, 128);
  for (const route of ['/v1/account', '/v1/backups', '/v1/entitlements'])
    assert.equal((await get(route)).status, 401, route + ' must require authentication');
  // The free server puts unknown protected routes behind authentication; authenticated 404
  // is covered by the isolated protocol fixture.
  assert.equal((await get('/v1/payments/products')).status, 401);
  let cleared = false;
  const client = new CloudAccountClient({
    origin,
    deviceLabel: 'Synthetic read-only connection check',
    vault: {
      async read() {
        return {
          origin,
          credentials: {
            user: {
              id: 'a0000000-0000-4000-8000-000000000001',
              email: 'synthetic@example.test',
              createdAt: 1,
            },
            sessionId: 'b0000000-0000-4000-8000-000000000001',
            accessToken: 'a'.repeat(43),
            refreshToken: 'b'.repeat(43),
            expiresAt: Date.now() + 60000,
            refreshExpiresAt: Date.now() + 120000,
          },
        };
      },
      async write() {
        throw Error('Rejected tokens must never be saved');
      },
      async clear() {
        cleared = true;
      },
    },
  });
  const status = await client.call({ action: 'status' });
  assert.equal(status.state.user, null);
  assert.equal(cleared, true);
  assert.equal(status.state.configured, true);
  console.log(
    `PASS: isolated 0.5.3 API contract, 100 MB capacity/password rules, authenticated boundaries, absent payment surfaces and actual client invalid-session cleanup; no mail or cloud data writes.`,
  );
} finally {
  await api.close();
  await services.close();
  auth.passwords.pool.close();
  store.close();
}
