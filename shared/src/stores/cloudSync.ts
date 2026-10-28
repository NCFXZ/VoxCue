import { create } from 'zustand';
import type { SyncKind } from '../../electron/contracts/cloudSync';
import { KNOWLEDGE_MAX_BYTES } from '../../electron/contracts/cloudSync';
import {
  CloudSyncEngine,
  defaultSyncPreferences,
  readSyncSaved,
  type SyncSaved,
  type SyncView,
} from '../services/cloudSync';
import { applyCloudItem, localCloudItems } from '../services/cloudData';
import { registerCloudShutdown } from '../services/cloudLifecycle';
import { useKnowledgeIndex } from './knowledgeIndex';

interface SyncStore extends SyncView {
  ready: boolean;
  suspend(): Promise<void>;
  connect(userId: string): () => void;
  configure(kind: SyncKind, enabled: boolean): Promise<void>;
  refresh(): Promise<void>;
  refreshStorage(): Promise<void>;
  remove(key: string): Promise<boolean>;
  pause(key: string): Promise<void>;
  resume(key: string): Promise<void>;
  resolve(key: string, choice: 'local' | 'cloud'): Promise<void>;
}
async function syncDatabase<T>(userId: string, value?: SyncSaved): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('voxcue-cloud-sync', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('accounts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(Error('无法打开同步状态存储。'));
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('accounts', value ? 'readwrite' : 'readonly');
    const request = value
      ? tx.objectStore('accounts').put(value, userId)
      : tx.objectStore('accounts').get(userId);
    tx.oncomplete = () => {
      db.close();
      resolve(request.result as T);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(Error('同步状态保存失败，请检查本地空间。'));
    };
  });
}
let engine: CloudSyncEngine | undefined;
let generation = 0;
let activeUserId: string | undefined;
export const useCloudSync = create<SyncStore>((set, get) => {
  async function perform(work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '同步操作失败。' });
    }
  }
  return {
    preferences: defaultSyncPreferences(),
    marks: {},
    busy: false,
    ready: false,
    async suspend() {
      engine?.stop();
      await engine?.idle();
    },
    connect(userId) {
      const epoch = ++generation;
      engine?.stop();
      engine = undefined;
      activeUserId = userId;
      const unregister = registerCloudShutdown(() => get().suspend());
      set({
        preferences: defaultSyncPreferences(),
        marks: {},
        busy: false,
        ready: false,
        storage: undefined,
        error: undefined,
      });
      let debounce: ReturnType<typeof setTimeout>;
      const changed = (event: Event) => {
        const kind = (event as CustomEvent).detail;
        if (['profile', 'history', 'knowledgebase'].includes(kind)) engine?.dirty(kind);
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          void engine?.request();
        }, 750);
      };
      const poll = setInterval(() => {
        void engine?.request();
      }, 60_000);
      const online = () => {
        void engine?.request(true);
      };
      window.addEventListener('voxcue-local-change', changed);
      window.addEventListener('online', online);
      void syncDatabase(userId)
        .then((saved) => {
          if (epoch !== generation) return;
          const normalized = readSyncSaved(saved);
          normalized.preferences.knowledgeLimitBytes = KNOWLEDGE_MAX_BYTES;
          engine = new CloudSyncEngine({
            userId,
            saved: normalized,
            request: async (call) => {
              const result = await window.desktop!.cloudSync(call);
              if (!result.ok && result.status === 401)
                window.dispatchEvent(new Event('voxcue-cloud-expired'));
              return result;
            },
            list: (kind) => {
              if (localStorage.getItem('voxcue-sync-owner') !== userId)
                throw Error('本机资料绑定的账号与当前账号不同，请切回原账号。');
              return localCloudItems(kind);
            },
            apply: async (key, blob, hash, guard) => {
              const document = await applyCloudItem(key, blob, hash, userId, guard);
              guard();
              if (document) void useKnowledgeIndex.getState().index(document);
            },
            persist: (value) => syncDatabase<void>(userId, value),
            emit: (view) => {
              if (epoch === generation) set({ ...view, ready: true });
            },
          });
          set({ ready: true });
          void engine.request();
        })
        .catch((error) => {
          if (epoch === generation) set({ error: String(error), ready: true });
        });
      return () => {
        unregister();
        if (epoch === generation) {
          ++generation;
          engine?.stop();
          engine = undefined;
          activeUserId = undefined;
        }
        clearTimeout(debounce);
        clearInterval(poll);
        window.removeEventListener('voxcue-local-change', changed);
        window.removeEventListener('online', online);
      };
    },
    async configure(kind, enabled) {
      await perform(async () => {
        if (!engine) throw Error('同步服务尚未准备好。');
        if (enabled) {
          const owner = localStorage.getItem('voxcue-sync-owner');
          // Existing local data stays on this device. Never silently send it to a different cloud identity.
          const userId = activeUserId;
          if (!userId) throw Error('请先登录 VoxCue 账号。');
          if (owner && owner !== userId)
            throw Error('本机资料已绑定其他 VoxCue 账号，请切回原账号后同步。');
          localStorage.setItem('voxcue-sync-owner', userId);
        }
        await engine.configure({
          ...get().preferences,
          enabled: { ...get().preferences.enabled, [kind]: enabled },
        });
      });
    },
    async refresh() {
      await perform(async () => {
        await engine?.request(true);
      });
    },
    async refreshStorage() {
      await perform(async () => {
        if (!engine) throw Error('同步服务尚未准备好。');
        await engine.refreshStorage();
      });
    },
    async remove(key) {
      try {
        if (!engine) throw Error('同步服务尚未准备好。');
        await engine.removeCloud(key);
        return true;
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '删除云端数据失败。' });
        return false;
      }
    },
    async resume(key) {
      await perform(async () => {
        await engine?.resume(key);
      });
    },
    async pause(key) {
      await perform(async () => {
        if (!engine) throw Error('同步服务尚未准备好。');
        await engine.pause(key);
      });
    },
    async resolve(key, choice) {
      await perform(async () => {
        await engine?.resolve(key, choice);
      });
    },
  };
});
