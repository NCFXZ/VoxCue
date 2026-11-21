import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { Store, Auth, Services, loadConfig, createApi, routes } from './server-061-reference.mjs';
import workspace from '../../scripts/workspace.mjs';

// Exercise the published 0.6.1 contracts separately from the older-server GUI fixture.
const require = createRequire(path.join(workspace.platformRoot, 'package.json'));
const loadClient = name => require(path.join(workspace.platformRoot, 'dist-electron/shared/electron', name + '.js'));
const { CloudAccountClient } = loadClient('backend/cloud/client'),
  { createCredentialVault } = loadClient('backend/cloud/vault'),
  { AccountErasureReceipts } = loadClient('backend/cloud/erasureReceipts'),
  { MigrationPasswords } = loadClient('backend/cloud/migrationPasswords'),
  { migrationPasswordFileName } = loadClient('backend/cloud/migrationPasswordRecords'),
  { eraseOwnerDeviceData } = loadClient('backend/cloud/eraseOwnerDeviceData'),
  { eraseLocalAccount } = loadClient('backend/accountErasure'),
  { profileDirectory } = loadClient('accountProfilePaths');
function testEncryption() {
  const key = randomBytes(32);
  return {
    encrypt(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decrypt(bytes) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
    },
  };
}

export async function verifyAccountErasureReceipts(crypto = testEncryption()) {
  const temp = await realpath(os.tmpdir()), root = await mkdtemp(path.join(temp, 'voxcue-erasure-receipt-'));
  const serverConfig = loadConfig({ AUTH_KEY: randomBytes(32).toString('hex'),
    DATABASE_FILE: path.join(root, 'accounts.sqlite'), FEATURE_BACKUPS: '1' });
  let store, auth, services, api, proxy, upstream;
  async function startApi() {
    store = new Store(serverConfig.database);
    auth = new Auth(store, serverConfig, false);
    services = new Services(auth);
    await services.backups.blobs.init();
    api = createApi(auth, () => {}, routes(services));
    api.server.listen(0, '127.0.0.1');
    await once(api.server, 'listening');
    upstream = 'http://127.0.0.1:' + api.server.address().port;
  }
  async function stopApi() {
    if (api) await api.close();
    else auth?.passwords.pool.close();
    await services?.close();
    store?.close();
    api = auth = services = store = undefined;
  }
  try {
    await startApi();
    const password = 'Synthetic erasure fixture 8!';
    const sourcePassword = 'Synthetic migration source 8!';
    async function addUser(label, credential) {
      const id = randomUUID(), email = label + '@example.test';
      store.addUser({ id, email, password_hash: await auth.passwords.hash(credential), created_at: Date.now() });
      return { id, email };
    }
    const target = await addUser('erasure-target', password), next = await addUser('other-device-owner', password);
    const source = await addUser('migration-source', sourcePassword);
    const a = target.id, b = next.id;
    let lost = false, checksOnline = false;
    const receiptStatuses = [];
    proxy = createServer(async (req, res) => {
      try {
        if (req.url === '/v1/account/deletion-status' && !checksOnline) {
          res.writeHead(503).end('{}');
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const reply = await fetch(upstream + req.url, { method: req.method, headers: {
          'content-type': 'application/json',
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        }, body: chunks.length ? Buffer.concat(chunks) : undefined });
        const body = await reply.text();
        if (req.url === '/v1/account/deletion-status') receiptStatuses.push(reply.status);
        if (req.url === '/v1/account/delete' && reply.ok && !lost) {
          lost = true;
          res.destroy();
        } else res.writeHead(reply.status, { 'content-type': 'application/json' }).end(body);
      } catch { res.destroy(); }
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const origin = 'http://127.0.0.1:' + proxy.address().port;
    const capabilities = await (await fetch(origin + '/v1/capabilities')).json();
    assert.equal(capabilities.serverVersion, '0.6.1');
    assert.equal(capabilities.accountDeletionReceipt, 'sha256-v1');
    assert.equal(capabilities.profilePasswordVerification, 'password-only-v1');
    const sessionPath = directory => path.join(directory, 'cloud-account', 'session.bin');
    const sessionFile = sessionPath(root);
    const open = (fetcher = fetch, directory = root) => {
      const journal = new AccountErasureReceipts(directory, origin, file => createCredentialVault(file, crypto));
      const migrationPasswords = new MigrationPasswords(id => createCredentialVault(
        path.join(profileDirectory(directory, 'account:' + id), migrationPasswordFileName), crypto));
      return { journal, client: new CloudAccountClient({ origin, fetcher, migrationPasswords, deviceLabel: 'synthetic',
        vault: createCredentialVault(sessionPath(directory), crypto), erasures: journal }) };
    };
    const properties = id => path.join(profileDirectory(root, 'account:' + id), 'sample');
    for (const id of [a, b]) {
      await mkdir(path.dirname(properties(id)), { recursive: true });
      await writeFile(properties(id), id);
    }
    const verificationRequests = [];
    let checkingSource = false;
    const initial = open((url, init) => {
      if (checkingSource) verificationRequests.push([new URL(url).pathname, new Headers(init?.headers).has('authorization')]);
      return fetch(url, init);
    });
    const login = id => ({ action: 'login', email: store.userById(id).email, password });
    assert.equal((await initial.client.call(login(a))).ok, true);
    const devices = [];
    for (let i = 0; i < 8; i++) devices.push(await auth.login({ email: source.email, password: sourcePassword }, 'synthetic-source'));
    const sessions = () => store.sessions(source.id, Date.now());
    const before = sessions(), targetSessions = store.sessions(a, Date.now()), currentSession = await readFile(sessionFile);
    assert.equal(before.length, 8);
    checkingSource = true;
    await initial.client.verifyProfileImportOwner(source, sourcePassword, new AbortController().signal);
    await assert.rejects(initial.client.verifyProfileImportOwner(source, password, new AbortController().signal), /密码/);
    await assert.rejects(initial.client.verifyProfileImportOwner({ id: source.id, email: target.email }, password, new AbortController().signal), /账号与验证结果不符/);
    checkingSource = false;
    assert.deepEqual(verificationRequests, [
      ['/v1/capabilities', false], ['/v1/auth/verify-password', false],
      ['/v1/capabilities', false], ['/v1/auth/verify-password', false],
      ['/v1/capabilities', false], ['/v1/auth/verify-password', false],
    ]);
    assert.deepEqual(sessions(), before);
    assert.deepEqual(store.sessions(a, Date.now()), targetSessions);
    for (const device of devices) assert.equal(auth.authenticate('Bearer ' + device.accessToken).session.id, device.sessionId);
    assert.equal(initial.client.snapshot().user.id, a);
    assert.deepEqual(await readFile(sessionFile), currentSession);
    console.log('PASS: password-only source verification with all eight devices occupied; wrong password refused, active target vault and all device sessions preserved.');
    const wrongPassword = await initial.client.call({ action: 'delete', password: sourcePassword, confirm: 'DELETE' }, 'account:' + a);
    assert.equal(wrongPassword.ok, false);
    assert.match(wrongPassword.error, /密码/);
    assert.ok(store.userById(a));
    assert.deepEqual(await readdir(path.join(root, 'account-erasure-intents')), []);
    assert.equal((await initial.client.call({ action: 'delete', password, confirm: 'DELETE' }, 'account:' + a)).ok, false);
    assert.ok(lost);
    assert.equal(store.userById(a), undefined);
    assert.equal(await readFile(properties(a), 'utf8'), a);
    assert.equal((await open().client.call(login(b))).ok, true);
    const sessionBefore = await readFile(sessionFile), restarted = open(), erased = [];
    await stopApi();
    await startApi();
    checksOnline = true;
    const { entry, fresh } = await restarted.journal.prepare(a, true);
    assert.equal(fresh, false);
    assert.equal(entry.committed, false);
    const intent = path.join(root, 'account-erasure-intents', a + '.bin');
    if (process.platform === 'darwin') assert.equal((await stat(intent)).mode & 0o777, 0o600);
    assert.equal((await readFile(intent)).includes(Buffer.from(entry.proof)), false);
    assert.equal(await restarted.journal.confirmed({ ...entry, proof: randomBytes(32).toString('base64url') }), false);
    assert.equal(await restarted.journal.confirmed({ ...entry, userId: b }), false);
    assert.equal(await restarted.journal.confirmed(entry), true);
    assert.deepEqual(receiptStatuses, [404, 404, 200]);
    const blocked = await restarted.journal.recover(id => restarted.client.recoverErasedOwner(id, async () => {
      const owner = 'account:' + id;
      await eraseLocalAccount(root, async () => {}, owner, { sharedSession: false, legacyMarker: false });
      await eraseOwnerDeviceData(root, origin, id, crypto);
      erased.push(id);
    }));
    assert.equal(blocked.size, 0);
    assert.deepEqual(erased, [a]);
    assert.equal(await stat(properties(a)).catch(() => null), null);
    assert.deepEqual(await readFile(sessionFile), sessionBefore);
    assert.equal(await readFile(properties(b), 'utf8'), b);
    assert.equal((await restarted.client.call({ action: 'status' })).state.user.id, b);
    assert.deepEqual(await readdir(path.join(root, 'account-erasure-intents')), []);
    console.log('PASS: lost TCP acknowledgement, offline retention, wrong receipt/owner refused, SQLite server and desktop restart, owner-scoped recovery and unchanged second account.');
    const ordinary = await addUser('acknowledged-deletion', password);
    const otherDevice = path.join(root, 'other-device');
    const acknowledged = open(fetch, otherDevice);
    assert.equal((await acknowledged.client.call(login(ordinary.id))).ok, true);
    const removed = await acknowledged.client.call({ action: 'delete', password, confirm: 'DELETE' }, 'account:' + ordinary.id);
    assert.equal(removed.ok, true);
    assert.equal(removed.state.user, null);
    assert.equal(store.userById(ordinary.id), undefined);
    const saved = await acknowledged.journal.prepare(ordinary.id, true);
    assert.equal(saved.fresh, false);
    assert.equal(saved.entry.committed, true);
    const reopened = open(fetch, otherDevice);
    const recovered = [];
    const pending = await reopened.journal.recover(id => reopened.client.recoverErasedOwner(id, async ownsSession => {
      assert.equal(ownsSession, true);
      await eraseLocalAccount(otherDevice, async () => {}, 'account:' + id, { sharedSession: ownsSession, legacyMarker: false });
      await eraseOwnerDeviceData(otherDevice, origin, id, crypto);
      recovered.push(id);
    }));
    assert.equal(pending.size, 0);
    assert.deepEqual(recovered, [ordinary.id]);
    await assert.rejects(stat(sessionPath(otherDevice)), { code: 'ENOENT' });
    assert.deepEqual(await readdir(path.join(otherDevice, 'account-erasure-intents')), []);
    assert.deepEqual(await readFile(sessionFile), sessionBefore);
    console.log('PASS: acknowledged deletion commits the journal and a restarted client clears the deleted owner’s device session.');
  } finally {
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    try {
      await stopApi();
    } finally {
      if (path.dirname(await realpath(root)) === temp) await rm(root, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await verifyAccountErasureReceipts();
