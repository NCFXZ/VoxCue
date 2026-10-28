import assert from 'node:assert/strict';
import path from 'node:path';
import workspace from '../../scripts/workspace.mjs';

// Read-only production check. Synthetic invalid tokens verify the actual client
// transport without opening a real account, sending mail or changing cloud data.
const { CloudAccountClient, cloudOrigin } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/cloud/client.js'),
);
const origin = cloudOrigin(
  process.env.VOXCUE_TEST_ACCOUNT_ORIGIN ?? 'https://accounts.voxcue.com.cn',
  !!process.env.VOXCUE_TEST_ACCOUNT_ORIGIN,
);
assert.ok(origin);
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
const free = capabilities.body.access === 'free';
if (free) {
  assert.deepEqual(Object.keys(capabilities.body.features), ['backups']);
  assert.equal(capabilities.body.accountDeletion, 'account-erasure-v1');
  assert.equal(capabilities.body.billing, undefined);
  assert.equal(capabilities.body.zeroCreditRetentionDays, undefined);
} else {
  // Historical live 0.5.1 remains supported until an independently authorized deployment.
  assert.equal(capabilities.body.features.payments, false);
}
assert.equal(capabilities.body.limits.storageCapacityBytes, 100000000);
assert.equal(capabilities.body.limits.profileExemptFromStorageCapacity, true);
assert.equal(capabilities.body.limits.passwordMinLength, free ? 8 : 15);
assert.equal(capabilities.body.limits.passwordMaxLength, 128);
for (const route of ['/v1/account', '/v1/backups', '/v1/entitlements'])
  assert.equal((await get(route)).status, 401, route + ' must require authentication');
// The free server puts unknown protected routes behind authentication; authenticated 404
// is covered using synthetic users in free-service.test.ts, never a real live account.
assert.equal((await get('/v1/payments/products')).status, free ? 401 : 404);
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
  `PASS: ${free ? 'free 0.5.2' : 'historical 0.5.1'} API contract, 100 MB capacity/password rules, authenticated boundaries, absent payment surfaces and actual client invalid-session cleanup; no mail or cloud data writes.`,
);
