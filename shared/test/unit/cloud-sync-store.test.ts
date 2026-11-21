import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { translateUI } from '../../electron/contracts/uiLanguage';
import { useCloudSync, readAccountSyncSaved } from '../../src/stores/cloudSync';
import { useCloudAccount } from '../../src/stores/cloudAccount';
import { useKnowledgeIndex } from '../../src/stores/knowledgeIndex';
import { defaultSyncPreferences } from '../../src/services/cloudSync';
import { digestCloudBlob, packCloudItem } from '../../src/services/cloudData';
import { localKnowledge } from '../../src/services/knowledge';
import type {
  CloudSyncCall,
  CloudResource,
  CloudSyncResult,
} from '../../electron/contracts/cloudSync';
import type { KnowledgeCall } from '../../electron/contracts/knowledge';

afterEach(() => vi.unstubAllGlobals());

it('preserves the local migration error for display in the selected language', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const saved = new Map([['voxcue-moved-from-device-v1:' + userId, '{}']]);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { desktop: { cloudSync: vi.fn() } }));
  const disconnect = useCloudSync.getState().connect(userId);
  try {
    await vi.waitFor(() => expect(useCloudSync.getState().error).toBe('本机迁移记录无效，请检查本地资料。'));
    expect(translateUI(useCloudSync.getState().error!, 'en')).toBe('The local migration record is invalid. Check your local data.');
  } finally {
    disconnect();
  }
});

it.each(['sequential', 'concurrent'])('快速配置不同同步分类时保留此前设置，即使传输状态仍在合并发布 (%s)', async (mode) => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const values = new Map<string, string>();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const empty = {
    ok: true as const,
    value: {
      items: [], nextCursor: null,
      storage: {
        currentBytes: { profile: 0, history: 0, knowledgebase: 0 },
        reservedBytes: { profile: 0, history: 0, knowledgebase: 0 },
        storedBytes: { profile: 0, history: 0, knowledgebase: 0 },
        capacityBytes: 100000000, knowledgeCapacityBytes: 100000000,
      },
    },
  };
  let release: ((result: CloudSyncResult) => void) | undefined;
  const cloudSync = vi.fn(async (call: CloudSyncCall): Promise<CloudSyncResult> => {
    if (call.action === 'cancel') return { ok: true, value: { cancelled: true } };
    if (!release) return new Promise((resolve) => { release = resolve; });
    return empty;
  });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { desktop: { cloudSync } }));
  // Keep IndexedDB's real immediate tasks; hold only the 16ms view coalescing clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const disconnect = useCloudSync.getState().connect(userId);
  try {
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const operations: Promise<void>[] = [];
    for (const kind of ['profile', 'history', 'knowledgebase'] as const) {
      const operation = useCloudSync.getState().configure(kind, true);
      if (mode === 'sequential') await operation;
      else operations.push(operation);
    }
    await Promise.all(operations);
    expect(useCloudSync.getState().preferences.enabled).toEqual({
      profile: true, history: true, knowledgebase: true,
    });
    expect((await readAccountSyncSaved(userId)).preferences.enabled).toEqual({
      profile: true, history: true, knowledgebase: true,
    });
    await vi.advanceTimersByTimeAsync(16);
    expect(useCloudSync.getState().preferences.enabled).toEqual({
      profile: true, history: true, knowledgebase: true,
    });
    release!(empty);
    await useCloudSync.getState().refresh();
    expect(useCloudSync.getState().preferences.enabled).toEqual({
      profile: true, history: true, knowledgebase: true,
    });
  } finally {
    release?.(empty);
    await useCloudSync.getState().suspend();
    disconnect();
    vi.useRealTimers();
  }
});

it('suspending before local sync settings load prevents a late worker from starting', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'voxcue-sync-owner' ? userId : null });
  const cloudSync = vi.fn();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { desktop: { cloudSync } }));
  const disconnect = useCloudSync.getState().connect(userId);
  try {
    await useCloudSync.getState().suspend();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(cloudSync).not.toHaveBeenCalled();
    expect(useCloudSync.getState().busy).toBe(false);
  } finally {
    disconnect();
  }
});

it('a settings-load failure after suspension cannot replace the current notice or readiness', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const request = {} as IDBOpenDBRequest;
  vi.stubGlobal('indexedDB', { open: () => request });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { desktop: { cloudSync: vi.fn() } }));
  const disconnect = useCloudSync.getState().connect(userId);
  try {
    await useCloudSync.getState().suspend();
    useCloudSync.setState({ error: 'current notice', ready: false });
    request.onerror!.call(request, new Event('error'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useCloudSync.getState()).toMatchObject({
      error: 'current notice',
      ready: false,
      busy: false,
    });
    expect(window.desktop!.cloudSync).not.toHaveBeenCalled();
  } finally {
    disconnect();
  }
});

