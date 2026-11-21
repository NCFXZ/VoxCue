import { afterEach, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { profileDirectory } from '../../electron/accountProfilePaths';
import { AccountImport, type ProfileImportReader } from '../../electron/backend/accountImport';
import { CloudAccountClient } from '../../electron/backend/cloud/client';
import { CloudSyncClient } from '../../electron/backend/cloud/sync';
import { RecordingLibrary } from '../../electron/backend/interview/recordings';
import { ProfileImportSources } from '../../electron/backend/profileImportSources';
import {
  checkMovedRecordings,
  copyProfileRecordings,
  removeMovedRecordings,
} from '../../electron/backend/profileRecordingTransfer';
import {
  ProfileMoveReceipts,
  type ProfileMoveReceipt,
} from '../../electron/backend/profileMoveReceipt';
import { InterviewRecording } from '../../electron/backend/speech/recording';
import type { AccountImportCall, SourceRemovalResult } from '../../electron/contracts/accountData';
import { packCloudItem } from '../../electron/contracts/restoreData';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directory() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'voxcue-profile-transfer-'));
  roots.push(tmp);
  return tmp;
}
const alice = { id: randomUUID(), email: 'alice@example.test', createdAt: 1 };
const bob = { id: randomUUID(), email: 'bob@example.test', createdAt: 1 };
const destination = 'account:' + alice.id;
const source = 'account:' + bob.id;
it('copies the playable interrupted WAV prefix and only cleans up the exact original snapshot', async () => {
  const library = new RecordingLibrary(path.join(await directory(), 'recordings'));
  const recordId = randomUUID(), now = Date.now(), signal = new AbortController().signal;
  const writer = new InterviewRecording(library.prepare(source, recordId, false), now);
  await writer.ready;
  writer.append('system', new Float32Array(16000).fill(0.1), 16000, now);
  await writer.close(now + 1000);
  const bytes = await readFile(writer.file), pending = writer.file + '.pending';
  await rename(writer.file, pending);
  const snapshot = Buffer.concat([bytes, Buffer.alloc(600, 1)]);
  await writeFile(pending, snapshot);
  const { copied } = await copyProfileRecordings(library, source, destination, [recordId], signal);
  expect(copied[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
  const [target] = await library.list(destination, recordId);
  expect(await readFile(target.file)).toEqual(bytes);
  await checkMovedRecordings(library, source, [recordId], copied, signal);
  await appendFile(pending, Buffer.alloc(8));
  await expect(checkMovedRecordings(library, source, [recordId], copied, signal)).rejects.toThrow('已改变');
  await removeMovedRecordings(library, source, copied, signal);
  expect((await readFile(pending)).length).toBe(snapshot.length + 8);
  await writeFile(pending, Buffer.concat([bytes, Buffer.alloc(600, 2)]));
  await expect(checkMovedRecordings(library, source, [recordId], copied, signal)).rejects.toThrow('已改变');
  await writeFile(pending, snapshot);
  await removeMovedRecordings(library, source, copied, signal);
  expect(await library.list(source, recordId)).toEqual([]);
});
function auth() {
  const live = new Set<string>();
  const routes: string[] = [];
  let refuseLogout = false;
  const response = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const route = new URL(String(url)).pathname;
    routes.push(route);
    if (route === '/v1/capabilities') return response({ apiVersion: 'v1' });
    if (route === '/v1/auth/login') {
      const data = JSON.parse(String(init?.body));
      const user = data.email === alice.email ? alice : bob;
      if (data.email !== user.email || data.password !== user.id + '-pass')
        return response({ error: { code: 'invalid_credentials' } }, 401);
      const accessToken = randomBytes(32).toString('base64url');
      live.add(accessToken);
      return response({
        user,
        accessToken,
        refreshToken: randomBytes(32).toString('base64url'),
        sessionId: randomUUID(),
        expiresAt: Date.now() + 3_600_000,
        refreshExpiresAt: Date.now() + 3_600_000,
      });
    }
    if (route === '/v1/auth/logout') {
      if (refuseLogout) return response({}, 503);
      const token = new Headers(init?.headers).get('authorization')!.slice(7);
      expect(live.delete(token)).toBe(true);
      return response({});
    }
    throw Error('Unexpected service request');
  });
  const client = new CloudAccountClient({
    origin: 'https://fixture.example.test',
    deviceLabel: 'fixture',
    fetcher,
    vault: { read: async () => null, write: async () => {}, clear: async () => {} },
  });
  return {
    client,
    live,
    routes,
    failLogout: () => {
      refuseLogout = true;
    },
  };
}
async function fixture() {
  const tmp = await directory();
  const revision = randomUUID();
  const accounts = new ProfileImportSources(tmp, () => revision);
  accounts.remember(alice);
  accounts.remember(bob);
  const recordId = randomUUID();
  const imageId = randomUUID();
  const key = 'image:' + imageId;
  const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const preview = 'data:image/png;base64,iVBORw0KGgo=';
  const blobs = new Map([
    ['profile:main', packCloudItem('profile:main', '{}')],
    ['record:' + recordId, packCloudItem('record:' + recordId, '{}')],
    [key, packCloudItem(key, imageBytes, { id: imageId, preview })],
  ]);
  const reader: ProfileImportReader = {
    items: [...blobs].map(([key, blob]) => ({
      key,
      size: blob.size,
      ...(key.startsWith('record:') ? { imageIds: [imageId] } : {}),
    })),
    read: async (key, offset) => new Uint8Array(await blobs.get(key)!.slice(offset).arrayBuffer()),
    savedPreviewHash: async () => null,
    planRemoval: vi.fn(async (keys) => ({
      items: keys.map((key: string) => ({
        key,
        hash: 'a'.repeat(64),
        ...(key.startsWith('record:') ? { imageIds: [imageId] } : {}),
      })),
    })),
    removeSelected: vi.fn(async (plan) => ({
      recordIds: plan.items.filter((i) => i.key.startsWith('record:')).map((i) => i.key.slice(7)),
      imageIds: plan.items.flatMap((i) => i.imageIds ?? []),
      documentIds: [],
      localRevision: null,
    })),
    close: vi.fn(),
  };
  const cloud = auth();
  const library = new RecordingLibrary(path.join(tmp, 'recordings'));
  const receipts = new ProfileMoveReceipts(tmp);
  const cleanSource = vi.fn(
    async (move: ProfileMoveReceipt, gone: SourceRemovalResult, signal: AbortSignal) => {
      await removeMovedRecordings(
        library,
        move.source,
        move.clips.filter((c) => gone.recordIds.includes(c.recordId)),
        signal,
      );
    },
  );
  const rollbackImage = vi.fn(async () => {});
  const image = vi.fn(async () => rollbackImage);
  const open = vi.fn(async (_id: string, _signal: AbortSignal) => reader);
  let owner = destination;
  const importer = new AccountImport({
    owner: () => owner,
    sources: (id) => accounts.list(id),
    localRevision: () => revision,
    verify: (s, password, signal) =>
      cloud.client.verifyProfileImportOwner(
        { id: s.id.slice(8), email: s.email! },
        password,
        signal,
      ),
    open,
    image,
    recordings: (from, to, ids, signal) => copyProfileRecordings(library, from, to, ids, signal),
    receipts,
    cleanSource,
    checkSource: (r, signal) =>
      checkMovedRecordings(
        library,
        r.source,
        r.plan.items.filter((i) => i.key.startsWith('record:')).map((i) => i.key.slice(7)),
        r.clips,
        signal,
      ),
  });
  const call = async (op: AccountImportCall) => {
    const r = await importer.call('main', op);
    if (!r.ok) throw Error(r.error);
    return r;
  };
  const begin = async (id: string) => (await call({ action: 'openImport', sourceId: id })).token!;
  return {
    tmp,
    revision,
    accounts,
    reader,
    cloud,
    library,
    image,
    rollbackImage,
    receipts,
    cleanSource,
    recordId,
    imageId,
    key,
    preview,
    imageBytes,
    open,
    importer,
    call,
    begin,
    changeOwner: () => {
      owner = 'local';
    },
  };
}
it('keeps a damaged interview in its source while allowing an unrelated profile field to move', async () => {
  const f = await fixture();
  f.reader.items.find(item => item.key === f.key)!.size = 0;
  f.reader.imageSize = vi.fn(async () => { throw Error('unavailable synthetic original'); });
  const token = await f.begin('local');
  await f.call({ action: 'unlockImport', token });
  await expect(f.call({ action: 'prepareImportCommit', token, keys: ['record:' + f.recordId],
    recordIds: [f.recordId], imageIds: [f.imageId] })).rejects.toThrow('unavailable synthetic original');
  await f.call({ action: 'closeImport', token });
  expect(f.image).not.toHaveBeenCalled();
  expect(f.reader.removeSelected).not.toHaveBeenCalled();
  expect(f.cleanSource).not.toHaveBeenCalled();
  const next = await f.begin('local');
  await f.call({ action: 'unlockImport', token: next });
  await f.call({ action: 'prepareImportCommit', token: next, keys: ['profile:name'], recordIds: [], imageIds: [] });
  await f.call({ action: 'closeImport', token: next, committed: true });
  expect(f.reader.imageSize).toHaveBeenCalledTimes(1);
  expect(f.reader.removeSelected).toHaveBeenCalledWith({ items: [{ key: 'profile:name', hash: 'a'.repeat(64) }] });
});

