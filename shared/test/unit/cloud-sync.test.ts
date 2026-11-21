import { describe, expect, it, vi } from 'vitest';
import {
  CloudSyncEngine,
  decideSync,
  defaultSyncPreferences,
  type SyncSaved,
  type SyncView,
} from '../../src/services/cloudSync';
import {
  digestCloudBlob,
  packCloudItem,
  unpackCloudItem,
  type LocalSyncItem,
} from '../../src/services/cloudData';
import { movedCloudItems, movedProfileHash, recordMovedCloudItems } from '../../src/services/migrationSyncProtection';
import {
  validCloudSyncCall,
  type CloudResource,
  type CloudSyncCall,
  type CloudSyncResult,
  type SyncKind,
} from '../../electron/contracts/cloudSync';

const userId = '11111111-1111-4111-8111-111111111111';
it('refreshing capacity only reads cloud metadata, without starting an upload or restore', async () => {
  const f = fixture();
  f.local.set('profile:main', { kind: 'profile', blob: new Blob(['synthetic profile']) });
  const preferences = defaultSyncPreferences();
  preferences.enabled.profile = true;
  await f.engine.configure(preferences);
  await f.engine.idle();
  f.calls.length = 0;
  await f.engine.refreshStorage();
  expect(f.calls.map((call) => call.action)).toEqual(['list']);
});
function fixture(saved?: SyncSaved, moved?: ReturnType<typeof movedCloudItems>) {
  const local = new Map<string, { kind: SyncKind; blob: Blob; parent?: string; localRevision?: string; digest?: LocalSyncItem['digest']; read?: () => Promise<Blob> }>();
  const remote = new Map<string, CloudResource & { blob: Blob }>();
  const uploads = new Map<
    string,
    {
      resource: CloudResource & { blob: Blob };
      bytes: number;
      sha256: string;
      revision: number;
      parts: Map<number, Uint8Array>;
      complete?: boolean;
    }
  >();
  const requests = new Map<string, string>();
  const calls: CloudSyncCall[] = [];
  const applied: string[] = [];
  let stored: SyncSaved | undefined = saved;
  const persist = vi.fn(async (value: SyncSaved) => { stored = structuredClone(value); });
  let view: SyncView = { preferences: defaultSyncPreferences(), marks: {}, busy: false };
  let hook: ((c: CloudSyncCall) => Promise<CloudSyncResult | undefined>) | undefined;
  let listHook: ((kind: SyncKind) => void) | undefined;
  let viewHook: ((view: SyncView) => void) | undefined;
  const ok = (value: unknown): CloudSyncResult => ({ ok: true, value });
  const manifest = async (id: string) => {
    const u = uploads.get(id)!;
    return {
      id,
      resourceId: u.resource.id,
      state: u.complete ? 'complete' : 'pending',
      bytes: u.bytes,
      sha256: u.sha256,
      chunkBytes: 1048576,
      partCount: Math.ceil(u.bytes / 1048576),
      expiresAt: Date.now() + 86400000,
      versionId: u.resource.headVersion,
      revision: u.resource.revision || null,
      parts: await Promise.all(
        [...u.parts].map(async ([index, bytes]) => ({
          index,
          bytes: bytes.byteLength,
          sha256: await digestCloudBlob(new Blob([new Uint8Array(bytes)])),
        })),
      ),
    };
  };
  const ports: ConstructorParameters<typeof CloudSyncEngine>[0] = {
    userId,
    saved,
    moved,
    profileVersion: () => local.get('profile:main')?.blob ?? null,
    get: async (kind, key) => {
      const item = local.get(key);
      if (item?.kind === kind) return { key, kind, parent: item.parent, localRevision: item.localRevision, digest: item.digest, blob: item.read ?? (async () => item.blob) };
    },
    list: async (kind) => {
      const items = [...local]
        .filter(([, i]) => i.kind === kind)
        .map(([key, i]): LocalSyncItem => ({
          key,
          kind,
          parent: i.parent,
          localRevision: i.localRevision,
          digest: i.digest,
          blob: i.read ?? (async () => i.blob),
        }));
      listHook?.(kind);
      return items;
    },
    apply: async (key, blob) => {
      applied.push(key);
      local.set(key, {
        kind: key.startsWith('profile:')
          ? 'profile'
          : key.startsWith('record:')
            ? 'history'
            : 'knowledgebase',
        blob,
      });
    },
    persist,
    emit: (value) => {
      view = value;
      viewHook?.(value);
    },
    request: async (c) => {
      calls.push(c);
      const override = await hook?.(c);
      if (override) return override;
      switch (c.action) {
        case 'list': {
          const counts = { profile: 0, history: 0, knowledgebase: 0 };
          for (const r of remote.values()) counts[r.kind] += r.bytes;
          const reserved = { profile: 0, history: 0, knowledgebase: 0 };
          for (const u of uploads.values()) if (!u.complete) reserved[u.resource.kind] += u.bytes;
          return ok({
            items: [...remote.values()].map(({ blob, ...r }) => r),
            nextCursor: null,
            storage: {
              currentBytes: counts,
              reservedBytes: reserved,
              storedBytes: Object.fromEntries(
                Object.entries(counts).map(([kind, bytes]) => [
                  kind,
                  bytes + reserved[kind as SyncKind],
                ]),
              ),
              knowledgeCapacityBytes: 100000000,
              capacityBytes: 100000000,
            },
          });
        }
        case 'create': {
          const r = {
            id: c.id,
            kind: c.kind,
            name: c.key,
            revision: 0,
            headVersion: null,
            bytes: 0,
            sha256: null,
            createdAt: Date.now(),
            blob: new Blob(),
          };
          remote.set(c.id, r);
          return ok(r);
        }
        case 'begin': {
          const r = remote.get(c.id)!;
          const old = requests.get(c.requestId);
          if (old && uploads.has(old)) return ok(await manifest(old));
          if (c.revision !== r.revision) return { ok: false, status: 409, error: 'conflict' };
          const id = crypto.randomUUID();
          requests.set(c.requestId, id);
          uploads.set(id, {
            resource: r,
            bytes: c.bytes,
            sha256: c.sha256,
            revision: c.revision,
            parts: new Map(),
          });
          return ok(await manifest(id));
        }
        case 'put':
          uploads.get(c.id)!.parts.set(c.index, c.bytes);
          return ok({ stored: true });
        case 'complete': {
          const u = uploads.get(c.id)!;
          if (u.complete) return ok(await manifest(c.id));
          const blob = new Blob([...u.parts.values()].map((b) => new Uint8Array(b)));
          expect(await digestCloudBlob(blob)).toBe(u.sha256);
          expect(blob.size).toBe(u.bytes);
          u.resource.blob = blob;
          u.resource.bytes = blob.size;
          u.resource.sha256 = u.sha256;
          u.resource.revision++;
          u.resource.headVersion = crypto.randomUUID();
          u.complete = true;
          return ok(await manifest(c.id));
        }
        case 'versions':
          return ok({ items: [] });
        case 'abort':
          uploads.delete(c.id);
          return ok({ deleted: true });
        case 'remove': {
          const r = remote.get(c.id)!;
          if (r.revision !== c.revision) return { ok: false, status: 409, error: 'conflict' };
          remote.delete(c.id);
          for (const [id, u] of uploads) if (u.resource.id === c.id) uploads.delete(id);
          return ok({ deleted: true });
        }
        case 'manifest': {
          const r = remote.get(c.id)!;
          const parts = [];
          for (let n = 0; n < Math.ceil(r.bytes / 1048576); n++) {
            const b = r.blob.slice(n * 1048576, (n + 1) * 1048576);
            parts.push({ index: n, bytes: b.size, sha256: await digestCloudBlob(b) });
          }
          return ok({
            id: c.id,
            bytes: r.bytes,
            sha256: r.sha256,
            chunkBytes: 1048576,
            partCount: parts.length,
            parts,
          });
        }
        case 'read':
          return ok(
            new Uint8Array(
              await remote
                .get(c.id)!
                .blob.slice(c.index * 1048576, (c.index + 1) * 1048576)
                .arrayBuffer(),
            ),
          );
        default:
          throw Error('Unexpected ' + c.action);
      }
    },
  };
  let engine = new CloudSyncEngine(ports);
  return {
    ports,
    get engine() {
      return engine;
    },
    restart(cold = false) {
      engine.stop();
      engine = new CloudSyncEngine({
        ...ports,
        saved: cold ? { preferences: stored!.preferences, baselines: {} } : stored,
      });
    },
    local,
    remote,
    calls,
    persist,
    applied,
    uploads,
    get view() {
      return view;
    },
    get saved() {
      return stored!;
    },
    setHook(value: typeof hook) {
      hook = value;
    },
    setListHook(value: typeof listHook) {
      listHook = value;
    },
    setViewHook(value: typeof viewHook) {
      viewHook = value;
    },
    async enable(...kinds: SyncKind[]) {
      await engine.configure({
        ...defaultSyncPreferences(),
        enabled: {
          profile: kinds.includes('profile'),
          history: kinds.includes('history'),
          knowledgebase: kinds.includes('knowledgebase'),
        },
      });
      await engine.request();
    },
    put(key: string, kind: SyncKind, text: string | Uint8Array, parent?: string) {
      local.set(key, {
        kind,
        blob: new Blob([typeof text === 'string' ? text : new Uint8Array(text)]),
        parent,
      });
    },
  };
}
describe('cloud sync consistency and backpressure', () => {
  it('rechecks an old image after pending remote records, including a failed restore and restart', async () => {
    const f = fixture(), id = crypto.randomUUID(), image = 'image:' + id, record = 'record:next';
    f.put(image, 'history', 'synthetic image bytes');
    await f.enable('history');
    const stored = [...f.remote.values()].find(r => r.name === image)!;
    f.local.delete(image);
    const recordBlob = new Blob(['synthetic next record']);
    const remoteId = crypto.randomUUID();
    f.remote.set(remoteId, { ...stored, id: remoteId, name: record, headVersion: crypto.randomUUID(),
      blob: recordBlob, bytes: recordBlob.size, sha256: await digestCloudBlob(recordBlob) });
    const get = f.ports.get;
    f.ports.get = async (kind, key) => {
      const entry = await get(kind, key);
      return entry && key === record ? { ...entry, dependencies: [image] } : entry;
    };
    let fail = true;
    f.ports.apply = async (key, blob, _expected, _guard, readMissingImage) => {
      expect(key).toBe(record);
      if (fail) throw Error('synthetic interrupted transfer');
      const recovered = await readMissingImage!(id);
      expect(await recovered!.text()).toBe('synthetic image bytes');
      f.local.set(image, { kind: 'history', blob: recovered! });
      f.local.set(record, { kind: 'history', blob });
    };
    f.restart();
    await f.engine.request();
    expect(f.view.marks[record].status).toBe('error');
    expect(f.remote.get(stored.id)?.headVersion).toBe(stored.headVersion);
    fail = false;
    f.restart();
    await f.engine.request();
    expect(f.view.marks[record].status).toBe('synced');
    expect(f.view.marks[image].status).toBe('synced');
    expect(f.calls.filter(call => call.action === 'remove')).toHaveLength(0);
  });
  it('resumes cleanup after an acknowledged upload and never deletes the current head', async () => {
    const f = fixture(), key = 'profile:main';
    f.put(key, 'profile', 'first');
    await f.enable('profile');
    const resource = [...f.remote.values()][0], oldVersion = resource.headVersion!, oldRevision = resource.revision;
    let fail = true;
    f.setHook(async call => {
      if (call.action === 'versions') return fail ? { ok: false, status: 503, error: 'offline' } :
        { ok: true, value: { items: [
          { id: oldVersion, revision: oldRevision }, { id: resource.headVersion, revision: resource.revision },
          { id: crypto.randomUUID(), revision: resource.revision + 1 },
        ] } };
      if (call.action === 'prune') return { ok: true, value: {} };
    });
    f.put(key, 'profile', 'second');
    await f.engine.request();
    expect(f.saved.baselines[key].cleanupPending).toBe(true);
    f.restart();
    fail = false;
    f.calls.length = 0;
    await f.engine.request();
    expect(f.calls.filter(c => c.action === 'prune').map(c => c.version)).toEqual([oldVersion]);
    expect(f.saved.baselines[key].cleanupPending).toBeUndefined();
    expect(f.view.marks[key].status).toBe('synced');
  });
  it('checks the profile once and leaves unchanged baselines on disk during an idle poll', async () => {
    const f = fixture();
    f.put('profile:main', 'profile', 'synthetic profile');
    for (let n = 0; n < 12; n++) f.put('record:r' + n, 'history', 'record ' + n);
    await f.enable('profile', 'history');
    const lists = vi.fn();
    f.setListHook(lists);
    f.persist.mockClear();
    await f.engine.request();
    expect(lists.mock.calls.map(([kind]) => kind)).toEqual(['profile', 'history']);
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.view.marks['record:r11'].status).toBe('synced');
  });
  it('reads image bytes only on upload and refuses a revision that no longer identifies them', async () => {
    const f = fixture();
    const key = 'image:' + crypto.randomUUID();
    const blob = new Blob(['first']);
    const digest = vi.fn(async () => digestCloudBlob(blob));
    const read = vi.fn(async () => blob);
    f.local.set(key, { kind: 'history', blob, digest, read });
    await f.enable('history');
    expect(read).toHaveBeenCalledTimes(1);
    digest.mockClear();
    await f.engine.request(true);
    expect(digest).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(f.view.marks[key].status).toBe('synced');
    digest.mockImplementation(async () => digestCloudBlob(new Blob(['replacement'])));
    f.calls.length = 0;
    await f.engine.request(true);
    expect(f.view.marks[key].status).toBe('conflict');
    expect(f.calls.some(c => c.action === 'begin')).toBe(false);
  });
  it('skips unchanged interview bodies on periodic sync and reads an edited revision', async () => {
    const f = fixture(), blob = new Blob(['initial record']);
    const read = vi.fn(async () => blob);
    const key = 'record:synthetic';
    const item = { kind: 'history' as const, blob, localRevision: crypto.randomUUID(), read };
    f.local.set(key, item);
    await f.enable('history');
    expect(read).toHaveBeenCalledTimes(1);
    await f.engine.request(true);
    expect(read).toHaveBeenCalledTimes(1);
    item.localRevision = crypto.randomUUID();
    read.mockResolvedValue(new Blob(['edited record']));
    await f.engine.request(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(f.view.marks[key].status).toBe('synced');
  });
  it('keeps moved records in the cloud and syncs only visible profile fields on this device', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    try {
      const undo = recordMovedCloudItems('account:' + userId, ['record:original'], ['name']);
      expect(movedCloudItems('another-account').fields.size).toBe(0);
      undo();
      expect(storage.size).toBe(0);
      const moved = movedCloudItems(userId);
      const f = fixture(undefined, moved);
      const key = 'profile:main';
      const profile = (name: string, background: string) =>
        packCloudItem(key, JSON.stringify({ name, background, jobDescription: '' }));
      const put = (name: string, background: string) => f.local.set(key, { kind: 'profile', blob: profile(name, background) });
      put('源姓名', '原摘要');
      f.put('record:original', 'history', 'record from source');
      await f.enable('profile', 'history');
      const remote = [...f.remote.values()].find((r) => r.name === key)!;
      const initial = remote.revision;
      recordMovedCloudItems(userId, ['record:original'], ['name']);
      Object.assign(moved, movedCloudItems(userId));
      put('', '原摘要');
      f.local.delete('record:original');
      f.restart();
      f.calls.length = 0;
      await f.engine.request(true);
      expect(remote.revision).toBe(initial);
      expect(f.calls.some((c) => ['remove', 'complete'].includes(c.action))).toBe(false);
      expect(f.local.has('record:original')).toBe(false);
      put('', '修改未迁移字段');
      await f.engine.request(true);
      const read = async (blob: Blob) => JSON.parse(await (await unpackCloudItem(key, blob)).payload.text());
      expect(await read(remote.blob)).toMatchObject({ name: '源姓名', background: '修改未迁移字段' });
      const updated = profile('其他设备的新姓名', '其他设备的新摘要');
      Object.assign(remote, { revision: remote.revision + 1, headVersion: crypto.randomUUID(), blob: updated,
        bytes: updated.size, sha256: await digestCloudBlob(updated) });
      await f.engine.request(true);
      expect(await read(f.local.get(key)!.blob)).toMatchObject({ name: '', background: '其他设备的新摘要' });
      expect(await read(remote.blob)).toMatchObject({ name: '其他设备的新姓名' });
      expect(f.local.has('record:original')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('pulls visible remote edits on the first automatic sync after a partial move and again after restart', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    try {
      const moved = movedCloudItems(userId);
      const f = fixture(undefined, moved);
      const key = 'profile:main';
      const profile = (name: string, background: string) => JSON.stringify({ name, background, jobDescription: '' });
      const local = (raw: string) => f.local.set(key, { kind: 'profile', blob: packCloudItem(key, raw) });
      const original = profile('Migrated', 'Original');
      const visible = profile('', 'Original');
      local(original);
      await f.enable('profile');
      const remote = [...f.remote.values()][0];
      recordMovedCloudItems(userId, [], ['name'], {
        before: await movedProfileHash(original), after: await movedProfileHash(visible),
      });
      local(visible);
      for (const updated of ['First remote edit', 'Second remote edit']) {
        const blob = packCloudItem(key, profile(updated + ' hidden', updated));
        Object.assign(remote, {
          revision: remote.revision + 1, headVersion: crypto.randomUUID(), blob,
          bytes: blob.size, sha256: await digestCloudBlob(blob),
        });
        Object.assign(moved, movedCloudItems(userId));
        f.restart();
        f.calls.length = 0;
        await f.engine.request(true);
        expect(f.view.marks[key].status).toBe('synced');
        expect(await (await unpackCloudItem(key, f.local.get(key)!.blob)).payload.text()).toBe(profile('', updated));
        expect(f.calls.some(c => ['begin', 'complete', 'remove'].includes(c.action))).toBe(false);
      }
      // Genuine concurrent edits of a visible field still need the user's decision.
      local(profile('', 'Unsynced local edit'));
      const other = packCloudItem(key, profile('Still hidden', 'Concurrent remote edit'));
      Object.assign(remote, {
        revision: remote.revision + 1, headVersion: crypto.randomUUID(), blob: other,
        bytes: other.size, sha256: await digestCloudBlob(other),
      });
      await f.engine.request(true);
      expect(f.view.marks[key].status).toBe('conflict');
      expect(await (await unpackCloudItem(key, f.local.get(key)!.blob)).payload.text())
        .toBe(profile('', 'Unsynced local edit'));
      await f.engine.resolve(key, 'cloud');
      expect(await (await unpackCloudItem(key, f.local.get(key)!.blob)).payload.text())
        .toBe(profile('', 'Concurrent remote edit'));
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it.each(['history', 'knowledgebase'] as const)(
    'preserves unrelated %s badges before, during and after a concurrent edit',
    async (kind) => {
      const f = fixture();
      const library = kind === 'knowledgebase';
      const key = (id: string) => (library ? 'file:' : 'record:') + id;
      const edit = (id: string, content: string) => {
        f.put(key(id), kind, content, library ? 'base:' + id : undefined);
        f.engine.dirty(kind, library ? [key(id), 'base:' + id] : [key(id)]);
      };
      for (const id of ['a', 'b', 'c']) {
        if (library) f.put('base:' + id, kind, id);
        edit(id, id);
      }
      await f.enable(kind);
      const unaffected: string[] = [];
      f.setViewHook(({ marks }) => {
        unaffected.push(marks[key('c')].status);
        if (library) unaffected.push(marks['base:c'].status);
      });
      edit('a', 'updated A');
      await f.engine.idle();
      expect(f.view.marks[key('a')].status).toBe('unsynced');
      expect(f.view.marks[key('b')].status).toBe('synced');
      if (library) expect(f.view.marks['base:a'].status).toBe('unsynced');
      let observed = false;
      f.setHook(async (call) => {
        if (call.action !== 'begin' || f.remote.get(call.id)?.name !== key('a')) return;
        edit('b', 'updated B');
        await vi.waitFor(() => {
          expect(f.view.marks[key('a')].status).toBe('syncing');
          expect(f.view.marks[key('b')].status).toBe('unsynced');
          if (library) expect(f.view.marks['base:a'].status).toBe('syncing');
        });
        observed = true;
      });
      await f.engine.request();
      expect(observed).toBe(true);
      expect(new Set(unaffected)).toEqual(new Set(['synced']));
      expect(Object.values(f.view.marks).every((mark) => mark.status === 'synced')).toBe(true);
      f.engine.stop();
    },
  );
  it('keeps saved records awaiting verification until the first listing returns', async () => {
    const f = fixture();
    f.put('record:a', 'history', 'a');
    await f.enable('history');
    f.restart();
    const work = f.engine.request();
    expect(f.view.marks['record:a'].status).toBe('checking');
    await work;
    expect(f.view.marks['record:a'].status).toBe('synced');
    f.engine.stop();
  });
  it('coalesces thousand-record summaries inside the engine and flushes request/idle before returning', async () => {
    vi.useFakeTimers();
    const blob = new Blob(['synthetic record']);
    const hash = await digestCloudBlob(blob);
    const resources: CloudResource[] = Array.from({ length: 1000 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: 'record:item' + i,
      kind: 'history',
      revision: 1,
      headVersion: crypto.randomUUID(),
      bytes: blob.size,
      sha256: hash,
      createdAt: 1,
    }));
    const preferences = defaultSyncPreferences();
    preferences.enabled.history = true;
    let view: SyncView | undefined;
    let summaries = 0;
    const engine = new CloudSyncEngine({
      userId,
      saved: {
        preferences,
        baselines: Object.fromEntries(
          resources.map((r) => [r.name, { id: r.id, revision: 1, hash }]),
        ),
      },
      list: async () =>
        resources.map((r) => ({ key: r.name, kind: 'history', blob: async () => blob })),
      get: async () => { throw Error('No restore expected'); },
      persist: async () => {},
      apply: async () => {
        throw Error('No restore expected');
      },
      emit: (value) => {
        view = value;
      },
      request: async (call) => {
        if (call.action !== 'list') throw Error('No mutation expected');
        const offset = call.cursor ? resources.findIndex((r) => r.id === call.cursor) : 0;
        const counts = { profile: 0, history: resources.length * blob.size, knowledgebase: 0 };
        return {
          ok: true,
          value: {
            items: resources.slice(offset, offset + 50),
            nextCursor: resources[offset + 50]?.id ?? null,
            storage: {
              currentBytes: counts,
              reservedBytes: { profile: 0, history: 0, knowledgebase: 0 },
              storedBytes: counts,
              capacityBytes: 100000000,
              knowledgeCapacityBytes: 100000000,
            },
          },
        };
      },
    });
    // Count the actual full-key traversal, not merely subscriber notifications.
    const allKeys = Reflect.get(engine, 'allKeys') as () => Set<string>;
    Reflect.set(engine, 'allKeys', () => {
      summaries++;
      return allKeys.call(engine);
    });
    try {
      await engine.request();
      expect(summaries).toBe(2);
      expect(view!.busy).toBe(false);
      expect(Object.keys(view!.marks)).toHaveLength(1000);
      expect(Object.values(view!.marks).every((mark) => mark.status === 'synced')).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      engine.dirty('history');
      expect(summaries).toBe(2);
      await engine.idle();
      expect(summaries).toBe(3);
      expect(Object.values(view!.marks).every((mark) => mark.status === 'unsynced')).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      engine.stop();
      vi.useRealTimers();
    }
  });
  it.each([
    [409, 'conflict'],
    [507, 'error'],
  ] as const)(
    'publishes %s immediately while the next record remains in flight',
    async (status, state) => {
      vi.useFakeTimers();
      const f = fixture();
      f.put('record:first', 'history', 'first');
      f.put('record:second', 'history', 'second');
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      f.setHook(async (call) => {
        if (call.action !== 'begin') return;
        if (f.remote.get(call.id)?.name === 'record:first')
          return { ok: false, status, error: 'synthetic first-record failure' };
        entered();
        await blocked;
      });
      const work = f.enable('history');
      try {
        await started;
        expect(f.view.marks['record:first'].status).toBe(state);
        expect(f.view.busy).toBe(true);
        release();
        await work;
        expect(f.view.marks['record:first'].status).toBe(state);
        expect(f.view.marks['record:second'].status).toBe('synced');
        expect(f.view.busy).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        release();
        await work;
        f.engine.stop();
        vi.useRealTimers();
      }
    },
  );
  it('publishes cancellation once, keeps idle waiting for retirement and suppresses late views', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.put('profile:main', 'profile', 'synthetic profile');
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let emitted = 0;
    f.setViewHook(() => {
      emitted++;
    });
    f.setHook(async (call) => {
      if (call.action === 'begin') {
        entered();
        await blocked;
      }
    });
    const work = f.enable('profile');
    try {
      await started;
      await vi.advanceTimersByTimeAsync(16);
      expect(f.view.marks['profile:main'].status).toBe('syncing');
      f.engine.stop();
      expect(f.view.busy).toBe(false);
      expect(f.view.marks['profile:main'].status).toBe('unsynced');
      expect(vi.getTimerCount()).toBe(0);
      const stoppedCount = emitted;
      let retired = false;
      const idle = f.engine.idle().then(() => {
        retired = true;
      });
      await Promise.resolve();
      expect(retired).toBe(false);
      release();
      await Promise.all([work, idle]);
      await vi.advanceTimersByTimeAsync(100);
      expect(emitted).toBe(stoppedCount);
      expect(retired).toBe(true);
    } finally {
      release();
      await work;
      f.engine.stop();
      vi.useRealTimers();
    }
  });
  it.each([
    'manifest-bytes',
    'manifest-digest',
    'part-count',
    'part-index',
    'part-length',
    'part-digest',
  ])('cold restore rejects corrupt %s without committing a file or baseline', async (damage) => {
    const f = fixture();
    f.put('base:a', 'knowledgebase', 'A');
    const blob = packCloudItem('file:a', 'payload', { id: 'a', baseId: 'a' });
    f.local.set('file:a', { kind: 'knowledgebase', parent: 'base:a', blob });
    await f.enable('knowledgebase');
    f.local.clear();
    f.restart(true);
    const file = [...f.remote.values()].find((r) => r.name === 'file:a')!;
    const manifest = {
      bytes: file.bytes,
      sha256: file.sha256,
      chunkBytes: 1048576,
      parts: [{ index: 0, bytes: file.bytes, sha256: file.sha256 }],
    };
    if (damage === 'manifest-bytes') manifest.bytes++;
    if (damage === 'manifest-digest') manifest.sha256 = '0'.repeat(64);
    if (damage === 'part-count') manifest.parts = [];
    if (damage === 'part-index') manifest.parts[0].index = 1;
    if (damage === 'part-digest') manifest.parts[0].sha256 = '0'.repeat(64);
    f.setHook(async (call) => {
      if (!('id' in call) || call.id !== file.id) return undefined;
      if (call.action === 'manifest') return { ok: true, value: manifest };
      if (call.action === 'read' && damage === 'part-length')
        return { ok: true, value: new Uint8Array(await blob.slice(0, -1).arrayBuffer()) };
      return undefined;
    });
    await f.engine.request();
    expect(f.local.has('file:a')).toBe(false);
    expect(f.saved.baselines['file:a']).toBeUndefined();
    expect(f.view.marks['file:a'].status).toBe('error');
    expect(f.applied).toEqual(['base:a']);
    expect(await file.blob.text()).toBe(await blob.text());
    expect(f.remote.size).toBe(2);
    expect(f.calls.some((c) => c.action === 'remove')).toBe(false);
  });
  it.each(['complete', 'stop', 'network-failure'])(
    'cold first-chunk retention is bounded to four MiB and released on %s',
    async (ending) => {
      const f = fixture();
      f.put('base:a', 'knowledgebase', 'A');
      for (let i = 0; i < 6; i++)
        f.local.set('file:d' + i, {
          kind: 'knowledgebase',
          parent: 'base:a',
          blob: packCloudItem('file:d' + i, new Uint8Array(1048576 + 2), {
            id: 'd' + i,
            baseId: 'a',
          }),
        });
      await f.enable('knowledgebase');
      f.local.clear();
      f.restart(true);
      f.calls.length = 0;
      let observed = false;
      f.setHook(async (call) => {
        if (call.action === 'read' && f.remote.get(call.id)?.name === 'base:a') {
          observed = true;
          const cache = Reflect.get(f.engine, 'prepared') as Map<string, { first: Uint8Array }>;
          expect(cache.size).toBe(4);
          expect([...cache.values()].reduce((sum, item) => sum + item.first.byteLength, 0)).toBe(
            4 * 1048576,
          );
          if (ending === 'stop') f.engine.stop();
          if (ending === 'network-failure') throw Error('synthetic disconnect');
        }
        return undefined;
      });
      await f.engine.request();
      expect(observed).toBe(true);
      expect(Reflect.get(f.engine, 'prepared').size).toBe(0);
      if (ending === 'complete') {
        expect(f.applied).toHaveLength(7);
        for (let i = 0; i < 6; i++) {
          const resource = [...f.remote.values()].find((r) => r.name === 'file:d' + i)!;
          expect(
            f.calls.filter((c) => c.action === 'read' && c.id === resource.id && c.index === 0),
          ).toHaveLength(i < 4 ? 1 : 2);
        }
      }
      expect(f.calls.filter((c) => c.action === 'remove')).toHaveLength(0);
    },
  );

  it('a cached first chunk from a different remote version is reread before applying bytes', async () => {
    const f = fixture();
    f.put('base:a', 'knowledgebase', 'A');
    const blob = packCloudItem('file:a', 'old', { id: 'a', baseId: 'a' });
    f.local.set('file:a', { kind: 'knowledgebase', parent: 'base:a', blob });
    await f.enable('knowledgebase');
    f.local.clear();
    f.restart(true);
    f.calls.length = 0;
    const file = [...f.remote.values()].find((r) => r.name === 'file:a')!;
    let version = '';
    f.setHook(async (call) => {
      if (call.action === 'read' && f.remote.get(call.id)?.name === 'base:a') {
        const newer = packCloudItem('file:a', 'new', { id: 'a', baseId: 'a' });
        version = crypto.randomUUID();
        Object.assign(file, {
          blob: newer,
          bytes: newer.size,
          headVersion: version,
          sha256: await digestCloudBlob(newer),
          revision: 2,
        });
        // Simulate metadata advancing after discovery but before this file runs.
        Object.assign(Reflect.get(f.engine, 'remote').get('file:a'), file);
      }
      return undefined;
    });
    await f.engine.request();
    const reads = f.calls.filter((c) => c.action === 'read' && c.id === file.id);
    expect(reads).toHaveLength(2);
    expect(reads.at(-1)).toMatchObject({ version, index: 0 });
    expect(
      await (await unpackCloudItem('file:a', f.local.get('file:a')!.blob)).payload.text(),
    ).toBe('new');
    expect(f.saved.baselines['file:a'].revision).toBe(2);
  });
  it('resumes after restart without retransmitting server-verified chunks whose acknowledgement was lost', async () => {
    const f = fixture();
    f.put('file:doc', 'knowledgebase', new Uint8Array(3 * 1048576));
    let dropped = false;
    f.setHook(async (c) => {
      if (c.action === 'put' && c.index === 1 && !dropped) {
        dropped = true;
        f.uploads.get(c.id)!.parts.set(c.index, c.bytes);
        return { ok: false, status: 0, error: 'lost acknowledgement' };
      }
      return undefined;
    });
    await f.enable('knowledgebase');
    expect(f.saved.uploads?.['file:doc']).toBeDefined();
    f.restart();
    await f.engine.request();
    expect(f.view.marks['file:doc'].status).toBe('synced');
    expect(Object.keys(f.saved.uploads!)).toHaveLength(0);
    for (const index of [0, 1, 2])
      expect(f.calls.filter((c) => c.action === 'put' && c.index === index)).toHaveLength(1);
  });
  it('releases interrupted uploads for deleted originals before using the shared slots again', async () => {
    const f = fixture();
    for (let index = 0; index < 4; index++) f.put('record:' + index, 'history', 'record');
    f.setHook(async (call) => call.action === 'put' ? { ok: false, status: 0, error: 'offline' } : undefined);
    await f.enable('profile', 'history');
    expect(Object.keys(f.saved.uploads!)).toHaveLength(4);
    f.local.clear();
    f.put('profile:main', 'profile', 'new profile');
    // One resource was already removed remotely. Another lost its begin acknowledgement.
    const missing = [...f.remote.values()].find((r) => r.name === 'record:0')!;
    f.remote.delete(missing.id);
    delete f.saved.uploads!['record:1'].id;
    f.restart();
    f.setHook(async (call) => call.action === 'abort' ? { ok: false, status: 0, error: 'offline' } : undefined);
    await f.engine.request();
    expect(Object.keys(f.saved.uploads!)).toHaveLength(4);
    f.setHook(undefined);
    f.calls.length = 0;
    await f.engine.request(true);
    expect(f.calls.filter((call) => call.action === 'abort')).toHaveLength(4);
    expect([...f.uploads.values()].every((upload) => upload.complete)).toBe(true);
    expect(f.saved.uploads).toEqual({});
    expect(f.view.marks['profile:main'].status).toBe('synced');
  });
  it('uses three-way comparison and preserves remote deletion until explicit resume', () => {
    const b = { id: userId, revision: 1, hash: 'base' };
    expect(decideSync('same', 'same')).toBe('same');
    expect(decideSync('local', 'remote')).toBe('conflict');
    expect(decideSync('base', 'remote', b)).toBe('pull');
    expect(decideSync('local', 'base', b)).toBe('push');
    expect(decideSync('local', undefined, b)).toBe('pause');
    expect(decideSync(undefined, 'base', b)).toBe('delete');
    expect(decideSync('local', 'base', { ...b, suppressed: true })).toBe('pause');
  });
  it('preempts a multi-chunk knowledge upload when a JD changes', async () => {
    const f = fixture();
    f.put('profile:main', 'profile', 'old JD');
    f.put('file:doc', 'knowledgebase', new Uint8Array(3 * 1048576));
    let changed = false;
    f.setHook(async (c) => {
      if (c.action === 'put' && !changed && c.index === 1) {
        changed = true;
        f.put('profile:main', 'profile', 'new JD');
      }
      return undefined;
    });
    await f.enable('profile', 'knowledgebase');
    const file = [...f.remote.values()].find((r) => r.name === 'file:doc')!,
      profile = [...f.remote.values()].find((r) => r.name === 'profile:main')!;
    expect(await profile.blob.text()).toBe('new JD');
    expect(file.bytes).toBe(3 * 1048576);
    const profileStarts = f.calls.filter((c) => c.action === 'begin' && c.id === profile.id);
    expect(profileStarts).toHaveLength(2);
    expect(f.view.marks['file:doc'].status).toBe('synced');
  });
  it('deleting only a cloud copy preserves local data and suppresses subsequent auto-upload', async () => {
    const f = fixture();
    f.put('profile:main', 'profile', 'JD');
    await f.enable('profile');
    await f.engine.removeCloud('profile:main');
    await f.engine.request();
    expect(f.remote.size).toBe(0);
    expect(await f.local.get('profile:main')!.blob.text()).toBe('JD');
    expect(f.view.marks['profile:main'].status).toBe('paused');
    await f.engine.resume('profile:main');
    expect(f.remote.size).toBe(1);
    f.put('profile:main', 'profile', 'later JD');
    await f.engine.request();
    expect(await [...f.remote.values()][0].blob.text()).toBe('later JD');
  });
  it('cloud deletion preempts the next chunk and keeps a single bounded priority slot', async () => {
    const f = fixture();
    f.put('profile:main', 'profile', 'JD');
    await f.enable('profile');
    f.put('file:doc', 'knowledgebase', new Uint8Array(3 * 1048576));
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.setHook(async (call) => {
      if (call.action === 'put' && call.index === 0) {
        entered();
        await blocked;
      }
      return undefined;
    });
    const uploading = f.enable('knowledgebase');
    await started;
    const removing = f.engine.removeCloud('profile:main');
    await expect(f.engine.removeCloud('profile:main')).rejects.toThrow('另一项');
    release();
    await Promise.all([uploading, removing]);
    await f.engine.idle();
    const removed = f.calls.findIndex((call) => call.action === 'remove');
    const nextPart = f.calls.findIndex((call) => call.action === 'put' && call.index === 1);
    expect(removed).toBeGreaterThan(0);
    expect(nextPart).toBeGreaterThan(removed);
    expect([...f.remote.values()].some((r) => r.kind === 'profile')).toBe(false);
    expect(f.view.marks['profile:main'].status).toBe('paused');
    expect(f.view.marks['file:doc'].status).toBe('synced');
    expect(await f.local.get('profile:main')!.blob.text()).toBe('JD');
  });
  it('library deletion includes its files, suppresses new children after restart and manual sync restores automation', async () => {
    const f = fixture();
    f.put('base:b', 'knowledgebase', 'library');
    f.put('file:one', 'knowledgebase', 'first', 'base:b');
    await f.enable('knowledgebase');
    await f.engine.removeCloud('base:b');
    expect(f.remote.size).toBe(0);
    expect(f.local.size).toBe(2);
    f.put('file:two', 'knowledgebase', 'second', 'base:b');
    f.restart();
    await f.engine.request(true);
    expect(f.remote.size).toBe(0);
    expect(f.view.marks['base:b'].status).toBe('paused');
    expect(f.view.marks['file:two'].status).toBe('paused');
    await f.engine.resume('base:b');
    expect(f.remote.size).toBe(3);
    f.put('file:one', 'knowledgebase', 'edited later', 'base:b');
    await f.engine.request();
    expect(await [...f.remote.values()].find((r) => r.name === 'file:one')!.blob.text()).toBe(
      'edited later',
    );
  });
  it('capacity updates during a multi-chunk upload and metadata reads remain throttled', async () => {
    const f = fixture();
    f.put('file:doc', 'knowledgebase', new Uint8Array(3 * 1048576));
    let clock = Date.now(),
      reads = 0;
    const time = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      f.setHook(async (call) => {
        if (call.action === 'begin') clock += 1100;
        if (call.action === 'list') reads++;
        if (call.action === 'put') {
          expect(reads).toBe(2); // One initial snapshot and one progress read, not one per chunk.
          await vi.waitFor(() => {
            expect(f.view.storage!.storedBytes.knowledgebase).toBe(3 * 1048576);
            expect(f.view.storage!.reservedBytes.knowledgebase).toBe(3 * 1048576);
          });
        }
        return undefined;
      });
      await f.enable('knowledgebase');
      expect(f.view.storage!.reservedBytes.knowledgebase).toBe(0);
    } finally {
      time.mockRestore();
    }
  });
  it('backs up one whole library before starting the next regardless of file insertion order', async () => {
    const f = fixture();
    f.put('base:a', 'knowledgebase', 'A');
    f.put('base:b', 'knowledgebase', 'B');
    f.put('file:b', 'knowledgebase', 'B file', 'base:b');
    f.put('file:a', 'knowledgebase', 'A file', 'base:a');
    await f.enable('knowledgebase');
    const started = f.calls
      .filter((call) => call.action === 'begin')
      .map((call) => (call.action === 'begin' ? f.remote.get(call.id)!.name : ''));
    expect(started).toEqual(['base:a', 'file:a', 'base:b', 'file:b']);
  });
  it.each([
    [507, 'error'],
    [409, 'conflict'],
  ] as const)(
    'keeps an active multi-file library syncing after a %s failure, then exposes %s',
    async (status, state) => {
      const f = fixture();
      f.put('base:a', 'knowledgebase', 'A');
      await f.enable('knowledgebase');
      expect(f.view.marks['base:a'].status).toBe('synced');
      f.put('file:first', 'knowledgebase', 'first file', 'base:a');
      f.put('file:second', 'knowledgebase', new Uint8Array(2 * 1048576), 'base:a');
      const activeStates: string[] = [];
      f.setHook(async (call) => {
        if (call.action === 'begin' && f.remote.get(call.id)?.name === 'file:first')
          return { ok: false, status, error: 'synthetic first-file failure' };
        if (call.action === 'put' && f.uploads.get(call.id)?.resource.name === 'file:second')
          activeStates.push(f.view.marks['base:a'].status);
        return undefined;
      });
      f.engine.dirty('knowledgebase');
      await f.engine.request();
      expect(activeStates).toEqual(['syncing', 'syncing']);
      expect(f.view.marks['file:first'].status).toBe(state);
      expect(f.view.marks['file:second'].status).toBe('synced');
      expect(f.view.marks['base:a'].status).toBe(state);
      expect(f.view.busy).toBe(false);
      f.put('file:third', 'knowledgebase', 'a later batch', 'base:a');
      f.engine.dirty('knowledgebase');
      await f.engine.request();
      expect(f.view.marks['file:first'].status).toBe(state);
      expect(f.view.marks['file:third'].status).toBe('synced');
      expect(f.view.marks['base:a'].status).toBe(state);
      expect(
        f.calls.filter(
          (call) => call.action === 'begin' && f.remote.get(call.id)?.name === 'file:first',
        ),
      ).toHaveLength(1);
    },
  );
  it('retires a stale local snapshot after an edit and never reports its old bytes as synced', async () => {
    const f = fixture();
    for (const base of ['a', 'b']) {
      f.put('base:' + base, 'knowledgebase', base);
      f.put('file:' + base, 'knowledgebase', 'old ' + base, 'base:' + base);
    }
    await f.enable('knowledgebase');
    const updatedHash = await digestCloudBlob(new Blob(['new a']));
    let edited = false;
    const premature: string[] = [];
    f.setViewHook((view) => {
      const remote = [...f.remote.values()].find((item) => item.name === 'file:a');
      if (edited && remote?.sha256 !== updatedHash && view.marks['file:a']?.status === 'synced')
        premature.push(view.marks['file:a'].status);
    });
    f.setListHook((kind) => {
      if (kind !== 'knowledgebase' || edited) return;
      queueMicrotask(() => {
        edited = true;
        f.put('file:a', 'knowledgebase', 'new a', 'base:a');
        f.engine.dirty('knowledgebase');
      });
    });
    await f.engine.request();
    expect(edited).toBe(true);
    expect(premature).toEqual([]);
    expect([...f.remote.values()].find((item) => item.name === 'file:a')?.sha256).toBe(updatedHash);
    expect(f.view.marks['base:a'].status).toBe('synced');
    expect(f.view.marks['base:b'].status).toBe('synced');
    expect(f.view.busy).toBe(false);
  });
  it('does not delete a cloud file when it was recreated after the local snapshot', async () => {
    const f = fixture();
    f.put('base:a', 'knowledgebase', 'A');
    f.put('file:a', 'knowledgebase', 'old a', 'base:a');
    await f.enable('knowledgebase');
    f.local.delete('file:a');
    let recreated = false;
    f.calls.length = 0;
    f.setListHook((kind) => {
      if (kind !== 'knowledgebase' || recreated) return;
      queueMicrotask(() => {
        recreated = true;
        f.put('file:a', 'knowledgebase', 'recreated a', 'base:a');
        f.engine.dirty('knowledgebase');
      });
    });
    await f.engine.request();
    expect(recreated).toBe(true);
    expect(f.calls.filter((call) => call.action === 'remove')).toEqual([]);
    const remote = [...f.remote.values()].find((item) => item.name === 'file:a')!;
    expect(await remote.blob.text()).toBe('recreated a');
    expect(f.view.marks['file:a'].status).toBe('synced');
  });
  it('shows an active child deletion before an earlier sibling failure, without hiding the final error', async () => {
    const f = fixture();
    f.put('base:a', 'knowledgebase', 'A');
    f.put('file:first', 'knowledgebase', 'first', 'base:a');
    f.put('file:second', 'knowledgebase', 'second', 'base:a');
    f.setHook(async (call) =>
      call.action === 'begin' && f.remote.get(call.id)?.name === 'file:first'
        ? { ok: false, status: 507, error: 'synthetic first-file failure' }
        : undefined,
    );
    await f.enable('knowledgebase');
    expect(f.view.marks['base:a'].status).toBe('error');
    const activeStates: string[] = [];
    f.setHook(async (call) => {
      if (call.action === 'remove' && f.remote.get(call.id)?.name === 'file:second') {
        await vi.waitFor(() => {
          expect(f.view.marks['base:a'].status).toBe('deleting');
        });
        activeStates.push(f.view.marks['base:a'].status);
      }
      return undefined;
    });
    await f.engine.removeCloud('file:second');
    expect(activeStates).toEqual(['deleting']);
    expect(f.view.marks['base:a'].status).toBe('error');
    expect(f.view.marks['file:first'].status).toBe('error');
    expect(f.view.marks['file:second'].status).toBe('paused');
  });
  it('cold restores whole libraries in order and keeps the active library syncing through its files', async () => {
    const f = fixture();
    f.put('base:a', 'knowledgebase', 'A');
    f.put('base:b', 'knowledgebase', 'B');
    for (const base of ['b', 'a']) {
      f.local.set('file:' + base, {
        kind: 'knowledgebase',
        parent: 'base:' + base,
        blob: packCloudItem('file:' + base, new Uint8Array(1048576 + 2), {
          id: base,
          baseId: base,
        }),
      });
    }
    await f.enable('knowledgebase');
    f.local.clear();
    f.restart(true);
    const observed: string[] = [];
    const lists = vi.fn();
    f.setListHook(lists);
    f.setHook(async (call) => {
      if (call.action === 'read' && f.local.has('base:a')) {
        await vi.waitFor(() => {
          expect(f.view.marks['base:a'].status).toBe(f.local.has('file:a') ? 'synced' : 'syncing');
          if (f.local.has('base:b')) expect(f.view.marks['base:b'].status).toBe('syncing');
        });
        if (!f.local.has('file:a')) observed.push('syncing');
      }
      return undefined;
    });
    await f.engine.request();
    expect(observed.length).toBeGreaterThan(0);
    expect(lists.mock.calls.map(([kind]) => kind)).toEqual(['knowledgebase']);
    expect(f.applied).toEqual(['base:a', 'file:a', 'base:b', 'file:b']);
    expect(f.saved.baselines['file:a'].parent).toBe('base:a');
    expect(f.saved.baselines['file:b'].parent).toBe('base:b');
    expect(f.view.marks['base:a'].status).toBe('synced');
    expect(f.view.marks['base:b'].status).toBe('synced');
    f.restart();
    await f.engine.request();
    expect(f.applied).toEqual(['base:a', 'file:a', 'base:b', 'file:b']);
    await f.engine.pause('base:a');
    expect(f.view.marks['file:a'].status).toBe('paused');
    expect(f.view.marks['file:b'].status).toBe('synced');
  });
  it('a corrupted cold-restore header never restores its file or trusts its parent', async () => {
    const f = fixture();
    f.put('base:a', 'knowledgebase', 'A');
    f.local.set('file:a', {
      kind: 'knowledgebase',
      parent: 'base:a',
      blob: packCloudItem('file:a', 'payload', { id: 'a', baseId: 'a' }),
    });
    await f.enable('knowledgebase');
    f.local.clear();
    f.restart(true);
    const file = [...f.remote.values()].find((r) => r.name === 'file:a')!;
    f.setHook(async (call) =>
      call.action === 'read' && call.id === file.id
        ? { ok: true, value: new Uint8Array(file.bytes) }
        : undefined,
    );
    await f.engine.request();
    expect(f.applied).toEqual(['base:a']);
    expect(f.view.marks['file:a'].status).toBe('error');
    expect(f.saved.baselines['file:a']).toBeUndefined();
  });
  it('cancelling a cold library download pauses its remaining files; resume downloads instead of deleting them', async () => {
    const f = fixture();
    f.put('base:a', 'knowledgebase', 'A');
    f.local.set('file:a', {
      kind: 'knowledgebase',
      parent: 'base:a',
      blob: packCloudItem('file:a', new Uint8Array(1048576 + 2), { id: 'a', baseId: 'a' }),
    });
    await f.enable('knowledgebase');
    f.local.clear();
    f.restart(true);
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.setHook(async (call) => {
      if (call.action === 'read' && call.index === 1) {
        entered();
        await blocked;
      }
      return undefined;
    });
    const downloading = f.engine.request();
    await started;
    const cancel = f.engine.pause('base:a');
    release();
    await Promise.all([downloading, cancel]);
    await f.engine.idle();
    expect(f.applied).toEqual(['base:a']);
    expect(f.view.marks['base:a'].status).toBe('paused');
    expect(f.saved.baselines['file:a']).toMatchObject({
      parent: 'base:a',
      suppressed: true,
      unrestored: true,
    });
    f.restart();
    await f.engine.request();
    expect(f.applied).toEqual(['base:a']);
    await f.engine.resume('base:a');
    expect(f.applied).toEqual(['base:a', 'file:a']);
    expect(f.remote.size).toBe(2);
    expect(f.view.marks['base:a'].status).toBe('synced');
    expect(f.calls.filter((call) => call.action === 'remove')).toEqual([]);
  });
  for (const [key, kind] of [
    ['profile:main', 'profile'],
    ['record:one', 'history'],
  ] as const)
    it(`cancelling ${kind} preserves its completed copy and stays paused across edits and restart`, async () => {
      const f = fixture();
      f.put(key, kind, 'old');
      await f.enable(kind);
      f.put(key, kind, 'new');
      let release!: () => void, entered!: () => void;
      const blocked = new Promise<void>((r) => {
        release = r;
      });
      const started = new Promise<void>((r) => {
        entered = r;
      });
      f.setHook(async (call) => {
        if (call.action === 'put') {
          entered();
          await blocked;
        }
        return undefined;
      });
      const uploading = f.engine.request();
      await started;
      const cancel = f.engine.pause(key);
      release();
      await Promise.all([uploading, cancel]);
      await f.engine.idle();
      expect(await [...f.remote.values()][0].blob.text()).toBe('old');
      expect(f.view.marks[key].status).toBe('paused');
      expect([...f.uploads.values()].every((u) => u.complete)).toBe(true);
      f.put(key, kind, 'edited while paused');
      f.restart();
      await f.engine.request(true);
      expect(await [...f.remote.values()][0].blob.text()).toBe('old');
      await f.engine.resume(key);
      expect(await [...f.remote.values()][0].blob.text()).toBe('edited while paused');
      expect(f.view.marks[key].status).toBe('synced');
    });
  it('cancelling a library aborts its partial upload and pauses the remaining and newly added files', async () => {
    const f = fixture();
    f.put('base:b', 'knowledgebase', 'library');
    f.put('file:one', 'knowledgebase', new Uint8Array(2 * 1048576), 'base:b');
    f.put('file:two', 'knowledgebase', 'second', 'base:b');
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.setHook(async (call) => {
      if (call.action === 'put' && f.uploads.get(call.id)!.bytes > 1048576) {
        entered();
        await blocked;
      }
      return undefined;
    });
    const uploading = f.enable('knowledgebase');
    await started;
    const cancel = f.engine.pause('base:b');
    release();
    await Promise.all([uploading, cancel]);
    await f.engine.idle();
    expect([...f.remote.values()].filter((r) => r.headVersion).map((r) => r.name)).toEqual([
      'base:b',
    ]);
    expect([...f.uploads.values()].every((u) => u.complete)).toBe(true);
    f.put('file:three', 'knowledgebase', 'third', 'base:b');
    f.restart();
    await f.engine.request();
    expect(f.view.marks['file:three'].status).toBe('paused');
    await f.engine.resume('base:b');
    expect([...f.remote.values()].filter((r) => r.headVersion)).toHaveLength(4);
    expect(f.view.marks['base:b'].status).toBe('synced');
  });
  it('changing both sides creates a conflict and never overwrites either implicitly', async () => {
    const f = fixture();
    f.put('profile:main', 'profile', 'initial');
    await f.enable('profile');
    const r = [...f.remote.values()][0];
    r.blob = new Blob(['other device']);
    r.sha256 = await digestCloudBlob(r.blob);
    r.bytes = r.blob.size;
    r.revision++;
    f.put('profile:main', 'profile', 'local edit');
    await f.engine.request();
    expect(f.view.marks['profile:main'].status).toBe('conflict');
    expect(await r.blob.text()).toBe('other device');
    expect(f.applied).toEqual([]);
    await f.engine.resolve('profile:main', 'cloud');
    expect(await f.local.get('profile:main')!.blob.text()).toBe('other device');
  });
  it('corrupted download never replaces local data', async () => {
    const f = fixture();
    f.put('profile:main', 'profile', 'initial');
    await f.enable('profile');
    const r = [...f.remote.values()][0];
    r.blob = new Blob(['remote']);
    r.sha256 = await digestCloudBlob(r.blob);
    r.bytes = r.blob.size;
    r.revision++;
    f.setHook(async (c) =>
      c.action === 'read' ? { ok: true, value: new Uint8Array([1, 2, 3, 4, 5, 6]) } : undefined,
    );
    await f.engine.request();
    expect(f.applied).toEqual([]);
    expect(f.view.marks['profile:main'].status).toBe('error');
  });
  it('resumes an interview-deferred upload from its last chunk and discovers the newly archived record', async () => {
    const f = fixture();
    await f.enable('history');
    f.put('record:manual', 'history', 'keep local');
    await f.engine.pause('record:manual');
    f.put('record:partial', 'history', new Uint8Array(1048577));
    f.setHook(async call => call.action === 'put' && call.index === 1
      ? { ok: false, status: 503, deferred: 'interview', error: '面试期间暂停同步。' }
      : undefined);
    await f.engine.request();
    expect(f.view.error).toBeUndefined();
    expect(f.view.marks['record:partial'].status).toBe('checking');
    const partialUploadId = f.saved.uploads?.['record:partial']?.id;
    expect(partialUploadId).toBeTruthy();
    f.put('record:finished', 'history', 'archived by the interview window');
    f.setHook(undefined);
    f.calls.length = 0;
    await f.engine.request();
    expect(f.calls.flatMap(call => call.action === 'put' && call.id === partialUploadId ? [call.index] : [])).toEqual([1]);
    expect(f.view.marks['record:partial'].status).toBe('synced');
    expect(f.view.marks['record:finished'].status).toBe('synced');
    expect(f.view.marks['record:manual'].status).toBe('paused');
  });
  it.each([429, 503])('honors server %i retry-after globally instead of hammering every queued item', async status => {
    const f = fixture();
    for (let i = 0; i < 100; i++) f.put('file:d' + i, 'knowledgebase', 'file');
    f.setHook(async (c) =>
      c.action === 'begin'
        ? { ok: false, status, error: 'rate limited', retryAfterSeconds: 300 }
        : undefined,
    );
    await f.enable('knowledgebase');
    await f.engine.request(true);
    expect(f.calls.filter((c) => c.action === 'begin')).toHaveLength(1);
    expect(f.calls.length).toBeLessThan(8);
  });
  it('shared server quota rejects an upload before sending chunks while profile work still runs first', async () => {
    const f = fixture();
    f.put('profile:main', 'profile', 'new JD');
    f.put('base:b', 'knowledgebase', 'base');
    f.put('file:d', 'knowledgebase', new Uint8Array(1000001), 'base:b');
    f.setHook(async (call) =>
      call.action === 'begin' && call.bytes > 1000000
        ? { ok: false, status: 507, error: '云端剩余空间不足。' }
        : undefined,
    );
    const p = defaultSyncPreferences();
    p.enabled = { profile: true, history: false, knowledgebase: true };
    await f.engine.configure(p);
    await f.engine.request();
    expect(f.view.marks['profile:main'].status).toBe('synced');
    expect(f.view.marks['file:d'].status).toBe('error');
    expect(f.view.marks['base:b'].status).toBe('error');
    expect(f.calls.filter((call) => call.action === 'put')).toHaveLength(2);
  });
  it('one worker coalesces many requests and stops late work on logout', async () => {
    const f = fixture();
    f.put('profile:main', 'profile', 'JD');
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.setHook(async (c) => {
      if (c.action === 'put') {
        entered();
        await blocked;
      }
      return undefined;
    });
    const work = f.enable('profile');
    await started;
    const pending = Array.from({ length: 20 }, () => f.engine.request());
    f.engine.stop();
    release();
    await work;
    await Promise.all(pending);
    expect(f.calls.filter((c) => c.action === 'complete')).toHaveLength(0);
    expect(f.saved.baselines['profile:main']).toBeUndefined();
  });
});
describe('untrusted cloud inputs', () => {
  it('bounds binary IPC, validates handles and rejects traversal', () => {
    expect(
      validCloudSyncCall({
        userId,
        action: 'put',
        id: userId,
        index: 0,
        bytes: new Uint8Array(1048576),
      }),
    ).toBe(true);
    for (const change of [
      { id: '../secrets' },
      { index: -1 },
      { bytes: new Uint8Array(1048577) },
      { userId: 'wrong' },
    ])
      expect(
        validCloudSyncCall({
          userId,
          action: 'put',
          id: userId,
          index: 0,
          bytes: new Uint8Array(1),
          ...change,
        }),
      ).toBe(false);
    expect(
      validCloudSyncCall({
        userId,
        action: 'create',
        id: userId,
        kind: 'knowledgebase',
        key: 'file:../../secret',
      }),
    ).toBe(false);
  });
  it('checks package version, declared header size and item identity without decompression', async () => {
    const blob = packCloudItem('file:test', new Uint8Array([1, 2, 3]), { name: 'synthetic.txt' });
    expect((await unpackCloudItem('file:test', blob)).payload.size).toBe(3);
    await expect(unpackCloudItem('file:other', blob)).rejects.toThrow('归属');
    await expect(
      unpackCloudItem(
        'file:test',
        new Blob([new Uint8Array([86, 67, 83, 49, 255, 255, 255, 255])]),
      ),
    ).rejects.toThrow();
  });
});