it('logout cancels its active sync generation before clearing the account and does not publish a late busy view', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'voxcue-sync-owner' ? userId : null });
  let release: ((result: CloudSyncResult) => void) | undefined;
  let activeSyncId: string | undefined;
  let retired = false;
  const cloudSync = vi.fn(async (call: CloudSyncCall): Promise<CloudSyncResult> => {
    if (call.action === 'cancel') {
      expect(call.userId).toBe(userId);
      expect(call.syncId).toBe(activeSyncId);
      release!({ ok: false, status: 0, error: 'synthetic cancellation' });
      retired = true;
      return { ok: true, value: { cancelled: true } };
    }
    expect(call.action).toBe('list');
    activeSyncId = call.syncId;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const cloudAccount = vi.fn(async () => {
    expect(retired).toBe(true);
    return { ok: true, state: { configured: true, verified: false, user: null } };
  });
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { desktop: { cloudSync, cloudAccount } }),
  );
  const disconnect = useCloudSync.getState().connect(userId);
  try {
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect((await useCloudAccount.getState().call({ action: 'logout' })).ok).toBe(true);
    expect(cloudAccount).toHaveBeenCalledTimes(1);
    expect(useCloudSync.getState().busy).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(useCloudSync.getState().busy).toBe(false);
    expect(cloudSync.mock.calls.map(([call]) => call.action)).toEqual(['list', 'cancel']);
  } finally {
    disconnect();
  }
});

for (const fails of [false, true])
  it(`cloud originals automatically enter the index queue; index ${fails ? 'failure preserves downloads' : 'work does not block downloads'}`, async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const values = new Map([['voxcue-sync-owner', userId]]);
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const blobs = new Map([
      [
        'base:base',
        packCloudItem('base:base', JSON.stringify({ id: 'base', name: 'Synthetic', createdAt: 1 })),
      ],
      ...['one', 'two'].map(
        (id) =>
          [
            'file:' + id,
            packCloudItem('file:' + id, 'content', {
              id,
              baseId: 'base',
              name: id + '.txt',
              size: 7,
              type: 'text/plain',
              createdAt: 1,
            }),
          ] as const,
      ),
      [
        'resume:main',
        packCloudItem('resume:main', 'content', {
          id: 'resume',
          baseId: 'personal-resume',
          name: 'resume.txt',
          size: 7,
          type: 'text/plain',
          createdAt: 1,
        }),
      ],
    ]);
    const remote: CloudResource[] = await Promise.all(
      [...blobs].map(async ([name, blob]) => ({
        id: crypto.randomUUID(),
        name,
        kind: name.startsWith('resume:') ? 'profile' : 'knowledgebase',
        revision: 1,
        headVersion: crypto.randomUUID(),
        bytes: blob.size,
        sha256: await digestCloudBlob(blob),
        createdAt: 1,
      })),
    );
    let release!: () => void;
    const indexing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const knowledge = vi.fn(async (call: KnowledgeCall) => {
      if (call.op === 'import') {
        // Every import must see a committed original, including background restores.
        const saved = (await localKnowledge.listDocuments(call.baseId)).find(
          (doc) => doc.id === call.documentId,
        );
        expect(await saved!.blob.text()).toBe('content');
        await indexing;
        return fails
          ? { ok: false, error: 'synthetic index failure' }
          : { ok: true, value: undefined };
      }
      return { ok: true, value: { documents: [], tasks: [], modelReady: true } };
    });
    const counts = { profile: 0, history: 0, knowledgebase: 0 };
    const cloudSync = vi.fn(async (call: CloudSyncCall) => {
      if (call.action === 'cancel') return { ok: true, value: { cancelled: true } };
      if (call.action === 'list')
        return {
          ok: true,
          value: {
            items: remote,
            nextCursor: null,
            storage: {
              currentBytes: counts,
              reservedBytes: counts,
              storedBytes: counts,
              capacityBytes: 100000000,
              knowledgeCapacityBytes: 100000000,
            },
          },
        };
      const item = remote.find((resource) => resource.id === call.id)!;
      const blob = blobs.get(item.name)!;
      if (call.action === 'manifest')
        return {
          ok: true,
          value: {
            bytes: blob.size,
            sha256: item.sha256,
            chunkBytes: 1048576,
            parts: [{ index: 0, bytes: blob.size, sha256: item.sha256 }],
          },
        };
      if (call.action === 'read')
        return { ok: true, value: new Uint8Array(await blob.arrayBuffer()) };
      throw Error('Unexpected cloud write: ' + call.action);
    });
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), { desktop: { cloudSync, knowledge } }),
    );
    const preferences = defaultSyncPreferences();
    preferences.enabled.profile = preferences.enabled.knowledgebase = true;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('voxcue-cloud-sync', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('accounts');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('accounts', 'readwrite');
        tx.objectStore('accounts').put({ preferences, baselines: {} }, userId);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    useKnowledgeIndex.setState({ state: null, tasks: {}, requests: {}, error: null });
    const disconnect = useCloudSync.getState().connect(userId);
    try {
      await vi.waitFor(() => {
        expect(useCloudSync.getState().marks['base:base']?.status).toBe('synced');
        expect(useCloudSync.getState().busy).toBe(false);
        expect(knowledge.mock.calls.filter(([call]) => call.op === 'import')).toHaveLength(1);
        expect(Object.keys(useKnowledgeIndex.getState().requests)).toHaveLength(3);
      });
      expect(Object.keys(useKnowledgeIndex.getState().requests).sort()).toEqual([
        'one',
        'resume',
        'two',
      ]);
      release();
      await vi.waitFor(() => expect(useKnowledgeIndex.getState().requests).toEqual({}));
      expect(knowledge.mock.calls.filter(([call]) => call.op === 'import')).toHaveLength(3);
      expect((await localKnowledge.listDocuments('base')).length).toBe(2);
      expect(useCloudSync.getState().marks['base:base'].status).toBe('synced');
      if (fails) {
        await useKnowledgeIndex.getState().reconcile('base');
        expect(knowledge.mock.calls.filter(([call]) => call.op === 'import')).toHaveLength(3);
      }
      expect(
        cloudSync.mock.calls.every(([call]) => ['list', 'manifest', 'read'].includes(call.action)),
      ).toBe(true);
    } finally {
      release();
      await useCloudSync.getState().suspend();
      disconnect();
      await vi.waitFor(() => expect(useKnowledgeIndex.getState().requests).toEqual({}));
    }
  });

