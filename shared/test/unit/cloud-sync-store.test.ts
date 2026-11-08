import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { useCloudSync } from '../../src/stores/cloudSync';
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