it('lists only local profiles and opens a cloud source only after verifying its password and releasing its session', async () => {
  const f = await fixture();
  expect(await f.call({ action: 'listImportSources' })).toMatchObject({
    sources: [{ id: 'local' }, { id: source, email: bob.email }],
  });
  await expect(f.begin(destination)).rejects.toThrow();
  await expect(f.begin('account:' + randomUUID())).rejects.toThrow();
  expect(f.cloud.routes).toEqual([]);
  const login = await f.cloud.client.call({
    action: 'login',
    email: alice.email,
    password: alice.id + '-pass',
  });
  expect(login.ok).toBe(true);
  const state = f.cloud.client.snapshot();
  const token = await f.begin(source);
  await expect(f.call({ action: 'readImport', token, key: f.key, offset: 0 })).rejects.toThrow();
  await expect(f.call({ action: 'unlockImport', token })).rejects.toThrow('密码');
  await expect(
    f.call({ action: 'unlockImport', token, password: alice.id + '-pass' }),
  ).rejects.toThrow('密码');
  expect(f.open).not.toHaveBeenCalled();
  expect(await f.call({ action: 'unlockImport', token, password: bob.id + '-pass' })).toMatchObject(
    { items: f.reader.items },
  );
  expect(f.cloud.client.snapshot()).toEqual(state);
  expect(f.cloud.live.size).toBe(1);
  expect(f.cloud.routes).toEqual([
    '/v1/auth/login',
    '/v1/capabilities',
    '/v1/auth/login',
    '/v1/capabilities',
    '/v1/auth/login',
    '/v1/auth/logout',
  ]);
  expect(
    (await f.importer.call('other-window', { action: 'readImport', token, key: f.key, offset: 0 }))
      .ok,
  ).toBe(false);
  expect(
    (await f.call({ action: 'readImport', token, key: 'profile:main', offset: 0 })).bytes,
  ).toEqual(await f.reader.read('profile:main', 0));
  await f.call({
    action: 'prepareImportCommit',
    token,
    keys: ['record:' + f.recordId],
    recordIds: [f.recordId],
    imageIds: [f.imageId],
  });
  expect(f.image).toHaveBeenCalledWith(f.imageId, f.preview, Buffer.from(f.imageBytes));
  await f.call({ action: 'closeImport', token, committed: false });
  const next = await f.begin('local');
  await f.call({ action: 'unlockImport', token: next });
  f.changeOwner();
  await expect(
    f.call({ action: 'readImport', token: next, key: f.key, offset: 0 }),
  ).rejects.toThrow();
  await f.importer.cancel();
  expect(f.reader.close).toHaveBeenCalledTimes(2);
  expect(f.rollbackImage).toHaveBeenCalledOnce();
  expect(f.importer.hasWork()).toBe(false);
});

