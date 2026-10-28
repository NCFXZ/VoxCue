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
function fixture(saved?: SyncSaved) {
  const local = new Map<string, { kind: SyncKind; blob: Blob; parent?: string }>();
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
  let view: SyncView = { preferences: defaultSyncPreferences(), marks: {}, busy: false };
  let hook: ((c: CloudSyncCall) => Promise<CloudSyncResult | undefined>) | undefined;
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
    list: async (kind) =>
      [...local]
        .filter(([, i]) => i.kind === kind)
        .map(([key, i]): LocalSyncItem => ({
          key,
          kind,
          parent: i.parent,
          blob: async () => i.blob,
        })),
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
    persist: async (value) => {
      stored = structuredClone(value);
    },
    emit: (value) => {
      view = value;
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
          expect(f.view.storage!.storedBytes.knowledgebase).toBe(3 * 1048576);
          expect(f.view.storage!.reservedBytes.knowledgebase).toBe(3 * 1048576);
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
    f.setHook(async (call) => {
      if (call.action === 'read' && f.local.has('base:a')) {
        expect(f.view.marks['base:a'].status).toBe(f.local.has('file:a') ? 'synced' : 'syncing');
        if (!f.local.has('file:a')) observed.push('syncing');
        if (f.local.has('base:b')) expect(f.view.marks['base:b'].status).toBe('syncing');
      }
      return undefined;
    });
    await f.engine.request();
    expect(observed.length).toBeGreaterThan(0);
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
  it('honors server retry-after globally instead of hammering every queued item', async () => {
    const f = fixture();
    for (let i = 0; i < 100; i++) f.put('file:d' + i, 'knowledgebase', 'file');
    f.setHook(async (c) =>
      c.action === 'begin'
        ? { ok: false, status: 429, error: 'rate limited', retryAfterSeconds: 300 }
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
