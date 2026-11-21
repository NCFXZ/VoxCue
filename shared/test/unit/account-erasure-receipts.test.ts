import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AccountErasureReceipts, receiptHash, type ErasureReceipt } from '../../electron/backend/cloud/erasureReceipts';
import { CloudAccountClient, type CloudCredentials } from '../../electron/backend/cloud/client';

vi.mock('electron', () => ({ app: {}, safeStorage: {} }));
import { createCredentialVault } from '../../electron/backend/cloud/vault';

let root: string;
const origin = 'https://accounts.example.test';
const encryption = {
  encrypt: (s: string) => Buffer.from(s).reverse(),
  decrypt: (bytes: Buffer) => Buffer.from(bytes).reverse().toString(),
};
const receipts = (fetcher: typeof fetch, server = origin) => new AccountErasureReceipts(root, server,
  file => createCredentialVault<ErasureReceipt>(file, encryption), fetcher);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const session = (id: string): CloudCredentials => ({
  user: { id, email: 'synthetic@example.test', createdAt: 1 }, sessionId: randomUUID(),
  accessToken: 'a'.repeat(43), refreshToken: 'b'.repeat(43),
  expiresAt: Date.now() + 900000, refreshExpiresAt: Date.now() + 1800000,
});
const deletion = { action: 'delete', password: 'Synthetic erasure test', confirm: 'DELETE' } as const;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'voxcue-receipt-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('recovers a lost committed acknowledgement across a restart without erasing the next account’s session', async () => {
  const first = randomUUID(), second = randomUUID();
  let stored = session(first), digest: string | undefined, online = false;
  const fetcher: typeof fetch = async (url, init) => {
    const route = new URL(String(url)).pathname;
    if (route.endsWith('/capabilities')) return json({ accountDeletion: 'account-erasure-v1', accountDeletionReceipt: 'sha256-v1' });
    const body = JSON.parse(String(init?.body));
    if (route.endsWith('/delete')) {
      expect(body).toEqual({ password: deletion.password, confirm: 'DELETE', receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
      digest = body.receiptHash;
      throw Error('Reply lost after commit');
    }
    expect(route).toBe('/v1/account/deletion-status');
    if (!online) throw Error('offline');
    expect(receiptHash(body.proof)).toBe(digest);
    return json({ userId: body.userId, deleted: true });
  };
  const vault = { read: async () => ({ origin, credentials: stored }), write: vi.fn(), clear: vi.fn() };
  const journal = receipts(fetcher);
  const initial = new CloudAccountClient({ origin, deviceLabel: 'test', vault, fetcher, erasures: journal });
  expect(await initial.call(deletion, 'account:' + first)).toMatchObject({ ok: false, error: expect.stringContaining('重新打开后会继续核实') });
  const pending = await journal.prepare(first, true);
  expect(pending.fresh).toBe(false);
  const bytes = await readFile(path.join(root, 'account-erasure-intents', first + '.bin'));
  expect(bytes.includes(Buffer.from(pending.entry.proof!))).toBe(false);
  stored = session(second);
  online = true;
  const restored = new CloudAccountClient({ origin, deviceLabel: 'test', vault, fetcher });
  const erased = vi.fn(async (_shared: boolean) => {});
  const after = receipts(fetcher);
  expect(await after.recover(id => restored.recoverErasedOwner(id, erased))).toEqual(new Set());
  expect(erased).toHaveBeenCalledExactlyOnceWith(false);
  expect(restored.snapshot().user?.id).toBe(second);
  expect(vault.clear).not.toHaveBeenCalled();
  await after.recover(async () => { throw Error('already cleaned'); });
  expect(await after.checkRecords(async b => encryption.decrypt(b))).toBe(false);
});