it('rejects unknown arguments and malformed identifiers before reading any profile or verifying a password', async () => {
  const f = await fixture();
  const token = await f.begin(source);
  for (const input of [
    { action: 'unlockImport', token, password: bob.id + '-pass', sourceId: 'local' },
    { action: 'unlockImport', token, password: 'a'.repeat(1025) },
    { action: 'unlockImport', token, password: String.fromCharCode(0xd800) },
    { action: 'readImport', token, key: '../profile', offset: 0 },
    { action: 'readImport', token, key: 'profile:main', offset: 1.5 },
    { action: 'restoreImportImage', token, key: 'image:unknown' },
    { action: 'prepareImportCommit', token },
    { action: 'prepareImportCommit', token, recordIds: [f.recordId, f.recordId], imageIds: [] },
    { action: 'prepareImportCommit', token, recordIds: [42], imageIds: [] },
    { action: 'closeImport', token, committed: 'true' },
    { action: 'openImport', sourceId: '/absolute-file' },
    { action: 'listImportSources', target: source },
    { action: 'unknown' },
  ]) {
    expect(await f.importer.call('main', input as AccountImportCall)).toEqual({
      ok: false,
      error: '迁移资料无效。',
    });
  }
  expect(f.open).not.toHaveBeenCalled();
  expect(f.cloud.routes).toEqual([]);
  await f.importer.cancel();
});

