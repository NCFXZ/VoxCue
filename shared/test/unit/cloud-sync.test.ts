import { describe, expect, it, vi } from 'vitest';
import {
  CloudSyncEngine,
  decideSync,
  defaultSyncPreferences,
  syncItemsWithStatus,
  syncKindForKey,
  type SyncSaved,
  type SyncView,
} from '../../src/services/cloudSync';
import {
  decodeCloudItem,
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
function recordBlob(key: string, title: string, images: string[]) {
  return packCloudItem(key, JSON.stringify({ id: key.slice(7), title, startedAt: 1, endedAt: 2, status: 'ended',
    mock: true, transcripts: [], answers: Array.from({ length: Math.max(1, Math.ceil(images.length / 5)) }, (_, index) => ({
      id: 'answer' + index, question: 'q', content: 'a',
      images: images.slice(index * 5, index * 5 + 5).map(id => ({ id: id.slice(6) })) })) }));
}
it('reads capacity once without paging the cloud inventory while all categories are off', async () => {
  const f = fixture();
  for (let i = 0; i < 101; i++) await publishBlob(f, 'record:' + i, new Blob(['record']));
  await f.engine.request();
  expect(f.view.storage?.currentBytes.history).toBe(606);
  await f.engine.request();
  await f.engine.request(true);
  expect(f.calls.map(call => call.action)).toEqual(['list']);
  await f.engine.refreshStorage();
  expect(f.calls.map(call => call.action)).toEqual(['list', 'list']);
});
function fixture(saved?: SyncSaved, moved?: ReturnType<typeof movedCloudItems>) {
  const local = new Map<string, { kind: SyncKind; blob: Blob; parent?: string; dependencies?: string[]; localRevision?: string; digest?: LocalSyncItem['digest']; read?: () => Promise<Blob> }>();
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
    removeLocal: async (key, expectedHash, guard) => {
      const current = local.get(key);
      if (!current || await digestCloudBlob(current.blob) !== expectedHash) throw Error('Local version changed');
      guard();
      local.delete(key);
    },
    removeLocalLibrary: async (root, _revisions, keys, recheck, guard) => {
      await recheck();
      guard();
      for (const key of keys) if (key !== root) local.delete(key);
      if (keys.includes(root)) local.delete(root);
    },
    get: async (kind, key) => {
      const item = local.get(key);
      if (item?.kind === kind) return { key, kind, parent: item.parent, dependencies: item.dependencies, localRevision: item.localRevision, digest: item.digest, blob: item.read ?? (async () => item.blob) };
    },
    list: async (kind) => {
      const items = [...local]
        .filter(([, i]) => i.kind === kind)
        .map(([key, i]): LocalSyncItem => ({
          key,
          kind,
          parent: i.parent,
          dependencies: i.dependencies,
          localRevision: i.localRevision,
          digest: i.digest,
          blob: i.read ?? (async () => i.blob),
        }));
      listHook?.(kind);
      return items;
    },
    apply: async (key, blob) => {
      applied.push(key);
      const restored = key.startsWith('record:') && await blob.slice(0, 4).text() === 'VCS1' ? await decodeCloudItem(key, blob) : undefined;
      local.set(key, { kind: syncKindForKey(key), blob, ...(restored?.type === 'record' ? { dependencies: restored.images.map(id => 'image:' + id) } : {}) });
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
          const all = [...remote.values()];
          const start = c.cursor ? all.findIndex(item => item.id === c.cursor) + 1 : 0;
          const page = all.slice(start, start + 50);
          return ok({
            items: page.map(({ blob, ...r }) => r),
            nextCursor: start + page.length < all.length ? page.at(-1)!.id : null,
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
async function publishBlob(f: ReturnType<typeof fixture>, key: string, blob: Blob) {
  const previous = [...f.remote.values()].find(item => item.name === key);
  const id = previous?.id ?? crypto.randomUUID();
  f.remote.set(id, { id, name: key, blob, kind: syncKindForKey(key), bytes: blob.size, sha256: await digestCloudBlob(blob),
    headVersion: crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1, createdAt: 1 });
}
describe('cloud sync consistency and backpressure', () => {
  describe('background conflict submissions', () => {
    async function conflictingRecords(keys: string[]) {
      const f = fixture();
      for (const key of keys) f.local.set(key, { kind: 'history', blob: recordBlob(key, 'original', []), dependencies: [] });
      await f.enable('history');
      for (const key of keys) {
        f.local.set(key, { kind: 'history', blob: recordBlob(key, 'local edit', []), dependencies: [] });
        await publishBlob(f, key, recordBlob(key, 'cloud edit', []));
      }
      await f.engine.request();
      const rows = () => syncItemsWithStatus(f.view.marks, 'conflict').map(([key]) => key).sort();
      expect(rows()).toEqual([...keys].sort());
      const choice = (key: string, side: 'local' | 'cloud') => ({ key, side, version: f.view.marks[key].groupVersion! });
      const cloud = (key: string) => [...f.remote.values()].find(entry => entry.name === key)!.blob;
      return { f, rows, choice, cloud };
    }

    it.each(['one batch', 'successive batches'] as const)('publishes selections from %s immediately, settles each row, and preserves unselected versions', async mode => {
      const first = 'record:first', second = 'record:second', other = 'record:unselected';
      const { f, rows, choice, cloud } = await conflictingRecords([first, second, other]);
      const keepCloud = choice(first, 'cloud'), keepLocal = choice(second, 'local');
      const entering = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const uploadingSecond = Promise.withResolvers<void>(), finishSecond = Promise.withResolvers<void>();
      f.setHook(async call => {
        if (call.action === 'list') { entering.resolve(); await release.promise; }
        if (call.action === 'begin' && f.remote.get(call.id)?.name === second) {
          uploadingSecond.resolve();
          await finishSecond.promise;
        }
      });
      try {
        expect(f.engine.submitResolutions([keepCloud, { ...keepLocal, version: 'outdated' }])).toBe(false);
        expect(rows()).toEqual([first, second, other]);
        expect(f.engine.submitResolutions(mode === 'one batch' ? [keepCloud, keepLocal] : [keepCloud])).toBe(true);
        expect(f.view.marks[first]).toMatchObject({ status: 'syncing', resolving: true });
        expect(rows()).toEqual(mode === 'one batch' ? [other] : [second, other]);
        expect(f.engine.submitResolutions([keepCloud])).toBe(false);
        await entering.promise;
        if (mode === 'successive batches') expect(f.engine.submitResolutions([keepLocal])).toBe(true);
        expect(f.view.marks[second]).toMatchObject({ status: 'syncing', resolving: true });
        expect(rows()).toEqual([other]);
        let retired = false;
        const idle = f.engine.idle().then(() => { retired = true; });
        release.resolve();
        await uploadingSecond.promise;
        expect(retired).toBe(false);
        await vi.waitFor(() => expect(f.view.marks[first].status).toBe('synced'));
        expect(f.view.marks[first].resolving).toBeFalsy();
        expect(f.view.marks[second]).toMatchObject({ status: 'syncing', resolving: true });
        finishSecond.resolve();
        await idle;
        expect(rows()).toEqual([other]);
        expect(f.view.marks[second].status).toBe('synced');
        expect(f.view.marks[second].resolving).toBeFalsy();
        for (const [key, localTitle, cloudTitle] of [
          [first, 'cloud edit', 'cloud edit'], [second, 'local edit', 'local edit'], [other, 'local edit', 'cloud edit'],
        ]) {
          expect(await f.local.get(key)!.blob.text()).toBe(await recordBlob(key, localTitle, []).text());
          expect(await cloud(key).text()).toBe(await recordBlob(key, cloudTitle, []).text());
        }
        expect(f.engine.submitResolutions([keepCloud])).toBe(false);
      } finally {
        release.resolve();
        finishSecond.resolve();
        await f.engine.idle();
      }
    });

    it.each(['cloud version changed', 'account stopped'] as const)('preserves local data if the %s after a selection was accepted', async reason => {
      const key = 'record:selected';
      const { f, choice, rows } = await conflictingRecords([key]);
      const reviewed = choice(key, 'cloud');
      const entering = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      f.setHook(async call => {
        if (call.action === 'list') { entering.resolve(); await release.promise; }
      });
      try {
        expect(f.engine.submitResolutions([reviewed])).toBe(true);
        await entering.promise;
        if (reason === 'account stopped') f.engine.stop();
        else await publishBlob(f, key, recordBlob(key, 'new cloud edit', []));
        release.resolve();
        await f.engine.idle();
        expect(f.applied).toEqual([]);
        expect(await f.local.get(key)!.blob.text()).toBe(await recordBlob(key, 'local edit', []).text());
        expect(f.view.marks[key].resolving).toBeFalsy();
        expect(f.engine.submitResolutions([reviewed])).toBe(false);
        if (reason === 'cloud version changed') {
          expect(rows()).toEqual([key]);
          expect(choice(key, 'cloud').version).not.toBe(reviewed.version);
          expect(f.engine.submitResolutions([choice(key, 'cloud')])).toBe(true);
          await f.engine.idle();
          expect(await f.local.get(key)!.blob.text()).toBe(await recordBlob(key, 'new cloud edit', []).text());
        }
      } finally {
        release.resolve();
        await f.engine.idle();
      }
    });
  });

  it('downloads a new interview body larger than the metadata cache once when existing local history is unchanged', async () => {
    const f = fixture(), old = 'record:existing', added = 'record:incoming', image = 'image:' + crypto.randomUUID();
    f.local.set(old, { kind: 'history', blob: recordBlob(old, 'Existing', []), dependencies: [] });
    await f.enable('history');
    const record = JSON.parse(await (await unpackCloudItem(added, recordBlob(added, 'Incoming', [image]))).payload.text());
    record.answers[0].content = 'x'.repeat(4 * 1048576 + 1);
    const blob = packCloudItem(added, JSON.stringify(record));
    await publishBlob(f, added, blob);
    await publishBlob(f, image, packCloudItem(image, 'image', { id: image.slice(6), preview: 'data:image/png;base64,YQ==' }));
    f.calls.length = 0;
    await f.engine.request();
    expect(f.view.marks[added].status).toBe('synced');
    const id = [...f.remote.values()].find(item => item.name === added)!.id;
    expect(f.calls.filter(call => call.action === 'read' && call.id === id)).toHaveLength(Math.ceil(blob.size / 1048576));
  });
  it('does not apply a reviewed cloud version if its sync category is disabled while downloading', async () => {
    const f = fixture(), root = 'profile:main';
    f.put(root, 'profile', 'initial');
    await f.enable('profile');
    f.put(root, 'profile', 'local edit');
    await publishBlob(f, root, new Blob(['cloud edit']));
    await f.engine.request();
    const version = f.view.marks[root].groupVersion!;
    f.setHook(async call => {
      if (call.action === 'read') await f.engine.configure(defaultSyncPreferences());
      return undefined;
    });
    expect(await f.engine.resolveSelected([{ key: root, side: 'cloud', version }])).toBe(false);
    expect(await f.local.get(root)!.blob.text()).toBe('local edit');
    expect(f.applied).toEqual([]);
  });
  it.each(['read', 'put'] as const)('disabling automatic sync during the last %s prevents committing that transfer', async action => {
    const f = fixture(), key = 'profile:main';
    f.put(key, 'profile', 'first');
    await f.enable('profile');
    if (action === 'read') await publishBlob(f, key, new Blob(['second']));
    else f.put(key, 'profile', 'second');
    f.calls.length = 0;
    f.setHook(async call => {
      if (call.action === action) await f.engine.configure(defaultSyncPreferences());
      return undefined;
    });
    await f.engine.request();
    expect(f.calls.some(call => call.action === action)).toBe(true);
    expect(f.calls.some(call => call.action === 'complete')).toBe(false);
    expect(f.applied).toEqual([]);
    expect(await f.local.get(key)!.blob.text()).toBe(action === 'read' ? 'first' : 'second');
    expect(await [...f.remote.values()][0].blob.text()).toBe(action === 'put' ? 'first' : 'second');
    f.setHook(undefined);
    await f.enable('profile');
    expect(await f.local.get(key)!.blob.text()).toBe('second');
    expect(await [...f.remote.values()][0].blob.text()).toBe('second');
  });
  it.each(['local', 'cloud'] as const)('resolves twenty changed screenshots without paging the entire account per image (%s)', async side => {
    const f = fixture(), key = 'record:interview';
    const images = Array.from({ length: 20 }, () => 'image:' + crypto.randomUUID());
    f.local.set(key, { kind: 'history', dependencies: images, blob: recordBlob(key, 'Interview', images) });
    const imageBlob = (id: string, text: string) => packCloudItem(id, text, { id: id.slice(6), preview: 'data:image/png;base64,YQ==' });
    for (const image of images) f.local.set(image, { kind: 'history', blob: imageBlob(image, 'original') });
    await f.enable('history');
    for (const image of images) {
      f.local.set(image, { kind: 'history', blob: imageBlob(image, 'local') });
      await publishBlob(f, image, imageBlob(image, 'cloud'));
    }
    for (let i = 0; i < 500; i++) await publishBlob(f, 'base:other-' + i, new Blob(['unrelated']));
    await f.engine.request();
    f.calls.length = 0;
    expect(await f.engine.resolveSelected([{ key, side, version: f.view.marks[key].groupVersion! }])).toBe(true);
    // 521 objects take 11 pages. Only the phase checks should scan all 11.
    expect(f.calls.filter(call => call.action === 'list' && call.cursor).length).toBeLessThanOrEqual(40);
    for (const image of images) {
      const expected = await digestCloudBlob(imageBlob(image, side));
      expect(await digestCloudBlob(f.local.get(image)!.blob)).toBe(expected);
      expect([...f.remote.values()].find(item => item.name === image)?.sha256).toBe(expected);
    }
  });
  it.each(['local', 'cloud'] as const)('updates a changed shared screenshot only with matching, current %s choices for all affected interviews', async side => {
    const f = fixture(), image = 'image:' + crypto.randomUUID(), roots = ['record:a', 'record:b'];
    const imageBlob = (value: string) => packCloudItem(image, value, { id: image.slice(6), preview: 'data:image/png;base64,YQ==' });
    for (const key of roots) f.local.set(key, { kind: 'history', dependencies: [image], blob: recordBlob(key, key, [image]) });
    f.local.set(image, { kind: 'history', blob: imageBlob('initial') });
    await f.enable('history');
    f.local.set(image, { kind: 'history', blob: imageBlob('local') });
    await publishBlob(f, image, imageBlob('cloud'));
    await f.engine.request();
    const rows = () => syncItemsWithStatus(f.view.marks, 'conflict');
    expect(rows().map(([key]) => key).sort()).toEqual(roots);
    const choices = rows().map(([key, mark]) => ({ key, version: mark.groupVersion!, side }));
    f.calls.length = 0;
    expect(await f.engine.resolveSelected(choices.slice(0, 1))).toBe(false);
    expect(await f.engine.resolveSelected([choices[0], { ...choices[1], version: 'outdated' }])).toBe(false);
    expect(await f.engine.resolveSelected([choices[0], { ...choices[1], side: side === 'local' ? 'cloud' : 'local' }])).toBe(false);
    expect(f.applied).toEqual([]);
    expect(f.calls.some(call => ['put', 'remove', 'complete'].includes(call.action))).toBe(false);
    expect(await f.engine.resolveSelected(choices)).toBe(true);
    expect(rows()).toEqual([]);
    expect(await digestCloudBlob(f.local.get(image)!.blob)).toBe(await digestCloudBlob(imageBlob(side)));
    expect(await digestCloudBlob([...f.remote.values()].find(item => item.name === image)!.blob)).toBe(await digestCloudBlob(imageBlob(side)));
  });
  it.each(['local', 'cloud'] as const)('changes just one record reference and keeps the identical shared screenshot on both sides (%s)', async side => {
    const f = fixture(), key = 'record:selected', other = 'record:other', image = 'image:' + crypto.randomUUID();
    for (const root of [key, other]) f.local.set(root, { kind: 'history', dependencies: [image], blob: recordBlob(root, 'initial', [image]) });
    const img = packCloudItem(image, 'same bytes', { id: image.slice(6), preview: 'data:image/png;base64,YQ==' });
    f.local.set(image, { kind: 'history', blob: img });
    await f.enable('history');
    const localImages = side === 'local' ? [] : [image], cloudImages = side === 'cloud' ? [] : [image];
    f.local.set(key, { kind: 'history', dependencies: localImages, blob: recordBlob(key, 'local edit', localImages) });
    await publishBlob(f, key, recordBlob(key, 'cloud edit', cloudImages));
    await f.engine.request();
    expect(await f.engine.resolveSelected([{ key, side, version: f.view.marks[key].groupVersion! }])).toBe(true);
    expect(f.local.get(key)!.dependencies).toEqual([]);
    expect(f.local.get(other)!.dependencies).toEqual([image]);
    expect(await digestCloudBlob(f.local.get(image)!.blob)).toBe(await digestCloudBlob(img));
    expect([...f.remote.values()].some(item => item.name === image)).toBe(true);
  });
  it.each(['local', 'cloud'] as const)('keeps the %s profile and résumé as a single selection when only the résumé conflicts', async side => {
    const f = fixture(), root = 'profile:main', cv = 'resume:main';
    f.put(root, 'profile', 'profile');
    f.put(cv, 'profile', 'résumé');
    await f.enable('profile');
    f.put(cv, 'profile', 'local résumé');
    await publishBlob(f, cv, new Blob(['cloud résumé']));
    await f.engine.request();
    const rows = () => syncItemsWithStatus(f.view.marks, 'conflict');
    expect(rows().map(([key]) => key)).toEqual([root]);
    const old = { key: root, side, version: rows()[0][1].conflictVersion! };
    f.put(root, 'profile', 'new local profile');
    expect(await f.engine.resolveSelected([old])).toBe(false);
    const version = rows()[0][1].conflictVersion!;
    expect(version).not.toBe(old.version);
    expect(await f.engine.resolveSelected([{ key: root, side, version }])).toBe(true);
    for (const [key, expected] of [[root, side === 'cloud' ? 'profile' : 'new local profile'], [cv, side + ' résumé']]) {
      expect(await f.local.get(key)!.blob.text()).toBe(expected);
      expect(await [...f.remote.values()].find(item => item.name === key)!.blob.text()).toBe(expected);
    }
    expect(rows()).toHaveLength(0);
  });
  it.each(['local', 'cloud'] as const)('applies a whole %s interview with distinct screenshot sets and leaves another record alone', async side => {
    const f = fixture(), root = 'record:one', other = 'record:other';
    const common = 'image:' + crypto.randomUUID(), left = 'image:' + crypto.randomUUID(), right = 'image:' + crypto.randomUUID();
    const image = (key: string, text: string) => packCloudItem(key, text, { id: key.slice(6), preview: 'data:image/png;base64,YQ==' });
    const putRecord = (key: string, title: string, dependencies: string[]) => f.local.set(key, {
      kind: 'history', blob: recordBlob(key, title, dependencies), dependencies });
    putRecord(root, 'initial', [common]);
    putRecord(other, 'other', []);
    f.local.set(common, { kind: 'history', blob: image(common, 'initial') });
    await f.enable('history');
    putRecord(root, 'local record', [common, left]);
    f.local.set(common, { kind: 'history', blob: image(common, 'local') });
    f.local.set(left, { kind: 'history', blob: image(left, 'local only') });
    await publishBlob(f, common, image(common, 'cloud'));
    await publishBlob(f, right, image(right, 'cloud only'));
    await publishBlob(f, root, recordBlob(root, 'cloud record', [common, right]));
    putRecord(other, 'other local', []);
    await publishBlob(f, other, recordBlob(other, 'other cloud', []));
    await f.engine.request();
    const rows = () => syncItemsWithStatus(f.view.marks, 'conflict').map(([key]) => key).sort();
    expect(rows()).toEqual([root, other].sort());
    expect(f.local.has(right)).toBe(false);
    expect([...f.remote.values()].some(item => item.name === left)).toBe(false);
    const choice = () => ({ key: root, side, version: f.view.marks[root].groupVersion! });
    const remove = f.ports.removeLocal;
    f.ports.removeLocal = async (...args) => { if (args[0] === left) throw Error('temporary failure'); await remove(...args); };
    f.setHook(async call => call.action === 'remove' && f.remote.get(call.id)?.name === right
      ? { ok: false, status: 403, error: 'temporary failure' } : undefined);
    expect(await f.engine.resolveSelected([choice()])).toBe(false);
    expect(Object.keys(f.saved.pendingGroups?.[root] ?? {})).toContain(side === 'cloud' ? left : right);
    f.ports.removeLocal = remove;
    f.setHook(undefined);
    f.restart();
    await f.engine.request();
    expect(await f.engine.resolveSelected([choice()])).toBe(true);
    expect(rows()).toEqual([other]);
    const winner = side === 'local' ? left : right, loser = side === 'local' ? right : left;
    expect(f.local.has(winner)).toBe(true);
    expect(f.local.has(loser)).toBe(false);
    expect([...f.remote.values()].some(item => item.name === winner)).toBe(true);
    expect([...f.remote.values()].some(item => item.name === loser)).toBe(false);
    expect(await digestCloudBlob(f.local.get(root)!.blob)).toBe(await digestCloudBlob(recordBlob(root, side + ' record', [common, winner])));
    expect(await digestCloudBlob(f.local.get(other)!.blob)).toBe(await digestCloudBlob(recordBlob(other, 'other local', [])));
  });
  it('retires a saved decision on restart for an identical screenshot-free interview and preserves screenshot cleanup', async () => {
    const f = fixture(), done = 'record:done', attached = 'record:attached', orphaned = 'record:orphaned';
    const image = 'image:' + crypto.randomUUID(), orphan = 'image:' + crypto.randomUUID();
    for (const key of [done, attached, orphaned]) {
      const dependencies = key === attached ? [image] : [];
      f.local.set(key, { kind: 'history', blob: recordBlob(key, 'interview', dependencies), dependencies });
    }
    f.put(image, 'history', 'attached screenshot');
    await f.enable('history');
    await f.persist({ ...f.saved, pendingGroups: { [done]: {}, [attached]: {}, [orphaned]: { [orphan]: null } } });
    f.restart();
    f.calls.length = 0;
    await f.engine.request();
    expect(f.view.marks[done].status).toBe('synced');
    expect(syncItemsWithStatus(f.view.marks, 'conflict').map(([key]) => key).sort()).toEqual([attached, orphaned]);
    expect(f.saved.pendingGroups).toEqual({ [attached]: {}, [orphaned]: { [orphan]: null } });
    expect(f.applied).toEqual([]);
    expect(f.calls.every(call => call.action === 'list')).toBe(true);
  });
  it('names a locally deleted library from its current cloud version', async () => {
    const f = fixture(), key = 'base:review';
    const content = (name: string) => packCloudItem(key, JSON.stringify({ id: 'review', name, createdAt: 1 }));
    f.local.set(key, { kind: 'knowledgebase', blob: content('旧库名') });
    await f.enable('knowledgebase');
    f.local.delete(key);
    const remote = [...f.remote.values()][0];
    for (const name of ['云端资料', '修改后的库名']) {
      remote.headVersion = crypto.randomUUID();
      remote.revision++;
      remote.blob = content(name);
      remote.bytes = remote.blob.size;
      remote.sha256 = await digestCloudBlob(remote.blob);
      await f.engine.request();
      expect(f.view.marks[key]).toMatchObject({ status: 'conflict', groupName: name,
        groupPresence: { local: false, cloud: true } });
    }
    const reads = f.calls.filter(call => call.action === 'read').length;
    await f.engine.request();
    expect(f.calls.filter(call => call.action === 'read')).toHaveLength(reads);
  });
  it('rechecks an old image after pending remote records, including a failed restore and restart', async () => {
    const f = fixture(), id = crypto.randomUUID(), image = 'image:' + id, record = 'record:next';
    f.put(image, 'history', 'synthetic image bytes');
    await f.enable('history');
    const stored = [...f.remote.values()].find(r => r.name === image)!;
    f.local.delete(image);
    const bytes = recordBlob(record, 'next', [image]);
    const remoteId = crypto.randomUUID();
    f.remote.set(remoteId, { ...stored, id: remoteId, name: record, headVersion: crypto.randomUUID(),
      blob: bytes, bytes: bytes.size, sha256: await digestCloudBlob(bytes) });
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
      expect(await f.engine.resolveSelected([{ key, side: 'cloud', version: f.view.marks[key].groupVersion! }])).toBe(true);
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
      removeLocal: async () => { throw Error('No removal expected'); },
      removeLocalLibrary: async () => { throw Error('No removal expected'); },
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
  it('retains screenshots newly referenced by another cloud interview when deleting one cloud copy', async () => {
    const f = fixture(), shared = 'image:common', sole = 'image:only';
    for (const key of [shared, sole]) f.put(key, 'history', key);
    f.local.set('record:a', { kind: 'history', blob: recordBlob('record:a', 'A', [shared, sole]), dependencies: [shared, sole] });
    await f.enable('history');
    await publishBlob(f, 'record:b', recordBlob('record:b', 'B', [shared]));
    await f.engine.removeCloud('record:a');
    expect([...f.remote.values()].map(row => row.name).sort()).toEqual([shared, 'record:b']);
    expect(f.saved.baselines[shared]?.suppressed).toBeFalsy();
    expect(f.local.has(sole)).toBe(true);
  });
  it('keeps every screenshot when removing the cloud record fails and resumes orphan cleanup after a restart', async () => {
    const f = fixture(), key = 'record:a', images = ['image:one', 'image:two'];
    await publishBlob(f, key, recordBlob(key, 'A', images));
    for (const image of images) await publishBlob(f, image, new Blob([image]));
    const blocked = (target: string) => f.setHook(async c =>
      c.action === 'remove' && f.remote.get(c.id)?.name === target ? { ok: false, status: 503, error: 'try again' } : undefined);
    blocked(key);
    await expect(f.engine.removeCloud(key)).rejects.toThrow();
    expect([...f.remote.values()].map(item => item.name).sort()).toEqual([key, ...images].sort());
    f.restart();
    blocked(images[1]);
    await expect(f.engine.removeCloud(key)).rejects.toThrow();
    expect([...f.remote.values()].map(item => item.name)).toEqual([images[1]]);
    f.setHook(undefined);
    f.restart();
    await f.engine.removeCloud(key);
    expect(f.remote.size).toBe(0);
  });
  it.each(['local', 'cloud'] as const)('rechecks new %s screenshot owners after removing the cloud record', async side => {
    const f = fixture(), key = 'record:a', other = 'record:b', image = 'image:shared';
    await publishBlob(f, key, recordBlob(key, 'A', [image]));
    await publishBlob(f, image, new Blob(['screenshot']));
    f.setHook(async c => {
      if (c.action === 'remove' && f.remote.get(c.id)?.name === key) {
        const blob = recordBlob(other, 'B', [image]);
        if (side === 'local') f.local.set(other, { kind: 'history', dependencies: [image], blob });
        else await publishBlob(f, other, blob);
      }
      return undefined;
    });
    await f.engine.removeCloud(key);
    expect([...f.remote.values()].some(item => item.name === image)).toBe(true);
    expect(f.saved.baselines[image]?.suppressed).toBeFalsy();
  });
  it('releases a former parent suppression when another cloud record now owns the screenshot', async () => {
    const f = fixture(), key = 'record:a', other = 'record:b', image = 'image:shared';
    await publishBlob(f, key, recordBlob(key, 'A', [image]));
    await publishBlob(f, image, new Blob(['screenshot']));
    await f.engine.pause(key);
    expect(f.saved.baselines[image]).toMatchObject({ suppressed: true, parent: key });
    f.restart();
    await publishBlob(f, other, recordBlob(other, 'B', [image]));
    await f.engine.removeCloud(key);
    expect([...f.remote.values()].map(item => item.name).sort()).toEqual([image, other]);
    expect(f.saved.baselines[image]?.suppressed).toBeFalsy();
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
  it('discovers new cloud-only files in the selected library before deleting its cloud copy', async () => {
    const f = fixture();
    f.put('base:a', 'knowledgebase', 'Library A');
    await f.enable('knowledgebase');
    for (const base of ['a', 'b'])
      await publishBlob(f, 'file:' + base, packCloudItem('file:' + base, 'original', { id: base, baseId: base }));
    await f.engine.removeCloud('base:a');
    expect([...f.remote.values()].map(row => row.name)).toEqual(['file:b']);
    expect(f.local.has('base:a')).toBe(true);
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
  it('pins selected conflict versions, applies independent rows, and never writes a stale selection', async () => {
    const f = fixture();
    const parent = 'base:k', keys = ['file:a', 'file:b', 'file:c', 'file:d'];
    const content = (key: string, value: string) => key.startsWith('file:')
      ? packCloudItem(key, value, { id: key.slice(5), baseId: 'k' }) : new Blob([value]);
    const put = (key: string, value: string) => f.local.set(key, { kind: 'knowledgebase',
      parent: key === parent ? undefined : parent, blob: content(key, value) });
    const localText = async (key: string) => (await unpackCloudItem(key, f.local.get(key)!.blob)).payload.text();
    put(parent, 'Library');
    for (const key of keys) put(key, 'initial');
    await f.enable('knowledgebase');
    for (const remote of f.remote.values()) {
      if (remote.name === parent) continue;
      remote.blob = content(remote.name, 'cloud edit');
      remote.sha256 = await digestCloudBlob(remote.blob);
      remote.bytes = remote.blob.size;
      remote.revision++;
      put(remote.name, 'local edit');
    }
    await f.engine.request();
    expect(f.view.marks[parent]).toMatchObject({ status: 'conflict', itemStatus: 'synced' });
    const choices = keys.map((key, i) => ({ key, side: i === 0 ? 'local' as const : 'cloud' as const,
      version: f.view.marks[key].conflictVersion! }));
    expect(choices.every(choice => !!choice.version && f.view.marks[choice.key].status === 'conflict')).toBe(true);
    expect(await f.engine.resolveSelected([{ ...choices[0], key: parent }])).toBe(false);
    const updated = [...f.remote.values()].find(item => item.name === keys[1])!;
    updated.blob = content(updated.name, 'new cloud edit');
    updated.sha256 = await digestCloudBlob(updated.blob);
    updated.bytes = updated.blob.size;
    updated.revision++;
    const failed = [...f.remote.values()].find(item => item.name === keys[3])!;
    f.setHook(async c => c.action === 'read' && c.id === failed.id
      ? { ok: false, status: 404, error: 'synthetic missing version' } : undefined);
    expect(await f.engine.resolveSelected(choices)).toBe(false);
    expect(await localText(keys[1])).toBe('local edit');
    expect(await localText(keys[2])).toBe('cloud edit');
    expect(f.view.marks[keys[0]].status).toBe('synced');
    expect(f.view.marks[keys[1]].conflictVersion).not.toBe(choices[1].version);
    expect(f.view.marks[keys[3]]).toMatchObject({ status: 'conflict', conflictVersion: choices[3].version });
    expect(await localText(keys[3])).toBe('local edit');
    f.setHook(undefined);
    expect(await f.engine.resolveSelected([choices[3]])).toBe(true);
    expect(await localText(keys[3])).toBe('cloud edit');
    put(keys[1], 'more local edits');
    const next = { ...choices[1], version: f.view.marks[keys[1]].conflictVersion! };
    expect(await f.engine.resolveSelected([next])).toBe(false);
    expect(await localText(keys[1])).toBe('more local edits');
    expect(await f.engine.resolveSelected([{ ...next, version: f.view.marks[keys[1]].conflictVersion! }])).toBe(true);
    expect(await localText(keys[1])).toBe('new cloud edit');
    for (const key of [parent, keys[1]]) {
      put(key, 'local revision');
      const remote = [...f.remote.values()].find(item => item.name === key)!;
      remote.blob = content(remote.name, 'remote revision');
      remote.sha256 = await digestCloudBlob(remote.blob);
      remote.bytes = remote.blob.size;
      remote.revision++;
    }
    await f.engine.request();
    const direct = f.view.marks[parent];
    expect(direct.itemStatus).toBe('conflict');
    expect(direct.groupVersion).toBeTruthy();
    expect(await f.engine.resolveSelected([{ key: parent, side: 'local', version: direct.conflictVersion! }])).toBe(false);
    expect(f.view.marks[parent].itemStatus).toBe('conflict');
    expect(await localText(keys[1])).toBe('local revision');
  });
  it.each(['local', 'cloud'] as const)('retains the whole %s library including its exact file membership after a failed transfer and restart', async side => {
    const f = fixture();
    const blob = (key: string, root: string, value: string) => packCloudItem(key, value,
      key.startsWith('file:') ? { id: key.slice(5), baseId: root } : undefined);
    const local = (key: string, root: string, value: string) => f.local.set(key, {
      kind: 'knowledgebase', blob: blob(key, root, value), parent: key.startsWith('file:') ? 'base:' + root : undefined,
    });
    const cloud = async (key: string, root: string, value: string) => {
      const previous = [...f.remote.values()].find(entry => entry.name === key);
      const bytes = blob(key, root, value), id = previous?.id ?? crypto.randomUUID();
      f.remote.set(id, { id, name: key, kind: 'knowledgebase', revision: (previous?.revision ?? 0) + 1,
        headVersion: crypto.randomUUID(), bytes: bytes.size, sha256: await digestCloudBlob(bytes), createdAt: 1, blob: bytes });
    };
    for (const root of ['a', 'b', 'c']) local('base:' + root, root, root);
    local('file:z', 'a', 'first');
    await f.enable('knowledgebase');
    local('file:only-local', 'a', 'local');
    await cloud('file:only-cloud', 'a', 'cloud');
    local('file:z', 'a', 'local revision');
    await cloud('file:z', 'a', 'remote revision');
    local('file:b-local', 'b', 'unselected local');
    await cloud('file:b-cloud', 'b', 'unselected cloud');
    local('file:c', 'c', 'normal upload');
    await f.engine.request();
    const rows = () => syncItemsWithStatus(f.view.marks, 'conflict').map(([key]) => key).sort();
    const choice = () => ({ key: 'base:a', side, version: f.view.marks['base:a'].groupVersion! });
    const remoteNames = () => [...f.remote.values()].map(entry => entry.name);
    const old = choice();
    expect(rows()).toEqual(['base:a', 'base:b']);
    expect(remoteNames()).toContain('file:c');
    expect(remoteNames()).not.toContain('file:only-local');
    expect(f.local.has('file:only-cloud')).toBe(false);
    local('file:late', 'a', 'new member');
    expect(await f.engine.resolveSelected([old])).toBe(false);
    expect(choice().version).not.toBe(old.version);
    expect(remoteNames()).not.toContain('file:late');
    const removeLocal = f.ports.removeLocal;
    const removeBatch = f.ports.removeLocalLibrary;
    f.ports.removeLocalLibrary = async () => { throw Error('synthetic removal failure'); };
    f.ports.removeLocal = async (...args) => {
      if (args[0] === 'file:only-local') throw Error('synthetic removal failure');
      await removeLocal(...args);
    };
    f.setHook(async call => call.action === 'remove' && f.remote.get(call.id)?.name === 'file:only-cloud'
      ? { ok: false, status: 403, error: 'synthetic removal failure' } : undefined);
    expect(await f.engine.resolveSelected([choice()])).toBe(false);
    expect(f.saved.pendingLibraries).toEqual(['base:a']);
    f.setHook(undefined);
    f.ports.removeLocal = removeLocal;
    f.ports.removeLocalLibrary = removeBatch;
    f.restart();
    await f.engine.request();
    expect(rows()).toEqual(['base:a', 'base:b']);
    expect(await f.engine.resolveSelected([choice()])).toBe(true);
    expect(f.saved.pendingLibraries).toBeUndefined();
    expect(rows()).toEqual(['base:b']);
    for (const key of ['file:only-local', 'file:late', 'file:only-cloud']) {
      const keep = side === 'local' ? key !== 'file:only-cloud' : key === 'file:only-cloud';
      expect(f.local.has(key)).toBe(keep);
      expect(remoteNames().includes(key)).toBe(keep);
    }
    const remoteZ = [...f.remote.values()].find(entry => entry.name === 'file:z')!.blob;
    expect(await digestCloudBlob(remoteZ)).toBe(await digestCloudBlob(f.local.get('file:z')!.blob));
    expect(await (await unpackCloudItem('file:z', remoteZ)).payload.text()).toBe(side === 'local' ? 'local revision' : 'remote revision');
    expect(f.local.has('file:b-cloud')).toBe(false);
    expect(remoteNames()).not.toContain('file:b-local');
  });
  it('retires the pending decision on restart when a deleted library has no remaining local or cloud entries', async () => {
    const preferences = defaultSyncPreferences();
    preferences.enabled.knowledgebase = true;
    const f = fixture({ preferences, baselines: {}, pendingLibraries: ['base:gone'] });
    await f.engine.request();
    expect(f.saved.pendingLibraries).toBeUndefined();
    expect(f.view.marks['base:gone']).toBeUndefined();
    expect(f.calls.every(call => call.action === 'list')).toBe(true);
  });
  it.each(['edited', 'deleted', 'added'] as const)('stops before deleting losing files after cloud membership or an applied winner was %s', async change => {
    const f = fixture(), key = 'file:reviewed', root = 'base:a';
    const blob = (key: string, value: string) => packCloudItem(key, value, { id: key.slice(5), baseId: 'a' });
    f.put(root, 'knowledgebase', 'A');
    f.local.set(key, { kind: 'knowledgebase', parent: root, blob: blob(key, 'initial') });
    await f.enable('knowledgebase');
    const remote = [...f.remote.values()].find(entry => entry.name === key)!;
    const editRemote = async (value: string) => {
      remote.blob = blob(key, value);
      remote.sha256 = await digestCloudBlob(remote.blob);
      remote.bytes = remote.blob.size;
      remote.revision++;
      remote.headVersion = crypto.randomUUID();
    };
    await editRemote('reviewed winner');
    f.local.set(key, { kind: 'knowledgebase', parent: root, blob: blob(key, 'local') });
    f.local.set('file:spare', { kind: 'knowledgebase', parent: root, blob: blob('file:spare', 'preserve until confirmed') });
    await f.engine.request();
    const apply = f.ports.apply;
    f.ports.apply = async (...args) => {
      await apply(...args);
      if (args[0] !== key) return;
      if (change === 'edited') await editRemote('newer cloud winner');
      else if (change === 'deleted') f.remote.delete(remote.id);
      else {
        const k = 'file:new', b = blob(k, 'new cloud member'), id = crypto.randomUUID();
        f.remote.set(id, { ...remote, id, name: k, blob: b, bytes: b.size, sha256: await digestCloudBlob(b) });
      }
    };
    expect(await f.engine.resolveSelected([{ key: root, side: 'cloud', version: f.view.marks[root].groupVersion! }])).toBe(false);
    expect(f.local.has('file:spare')).toBe(true);
    expect(f.saved.pendingLibraries).toEqual([root]);
  });
  it.each(['cloud', 'local'] as const)('applies a deleted %s library to the other side, removing its children before the library', async side => {
    const f = fixture(), root = 'base:folder', key = 'file:child';
    const file = (value: string) => packCloudItem(key, value, { id: 'child', baseId: 'folder' });
    f.put(root, 'knowledgebase', 'folder');
    f.local.set(key, { kind: 'knowledgebase', parent: root, blob: file('child') });
    await f.enable('knowledgebase');
    if (side === 'cloud') {
      f.remote.clear();
      f.local.set(key, { kind: 'knowledgebase', parent: root, blob: file('local revision') });
    } else {
      f.local.clear();
      const child = [...f.remote.values()].find(item => item.name === key)!;
      child.blob = file('cloud revision');
      child.sha256 = await digestCloudBlob(child.blob);
      child.bytes = child.blob.size;
      child.headVersion = crypto.randomUUID();
      child.revision++;
    }
    await f.engine.request();
    const removed: string[] = [], removeLocal = f.ports.removeLocal;
    f.ports.removeLocal = async (...args) => { removed.push(args[0]); await removeLocal(...args); };
    const removeBatch = f.ports.removeLocalLibrary;
    f.ports.removeLocalLibrary = async (...args) => {
      await removeBatch(...args);
      removed.push(...args[2].filter(key => key !== root), root);
    };
    f.setHook(async call => { if (call.action === 'remove') removed.push(f.remote.get(call.id)!.name); return undefined; });
    expect(await f.engine.resolveSelected([{ key: root, side, version: f.view.marks[root].groupVersion! }])).toBe(true);
    expect(removed).toEqual([key, root]);
    expect(f.local.size).toBe(0);
    expect(f.remote.size).toBe(0);
    expect(f.saved.baselines).toEqual({});
    expect(f.saved.pendingLibraries).toBeUndefined();
  });
  it('checks an individual file shortcut against a newly moved cloud head without moving the local original', async () => {
    const f = fixture(), key = 'file:doc', root = 'base:a';
    const file = (baseId: string, value: string) => packCloudItem(key, value, { id: 'doc', baseId });
    for (const base of [root, 'base:b']) f.put(base, 'knowledgebase', base);
    f.local.set(key, { kind: 'knowledgebase', parent: root, blob: file('a', 'original') });
    await f.enable('knowledgebase');
    const remote = [...f.remote.values()].find(entry => entry.name === key)!;
    async function publish(baseId: string) {
      remote.blob = file(baseId, 'cloud edit');
      remote.sha256 = await digestCloudBlob(remote.blob);
      remote.bytes = remote.blob.size;
      remote.headVersion = crypto.randomUUID();
      remote.revision++;
    }
    await publish('a');
    f.local.set(key, { kind: 'knowledgebase', parent: root, blob: file('a', 'local edit') });
    await f.engine.request();
    const version = f.view.marks[key].conflictVersion!;
    expect(version).toBeTruthy();
    await publish('b');
    f.calls.length = 0;
    for (const side of ['cloud', 'local'] as const) expect(await f.engine.resolveSelected([{ key, side, version }])).toBe(false);
    expect(f.applied).toEqual([]);
    expect(f.calls.filter(c => ['create', 'begin', 'put', 'complete', 'remove'].includes(c.action))).toEqual([]);
    expect((await unpackCloudItem(key, f.local.get(key)!.blob)).metadata.baseId).toBe('a');
  });
  it('rejects the entire local removal transaction if cloud absence changes while preparing it', async () => {
    const f = fixture(), root = 'base:a';
    f.put(root, 'knowledgebase', 'old');
    await f.enable('knowledgebase');
    const remote = [...f.remote.values()][0];
    remote.blob = new Blob(['new cloud folder']);
    remote.sha256 = await digestCloudBlob(remote.blob);
    remote.bytes = remote.blob.size;
    remote.revision++;
    remote.headVersion = crypto.randomUUID();
    for (const key of ['file:x', 'file:y']) f.local.set(key, { kind: 'knowledgebase', parent: root,
      blob: packCloudItem(key, 'local original', { id: key.slice(5), baseId: 'a' }) });
    await f.engine.request();
    const removeBatch = f.ports.removeLocalLibrary;
    f.ports.removeLocalLibrary = async (...args) => {
      const id = crypto.randomUUID(), blob = packCloudItem('file:y', 'cloud restored', { id: 'y', baseId: 'a' });
      f.remote.set(id, { ...remote, id, name: 'file:y', blob, bytes: blob.size, sha256: await digestCloudBlob(blob) });
      await removeBatch(...args);
    };
    const reviewed = f.view.marks[root].groupVersion!;
    expect(await f.engine.resolveSelected([{ key: root, side: 'cloud', version: reviewed }])).toBe(false);
    expect(f.view.marks[root].groupVersion).toBeTruthy();
    expect(f.view.marks[root].groupVersion).not.toBe(reviewed);
    expect(f.local.has('file:x')).toBe(true);
    expect(await (await unpackCloudItem('file:y', f.local.get('file:y')!.blob)).payload.text()).toBe('local original');
  });
  it('keeps reviewed local originals when library sync is disabled and re-enabled before removal commits', async () => {
    const f = fixture(), root = 'base:folder', key = 'file:child';
    const original = (text: string) => packCloudItem(key, text, { id: 'child', baseId: 'folder' });
    f.put(root, 'knowledgebase', 'folder');
    f.local.set(key, { kind: 'knowledgebase', parent: root, blob: original('first') });
    await f.enable('knowledgebase');
    f.remote.clear();
    f.local.set(key, { kind: 'knowledgebase', parent: root, blob: original('edited') });
    await f.engine.request();
    const enabled = structuredClone(f.view.preferences);
    const removeBatch = f.ports.removeLocalLibrary;
    f.ports.removeLocalLibrary = async (...args) => {
      await f.engine.configure(defaultSyncPreferences());
      await f.engine.configure(enabled);
      await removeBatch(...args);
    };
    expect(await f.engine.resolveSelected([{ key: root, side: 'cloud', version: f.view.marks[root].groupVersion! }])).toBe(false);
    await f.engine.idle();
    expect(f.local.has(root)).toBe(true);
    expect(await (await unpackCloudItem(key, f.local.get(key)!.blob)).payload.text()).toBe('edited');
    expect(f.saved.pendingLibraries).toEqual([root]);
  });
  it('bounds full account listings for a hundred losing files in a thousand-resource account', async () => {
    const f = fixture(), root = 'base:a';
    f.put(root, 'knowledgebase', 'initial');
    await f.enable('knowledgebase');
    const remote = [...f.remote.values()][0];
    remote.blob = new Blob(['new cloud folder']);
    remote.sha256 = await digestCloudBlob(remote.blob);
    remote.bytes = remote.blob.size;
    remote.revision++;
    remote.headVersion = crypto.randomUUID();
    for (let i = 0; i < 999; i++) {
      const id = crypto.randomUUID();
      f.remote.set(id, { ...remote, id, name: 'record:unrelated' + i, kind: 'history' });
    }
    for (let i = 0; i < 100; i++) f.put('file:local' + i, 'knowledgebase', 'original', root);
    await f.engine.request();
    f.calls.length = 0;
    expect(await f.engine.resolveSelected([{ key: root, side: 'cloud', version: f.view.marks[root].groupVersion! }])).toBe(true);
    expect([...f.local.keys()]).toEqual([root]);
    expect(f.remote.size).toBe(1000);
    expect(f.calls.filter(call => call.action === 'list')).toHaveLength(4 * 20);
  });
  it('freezes both library scopes on a concurrent cloud move before either library can auto-merge', async () => {
    const f = fixture(), key = 'file:shared';
    for (const root of ['base:a', 'base:b']) f.put(root, 'knowledgebase', root);
    const original = packCloudItem(key, 'local and cloud original', { id: 'shared', baseId: 'a' });
    f.local.set(key, { kind: 'knowledgebase', parent: 'base:a', blob: original });
    await f.enable('knowledgebase');
    const remote = [...f.remote.values()].find(entry => entry.name === key)!;
    remote.blob = packCloudItem(key, 'cloud edit', { id: 'shared', baseId: 'b' });
    remote.sha256 = await digestCloudBlob(remote.blob);
    remote.bytes = remote.blob.size;
    remote.headVersion = crypto.randomUUID();
    remote.revision++;
    f.put('file:b-local', 'knowledgebase', 'local edit in B', 'base:b');
    f.calls.length = 0;
    await f.engine.request();
    expect(f.applied).toEqual([]);
    expect(f.calls.filter(c => ['create', 'begin', 'put', 'complete', 'remove'].includes(c.action))).toEqual([]);
    expect(f.local.get(key)!.blob).toBe(original);
    expect(f.view.marks['base:a'].error).toBeTruthy();
    expect(f.view.marks['base:b'].error).toBeTruthy();
  });
  it.each(['known baseline', 'legacy missing parent', 'changed cloud head', 'paused member'] as const)(
    'rejects an entire library choice before any mutation when a file has a protected or mismatched scope (%s)', async scenario => {
      const f = fixture(), key = 'file:shared';
      const packed = (parent: string) => packCloudItem(key, 'content', { id: 'shared', baseId: parent });
      for (const id of ['a', 'b']) f.put('base:' + id, 'knowledgebase', id);
      f.local.set(key, { kind: 'knowledgebase', parent: 'base:a', blob: packed('a') });
      await f.enable('knowledgebase');
      if (scenario === 'paused member') await f.engine.pause(key);
      else if (scenario === 'changed cloud head') {
        const remote = [...f.remote.values()].find(item => item.name === key)!;
        remote.blob = packed('b');
        remote.sha256 = await digestCloudBlob(remote.blob);
        remote.bytes = remote.blob.size;
        remote.headVersion = crypto.randomUUID();
        remote.revision++;
      } else {
        if (scenario === 'legacy missing parent') delete f.saved.baselines[key].parent;
        f.local.set(key, { kind: 'knowledgebase', parent: 'base:b', blob: packed('b') });
      }
      for (const remote of f.remote.values()) {
        if (!remote.name.startsWith('base:')) continue;
        remote.blob = new Blob(['remote']);
        remote.sha256 = await digestCloudBlob(remote.blob);
        remote.bytes = remote.blob.size;
        remote.headVersion = crypto.randomUUID();
        remote.revision++;
        f.put(remote.name, 'knowledgebase', 'local');
      }
      f.restart();
      f.calls.length = 0;
      await f.engine.request();
      const file = [...f.remote.values()].find(entry => entry.name === key)!;
      if (scenario === 'legacy missing parent') expect(f.calls.some(c => c.action === 'read' && c.id === file.id)).toBe(true);
      f.calls.length = 0;
      for (const root of scenario === 'paused member' ? ['base:a'] : ['base:a', 'base:b'])
        for (const side of ['local', 'cloud'] as const) {
          const version = f.view.marks[root].groupVersion!;
          expect(version).toBeTruthy();
          expect(await f.engine.resolveSelected([{ key: root, side, version }])).toBe(false);
        }
      expect(f.applied).toEqual([]);
      expect(f.calls.filter(c => ['create', 'begin', 'put', 'complete', 'remove'].includes(c.action))).toEqual([]);
      expect((await unpackCloudItem(key, file.blob)).metadata.baseId).toBe(scenario === 'changed cloud head' ? 'b' : 'a');
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
    expect(await f.engine.resolveSelected([{
      key: 'profile:main', side: 'cloud', version: f.view.marks['profile:main'].groupVersion!,
    }])).toBe(true);
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
