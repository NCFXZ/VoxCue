import { testRoot } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import {
  Store,
  Auth,
  loadConfig,
  createApi,
  Outbox,
  Services,
  routes,
} from './server-reference.mjs';
import { once } from 'node:events';
import { createHash, randomUUID, scryptSync } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

// Client integration only: the pinned server tree is imported read-only. All
// writes belong to this run's fresh SQLite/outbox, never production or admin.
const { CloudAccountClient } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/cloud/client.js'),
);
const config = loadConfig({
  AUTH_KEY: 'ef'.repeat(32),
  FEATURE_BACKUPS: '1',
  DATABASE_FILE: path.join(testRoot, 'protocol.sqlite'),
});
const store = new Store(config.database),
  auth = new Auth(store, config, true);
const messages = [];
const outbox = new Outbox(auth, {
  enabled: true,
  async send(message) {
    messages.push(message);
  },
});
const services = new Services(auth);
await services.start();
const api = createApi(auth, () => {}, routes(services));
api.server.listen(0, '127.0.0.1');
await once(api.server, 'listening');
const origin = 'http://127.0.0.1:' + api.server.address().port;
const createClient = () => {
  let stored = null;
  const client = new CloudAccountClient({
    origin,
    deviceLabel: 'VoxCue · Mac',
    vault: {
      async read() {
        return stored;
      },
      async write(value) {
        stored = structuredClone(value);
      },
      async clear() {
        stored = null;
      },
    },
  });
  return { client, read: () => stored };
};
const success = (result) => {
  assert.equal(result.ok, true, result.error);
  return result;
};
async function challenge(client, email, purpose) {
  const result = success(await client.call({ action: 'code', email, purpose }));
  await outbox.runOnce();
  const mail = messages.findLast((m) => m.to === email && m.purpose === purpose);
  assert.ok(mail);
  return { challengeId: result.challenge.id, code: mail.code };
}
try {
  const { client, read } = createClient(),
    email = 'protocol@example.test';
  const password = ' e\u0301中文! 😀 mix 2026 ';
  const registration = await challenge(client, email, 'register');
  const retry = await client.call({ action: 'code', email, purpose: 'register' });
  assert.equal(retry.ok, false);
  assert.ok(retry.retryAfterSeconds > 0 && retry.retryAfterSeconds <= 60);
  const wrongPurpose = await client.call({ action: 'reset', email, password, ...registration });
  assert.equal(wrongPurpose.ok, false);
  const registered = success(
    await client.call({ action: 'register', email, password, ...registration }),
  );
  assert.equal(registered.state.user.email, email);
  assert.equal(
    store.query('SELECT label FROM sessions WHERE id=?', read().credentials.sessionId).label,
    'VoxCue · Mac',
  );
  const old = createClient();
  success(await old.client.call({ action: 'login', email, password }));
  const reset = await challenge(client, email, 'reset'),
    replacement = ' 中文 replacement 2026! ';
  success(await client.call({ action: 'reset', email, password: replacement, ...reset }));
  assert.equal(client.snapshot().user, null);
  const revoked = await old.client.call({ action: 'status' });
  assert.equal(revoked.ok, false);
  assert.equal(old.read(), null);
  assert.equal((await client.call({ action: 'login', email, password })).ok, false);
  success(await client.call({ action: 'login', email, password: replacement }));
  const originalRefresh = read().credentials.refreshToken;
  // Force only the client's refresh decision; server expiry/rotation remain real.
  const expiry = read();
  expiry.credentials.expiresAt = 1;
  const rotating = new CloudAccountClient({
    origin,
    deviceLabel: 'VoxCue · Mac',
    vault: {
      async read() {
        return structuredClone(expiry);
      },
      async write(value) {
        Object.assign(expiry, structuredClone(value));
      },
      async clear() {},
    },
  });
  success(await rotating.call({ action: 'status' }));
  assert.notEqual(expiry.credentials.refreshToken, originalRefresh);
  assert.equal(
    (
      await fetch(origin + '/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: originalRefresh }),
      })
    ).status,
    401,
  );

  // Seed an old-format synthetic hash without changing any server code/schema.
  const legacyPassword = ' e\u0301! ',
    salt = 'ab'.repeat(16),
    legacyEmail = 'legacy@example.test';
  const hash = scryptSync(legacyPassword, Buffer.from(salt, 'hex'), 32, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  }).toString('hex');
  store.run(
    'INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)',
    randomUUID(),
    legacyEmail,
    ['scrypt-v1', salt, hash].join('$'),
    Date.now(),
  );
  const legacy = createClient();
  success(
    await legacy.client.call({ action: 'login', email: legacyEmail, password: legacyPassword }),
  );
  assert.equal(
    (
      await legacy.client.call({
        action: 'login',
        email: legacyEmail,
        password: legacyPassword.normalize('NFC'),
      })
    ).ok,
    false,
  );
  success(await legacy.client.call({ action: 'logout' }));
  assert.equal(legacy.read(), null);
  success(await client.call({ action: 'login', email, password: replacement }));
  const chunk = new Uint8Array(1048576);
  const upload = async (kind, name, bytes) => {
    const id = randomUUID();
    await client.api('/v1/backups', 'POST', { id, kind, name });
    const hash = createHash('sha256');
    for (let offset = 0; offset < bytes; offset += chunk.length)
      hash.update(chunk.subarray(0, Math.min(chunk.length, bytes - offset)));
    const pending = await client.api(`/v1/backups/${id}/uploads`, 'POST', {
      requestId: randomUUID(),
      bytes,
      sha256: hash.digest('hex'),
      baseRevision: 0,
    });
    for (let index = 0; index < pending.partCount; index++)
      await client.api(
        `/v1/uploads/${pending.id}/parts/${index}`,
        'PUT',
        chunk.subarray(0, Math.min(chunk.length, bytes - index * chunk.length)),
      );
    const complete = await client.api(`/v1/uploads/${pending.id}/complete`, 'POST', {});
    return { id, revision: complete.revision };
  };
  const total = async () =>
    Object.values((await client.api('/v1/backups')).storage.storedBytes).reduce(
      (sum, value) => sum + value,
      0,
    );
  // These are opaque synthetic protocol payloads, not imported business JSON.
  // The GUI suite separately verifies a real JD edit at full quota. Here all
  // 101 MB are transferred and checksum-committed through the real client/API.
  await upload('knowledgebase', 'file:quota-a', 60000000);
  await upload('knowledgebase', 'file:quota-b', 39000000);
  const removed = await upload('knowledgebase', 'file:quota-delete', 1000000);
  assert.equal(await total(), 100000000);
  await upload('profile', 'resume:main', 1000000);
  assert.equal(await total(), 101000000);
  await client.api(`/v1/backups/${removed.id}/remove`, 'POST', { revision: removed.revision });
  assert.equal(await total(), 100000000);
  for (const [kind, name] of [
    ['history', 'record:quota-reject'],
    ['knowledgebase', 'file:quota-reject'],
  ]) {
    const id = randomUUID();
    await client.api('/v1/backups', 'POST', { id, kind, name });
    await assert.rejects(
      client.api(`/v1/backups/${id}/uploads`, 'POST', {
        requestId: randomUUID(),
        bytes: 1,
        sha256: createHash('sha256').update(chunk.subarray(0, 1)).digest('hex'),
        baseRevision: 0,
      }),
      { status: 507, message: '云端剩余空间不足，请清理不需要的云端数据后重试。' },
    );
  }
  await upload('profile', 'profile:main', 100);
  assert.equal(await total(), 100000100);
  console.log(
    'PASS: real client/API transferred and committed 100000000 → 101000000 → 100000000 bytes; history/knowledge additions rejected at 100 MB while metered profile upload still succeeds.',
  );
  console.log(
    'PASS: pinned reference server on loopback verified register/reset challenge separation, 60s resend throttling, NFC/spaces/Chinese/emoji, old short non-NFC hash compatibility, reset revocation and one-use refresh rotation; synthetic data only.',
  );
} finally {
  await Promise.all([api.close(), outbox.stop(), services.close()]);
  store.close();
}