it('never opens a reader for a mismatched verified identity or when the transient session could not be revoked', async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  await expect(
    f.cloud.client.verifyProfileImportOwner(
      { id: alice.id, email: bob.email },
      bob.id + '-pass',
      signal,
    ),
  ).rejects.toThrow('不符');
  expect(f.cloud.live.size).toBe(0);
  f.cloud.failLogout();
  const token = await f.begin(source);
  await expect(
    f.call({ action: 'unlockImport', token, password: bob.id + '-pass' }),
  ).rejects.toThrow('撤销');
  expect(f.open).not.toHaveBeenCalled();
  await f.importer.cancel();
});

it('copies recordings from the password-free local account on confirmation and rolls back only its new files', async () => {
  const f = await fixture();
  const start = Date.now();
  const recording = new InterviewRecording(f.library.prepare('local', f.recordId, false), start);
  recording.append('system', new Float32Array([0.2, -0.1, 0.1]), 16000, start);
  await recording.close(start + 1_000);
  const original = await readFile(recording.file);
  async function prepare() {
    const choice = await f.call({ action: 'openImport', sourceId: 'local' });
    expect(choice).toMatchObject({ requiresPassword: false, localRevision: f.revision });
    const token = choice.token!;
    await f.call({ action: 'unlockImport', token });
    await f.call({
      action: 'prepareImportCommit',
      token,
      keys: ['record:' + f.recordId],
      recordIds: [f.recordId],
      imageIds: [f.imageId],
    });
    return token;
  }
  const token = await prepare();
  const [copy] = await f.library.list(destination, f.recordId);
  expect(await readFile(copy.file)).toEqual(original);
  expect(f.reader.removeSelected).not.toHaveBeenCalled();
  await expect(f.call({ action: 'readImport', token, key: f.key, offset: 0 })).rejects.toThrow();
  await f.call({ action: 'closeImport', token, committed: false });
  expect(await f.library.list(destination, f.recordId)).toEqual([]);
  expect(f.rollbackImage).toHaveBeenCalledOnce();
  const existingDirectory = f.library.prepare(destination, f.recordId, true);
  await writeFile(path.join(existingDirectory, path.basename(copy.file)), original);
  await f.call({ action: 'closeImport', token: await prepare(), committed: false });
  expect(await readFile(copy.file)).toEqual(original);
  const changed = Buffer.from(original);
  changed[44] ^= 1;
  await writeFile(copy.file, changed);
  await expect(prepare()).rejects.toThrow('冲突');
  await f.importer.cancel();
  expect(await readFile(copy.file)).toEqual(changed);
  expect(await readFile(recording.file)).toEqual(original);
  await writeFile(copy.file, original);
  await f.call({ action: 'closeImport', token: await prepare(), committed: true });
  expect(f.reader.removeSelected).toHaveBeenCalledOnce();
  expect(await f.library.list('local', f.recordId)).toEqual([]);
  expect(await readFile(copy.file)).toEqual(original);
  expect(f.cloud.routes).toEqual([]);
});

it('copies only native assets referenced by selected records in the authenticated snapshot', async () => {
  const f = await fixture();
  const token = await f.begin('local');
  await f.call({ action: 'unlockImport', token });
  for (const [recordIds, imageIds] of [
    [[], [f.imageId]],
    [[f.recordId], []],
    [[randomUUID()], []],
  ]) {
    await expect(
      f.call({ action: 'prepareImportCommit', token, keys: ['profile:name'], recordIds, imageIds }),
    ).rejects.toThrow();
  }
  await f.call({
    action: 'prepareImportCommit',
    token,
    keys: ['profile:name'],
    recordIds: [],
    imageIds: [],
  });
  await f.call({ action: 'closeImport', token, committed: true });
  expect(f.image).not.toHaveBeenCalled();
  expect(await f.library.list(destination, f.recordId)).toEqual([]);
});

it('leaves the source intact when the destination window disappears without acknowledging its transaction', async () => {
  const f = await fixture();
  const token = await f.begin('local');
  await f.call({ action: 'unlockImport', token });
  await f.call({
    action: 'prepareImportCommit',
    token,
    keys: ['record:' + f.recordId],
    recordIds: [f.recordId],
    imageIds: [f.imageId],
  });
  await f.importer.cancel();
  expect(f.reader.removeSelected).not.toHaveBeenCalled();
  expect(f.rollbackImage).not.toHaveBeenCalled();
  expect(await f.receipts.read(destination, 'local')).toBeUndefined();
});