it('keeps old servers and wrong-account or unavailable receipts unconfirmed and preserves other owners on local failure', async () => {
  const legacy = randomUUID(), corrupt = randomUUID(), locked = randomUUID(), valid = randomUUID(), unknown = randomUUID();
  const check = vi.fn<typeof fetch>(async (_url, init) => {
    const { userId } = JSON.parse(String(init?.body));
    return json({ userId: userId === unknown ? randomUUID() : userId, deleted: true });
  });
  const journal = receipts(check);
  await journal.prepare(legacy, false);
  for (const id of [corrupt, locked, valid, unknown]) await journal.prepare(id, true);
  await writeFile(path.join(root, 'account-erasure-intents', corrupt + '.bin'), 'corrupt');
  const cleaned: string[] = [];
  expect(await journal.recover(async id => {
    if (id === locked) throw Error('file busy');
    cleaned.push(id);
  })).toEqual(new Set([corrupt, locked]));
  expect(cleaned).toEqual([valid]);
  expect(check).toHaveBeenCalledTimes(3);
  const offline = receipts(vi.fn(async () => { throw Error('offline'); }));
  await offline.recover(async id => { cleaned.push(id); });
  expect(cleaned).toEqual([valid, locked]);
  expect((await journal.prepare(unknown, true)).fresh).toBe(false);
  expect((await journal.prepare(legacy, false)).fresh).toBe(false);
});

it('discards a fresh explicit rejection but retains an older unresolved intent on retry', async () => {
  const id = randomUUID();
  const fetcher: typeof fetch = async url => String(url).endsWith('/capabilities')
    ? json({ accountDeletion: 'account-erasure-v1', accountDeletionReceipt: 'sha256-v1' })
    : json({ error: { code: 'invalid_credentials' } }, 401);
  const journal = receipts(fetcher);
  const client = new CloudAccountClient({ origin, deviceLabel: 'test', erasures: journal, fetcher,
    vault: { read: async () => ({ origin, credentials: session(id) }), write: vi.fn(), clear: vi.fn() } });
  expect((await client.call(deletion, 'account:' + randomUUID())).ok).toBe(false);
  expect((await client.call(deletion, 'account:' + id)).ok).toBe(false);
  expect((await journal.prepare(id, true)).fresh).toBe(true);
  expect((await client.call(deletion, 'account:' + id)).ok).toBe(false);
  expect((await journal.prepare(id, true)).fresh).toBe(false);
});

it('retains a blocked owner’s stored bytes and rejects its profile import verification, while another account can sign in', async () => {
  const blocked = randomUUID(), next = randomUUID(), other = session(next);
  const fetcher = vi.fn<typeof fetch>(async () => json(other));
  const vault = { read: vi.fn(async () => ({ origin, credentials: session(blocked) })), write: vi.fn(), clear: vi.fn() };
  const client = new CloudAccountClient({ origin, vault, fetcher, deviceLabel: 'test', blockedErasureOwner: id => id === blocked });
  expect((await client.call({ action: 'status' })).state.user).toBeNull();
  await expect(client.verifyProfileImportOwner({ id: blocked, email: 'blocked@example.test' },
    'Synthetic erasure test', new AbortController().signal)).rejects.toThrow('清理');
  expect(fetcher).not.toHaveBeenCalled();
  expect(vault.clear).not.toHaveBeenCalled();
  expect((await client.call({ action: 'login', email: other.user.email, password: 'Synthetic erasure test' })).state.user?.id).toBe(next);
});

it('treats a gateway timeout as uncertain and accepts only the matching positive receipt', async () => {
  const id = randomUUID(), other = randomUUID();
  let confirming = false;
  const fetcher: typeof fetch = async url => {
    const route = new URL(String(url)).pathname;
    if (route.endsWith('/capabilities')) return json({ accountDeletion: 'account-erasure-v1', accountDeletionReceipt: 'sha256-v1' });
    if (route.endsWith('/delete')) return json({ error: { code: 'gateway_timeout' } }, 408);
    return json({ deleted: true, userId: confirming ? id : other });
  };
  const journal = receipts(fetcher);
  const vault = { read: async () => ({ origin, credentials: session(id) }), write: vi.fn(), clear: vi.fn() };
  const client = new CloudAccountClient({ origin, vault, fetcher, erasures: journal, deviceLabel: 'test' });
  expect((await client.call(deletion)).ok).toBe(false);
  const pending = await journal.prepare(id, true);
  expect(pending.fresh).toBe(false);
  confirming = true;
  expect((await client.call(deletion)).ok).toBe(true);
  expect((await journal.prepare(id, true)).entry.proof).toBe(pending.entry.proof);
  const changedEndpoint = receipts(vi.fn(async () => { throw Error('wrong server'); }), 'https://other.example.test');
  const erase = vi.fn(async () => {});
  await changedEndpoint.recover(erase);
  expect(erase).not.toHaveBeenCalled();
  await journal.recover(erase);
  expect(erase).toHaveBeenCalledExactlyOnceWith(id);
});