for (const action of ['pause', 'remove'] as const)
  for (const reconnect of [false, true])
    for (const unauthorized of [false, true])
      it(`${action} 的旧响应在${reconnect ? '切换账号' : '断开'}后不回填错误或触发新账号过期 (${unauthorized ? '401' : 'success'})`, async () => {
        const firstUser = '11111111-1111-4111-8111-111111111111';
        const nextUser = '22222222-2222-4222-8222-222222222222';
        const values = new Map([['voxcue-sync-owner', firstUser]]);
        vi.stubGlobal('indexedDB', new IDBFactory());
        vi.stubGlobal('localStorage', {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        });
        const counts = { profile: 0, history: 0, knowledgebase: 0 };
        const listed: CloudSyncResult = {
          ok: true,
          value: {
            items: [],
            nextCursor: null,
            storage: {
              currentBytes: counts,
              reservedBytes: counts,
              storedBytes: counts,
              capacityBytes: 100000000,
              knowledgeCapacityBytes: 100000000,
            },
          },
        };
        let hold = false;
        let release: (() => void) | undefined;
        const cloudSync = vi.fn(async (call: CloudSyncCall): Promise<CloudSyncResult> => {
          if (call.action === 'cancel') return { ok: true, value: { cancelled: true } };
          expect(call.action).toBe('list');
          if (hold && call.userId === firstUser) {
            hold = false;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            if (unauthorized) return { ok: false, status: 401, error: 'old account expired' };
          }
          return listed;
        });
        const view = Object.assign(new EventTarget(), { desktop: { cloudSync } });
        const expired = vi.fn();
        view.addEventListener('voxcue-cloud-expired', expired);
        vi.stubGlobal('window', view);
        let disconnect = useCloudSync.getState().connect(firstUser);
        const settled = () =>
          vi.waitFor(() => {
            expect(useCloudSync.getState().ready).toBe(true);
            expect(useCloudSync.getState().busy).toBe(false);
          });
        const control = () =>
          action === 'pause'
            ? useCloudSync.getState().pause('base:synthetic')
            : useCloudSync.getState().remove('base:synthetic');
        let pending: ReturnType<typeof control> | undefined;
        try {
          await settled();
          hold = true;
          pending = control();
          await vi.waitFor(() => expect(release).toBeTypeOf('function'));
          disconnect();
          if (reconnect) {
            values.set('voxcue-sync-owner', nextUser);
            disconnect = useCloudSync.getState().connect(nextUser);
            await settled();
          }
          useCloudSync.setState({ error: 'current account notice' });
          release!();
          await pending;
          expect(useCloudSync.getState().error).toBe('current account notice');
          expect(expired).not.toHaveBeenCalled();
          if (reconnect) {
            cloudSync.mockRejectedValueOnce(Error('current control failure'));
            await control();
            expect(useCloudSync.getState().error).toBe('current control failure');
          }
        } finally {
          release?.();
          await pending;
          await useCloudSync.getState().suspend();
          disconnect();
        }
      });