it('persists the selected fingerprints on cleanup failure and resumes only after authenticating the same source', async () => {
  const f = await fixture();
  const token = await f.begin(source);
  await f.call({ action: 'unlockImport', token, password: bob.id + '-pass' });
  await f.call({
    action: 'prepareImportCommit',
    token,
    keys: ['profile:name'],
    recordIds: [],
    imageIds: [],
  });
  f.cleanSource.mockRejectedValueOnce(Error('synthetic write error'));
  await expect(f.call({ action: 'closeImport', token, committed: true })).rejects.toThrow(
    '目标资料已保存',
  );
  const file = await new ProfileMoveReceipts(f.tmp).read(destination, source);
  expect(file?.plan.items.map((i) => i.key)).toEqual(['profile:name']);
  expect(await f.receipts.read('local', source)).toBeUndefined();
  expect(await f.receipts.read(destination, 'local')).toBeUndefined();
  const next = await f.begin(source);
  await expect(
    f.call({ action: 'unlockImport', token: next, password: 'wrong-pass' }),
  ).rejects.toThrow();
  expect(f.reader.removeSelected).toHaveBeenCalledTimes(1);
  await f.call({ action: 'unlockImport', token: next, password: bob.id + '-pass' });
  expect(f.reader.removeSelected).toHaveBeenCalledTimes(2);
  expect(await f.receipts.read(destination, source)).toBeUndefined();
  await f.call({ action: 'closeImport', token: next });
});

it('preserves new source data and releases a stale cleanup receipt for a fresh selection', async () => {
  const f = await fixture();
  const token = await f.begin('local');
  await f.call({ action: 'unlockImport', token });
  await f.call({
    action: 'prepareImportCommit',
    token,
    keys: ['profile:name'],
    recordIds: [],
    imageIds: [],
  });
  vi.mocked(f.reader.removeSelected).mockRejectedValueOnce(Error('来源资料已改变，请重新选择。'));
  await expect(f.call({ action: 'closeImport', token, committed: true })).rejects.toThrow(
    '来源资料已改变',
  );
  expect(f.cleanSource).not.toHaveBeenCalled();
  expect(await f.receipts.read(destination, 'local')).toBeUndefined();
});

it('keeps the source interview when a new recording appears after the transfer was prepared', async () => {
  const f = await fixture();
  const token = await f.begin('local');
  await f.call({ action: 'unlockImport', token });
  await f.call({
    action: 'prepareImportCommit',
    token,
    keys: ['record:' + f.recordId],
    recordIds: [f.recordId],
    imageIds: [f.imageId],
  });
  const start = Date.now();
  const recording = new InterviewRecording(f.library.prepare('local', f.recordId, false), start);
  recording.append('system', new Float32Array([0.3, 0.2]), 16000, start);
  await recording.close(start + 500);
  await expect(f.call({ action: 'closeImport', token, committed: true })).rejects.toThrow(
    '来源资料已改变',
  );
  expect(f.reader.removeSelected).not.toHaveBeenCalled();
  expect(await f.library.list('local', f.recordId)).toHaveLength(1);
});

it('rejects a stale source after cancellation and ignores directory metadata claiming another account', async () => {
  const f = await fixture();
  const token = await f.begin('local');
  let release!: () => void;
  const started = vi.fn();
  f.open.mockImplementationOnce(async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return f.reader;
  });
  const opening = f.call({ action: 'unlockImport', token });
  expect(started).toHaveBeenCalledOnce();
  const cancelled = f.importer.cancel();
  release();
  await expect(opening).rejects.toThrow();
  await cancelled;
  expect(f.reader.close).toHaveBeenCalledOnce();
  await expect(f.call({ action: 'unlockImport', token })).rejects.toThrow();
  await writeFile(
    path.join(profileDirectory(f.tmp, source), 'profile-owner.json'),
    JSON.stringify({ id: destination, email: alice.email }),
  );
  expect(await f.accounts.list(destination)).toEqual([{ id: 'local' }]);
});

it('preserves the availability of unknown cloud snapshots without sending their names to the renderer', async () => {
  const unknown = { id: randomUUID(), name: 'private metadata', headVersion: null };
  const known = { id: randomUUID(), name: 'profile:main', headVersion: randomUUID() };
  const page = { items: [unknown, known], nextCursor: unknown.id, storage: {} };
  const api = vi.fn(async () => page);
  const client = new CloudSyncClient({
    snapshot: () => ({ user: alice }),
    api,
  } as unknown as CloudAccountClient);
  expect(await client.call({ action: 'list', userId: alice.id })).toEqual({
    ok: true,
    value: { ...page, items: [{ ...unknown, name: '' }, known] },
  });
});
